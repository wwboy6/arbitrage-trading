import { Currency, CurrencyAmount, Native, Percent, ERC20Token } from '@pancakeswap/sdk'
import { Pool, PoolType, SmartRouter, V2Pool } from '@pancakeswap/smart-router'
import { Chain, getAddress, PublicClient } from 'viem';
import { GraphQLClient } from 'graphql-request'
import { Tick } from '@pancakeswap/v3-sdk'
import { toSerializable, parseSerializable } from '../util'
import pino from 'pino'
import { RedisClient } from '../util/redis'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { PatchedRequestInit } from 'graphql-request/dist/types';
// import crossFetch from 'cross-fetch'
import fetch from 'node-fetch'
import { RequestInfo, RequestInit } from 'node-fetch'

import env from '../env'
import { UniswapV2_8EjC_query, UniswapV2_8EjC_Type, UniswapV2_8EjC_Url } from './graphql-info';
import { findTokenWithSymbol } from '../util/token';
import { bsc } from 'viem/chains';
import Big from 'big.js'

const { PROXY_URL } = env

// FIXME:
// import { getPools as getPools_busd_usdt } from './pools-busd-usdt's

const logger = pino({ level: 'info' })

export interface SwapPoolProvider {
  getPoolForTokens(token0: Currency, token1: Currency) : Promise<Pool[]>
}

function currencyAmountFromDisplayString<C extends Currency>(currency: C, str: string) : CurrencyAmount<C> {
  const amount = BigInt(Big(str).mul((10n**BigInt(currency.decimals)).toString()).toFixed(0))
  return CurrencyAmount.fromRawAmount(currency, amount)
}

export class OnChainSwapPoolProvider implements SwapPoolProvider {
  chain: Chain
  chainClient: PublicClient;
  v2SubgraphClient: GraphQLClient;
  v3SubgraphClient: GraphQLClient;
  
  constructor(chain: Chain, chainClient: PublicClient, apiKey: string) {
    this.chain = chain
    this.chainClient = chainClient

    const graphQLClientConfig : PatchedRequestInit = {}
    if (PROXY_URL) {
      const agent = new HttpsProxyAgent(PROXY_URL)
      graphQLClientConfig.fetch = (url: URL | RequestInfo, init: RequestInit) => {
        return fetch(url, {...init, agent})
      }
    }
    
    // this.v2SubgraphClient = new GraphQLClient('https://proxy-worker-api.pancakeswap.com/bsc-exchange', {})
    // this.v2SubgraphClient = new GraphQLClient(`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/Hv1GncLY5docZoGtXjo4kwbTvxm3MAhVZqBZE4sUT9eZ`)
    // Uniswap V2
    this.v2SubgraphClient = new GraphQLClient(UniswapV2_8EjC_Url, {
      ...graphQLClientConfig,
      headers: [
        ['Authorization', `Bearer ${apiKey}`]
      ]
    })

    // this.v3SubgraphClient = new GraphQLClient('https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc')
    // this.v3SubgraphClient = new GraphQLClient(`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/G5MUbSBM7Nsrm9tH2tGQUiAF4SZDGf2qeo1xPLYjKr7K`)
    this.v3SubgraphClient = new GraphQLClient(`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m`, graphQLClientConfig)
  }

  async getPoolForTokens(currency0: Currency, currency1: Currency): Promise<Pool[]> {
    const token0 = currency0.wrapped
    const token1 = currency1.wrapped
    let response = await this.v2SubgraphClient.request<UniswapV2_8EjC_Type>(
      UniswapV2_8EjC_query,
      // TODO: study query with address instead of symbol
      { tokenAddress: [token0.address.toLowerCase(), token1.address.toLowerCase()] }
    );
    const v2Pools = [...response.q0, ...response.q1, ...response.qb].map<V2Pool>(data => {
      const token0 = transformToToken(data.token0, this.chain.id)
      const token1 = transformToToken(data.token1, this.chain.id)
      return {
        type: PoolType.V2,
        address: getAddress(data.address), // TODO:
        reserve0: currencyAmountFromDisplayString(token0, data.reserve0),
        reserve1: currencyAmountFromDisplayString(token1, data.reserve1),
      }
    })
    // FIXME: v3
    return v2Pools
  }

  // TODO: save it as another provider
  // async getPoolForTokens(token0: Currency, token1: Currency): Promise<Pool[]> {
  //   const v2p = SmartRouter.getV2CandidatePools({
  //     onChainProvider: () => this.chainClient,
  //     v2SubgraphProvider: () => this.v2SubgraphClient,
  //     v3SubgraphProvider: () => this.v3SubgraphClient,
  //     currencyA: token0,
  //     currencyB: token1,
  //     // fallbackTimeout: 10000,
  //   })
  //   const v3p = SmartRouter.getV3CandidatePools({
  //     onChainProvider: () => this.chainClient,
  //     subgraphProvider: () => this.v3SubgraphClient,
  //     currencyA: token0,
  //     currencyB: token1,
  //     subgraphFallback: false,
  //     // fallbackTimeout: 10000,
  //   })
  //   const [v2Pools, v3Pools] = await Promise.all([
  //     v2p,
  //     v3p,
  //   ])
  //   return [...v2Pools, ...v3Pools]
  // }
}

function transformToToken(data: any, defaultChainId: Number = 0) : ERC20Token {
  return new ERC20Token(
    Number(data.chainId || defaultChainId),
    getAddress(data.address),
    Number(data.decimals),
    data.symbol,
    data.name,
    data.projectLink
  )
}

function transformToCurrency(data: any, defaultChainId: Number = 0) : Currency {
  if (data.isToken) {
    return transformToToken(data, defaultChainId)
  } else {
    return Native.onChain(data.chainId)
  }
}

function transformToCurrencyReserve(data: any) {
  const currency = transformToCurrency(data.currency)
  return CurrencyAmount.fromFractionalAmount(currency, data.numerator, data.denominator)
}

function transformToSwapPool(data: any) {
  const reserve0 = transformToCurrencyReserve(data.reserve0)
  const reserve1 = transformToCurrencyReserve(data.reserve1)
  switch(data.type) {
    case PoolType.V2:
      return {
        ...data,
        reserve0,
        reserve1,
      }
    case PoolType.V3:
      if (data.ticks) console.warn('V3 data with ticks', data)
      return {
        ...data,
        reserve0,
        reserve1,
        token0: reserve0.currency,
        token1: reserve1.currency,
        token0ProtocolFee: new Percent(data.token0ProtocolFee.numerator, data.token0ProtocolFee.denominator),
        token1ProtocolFee: new Percent(data.token1ProtocolFee.numerator, data.token1ProtocolFee.denominator),
        // TODO: verify this
        ticks: data.ticks?.map((t : any) => new Tick(t))
      }
    case PoolType.STABLE:
      console.log('stable')
      break
    case PoolType.InfinityBIN:
      console.log('InfinityBIN')
      break
    case PoolType.InfinityCL:
      console.log('InfinityCL')
      break
  }
  return data
}

export const swapPoolKeyPrefix = "swappool:"

export class RedisSwapPoolProvider implements SwapPoolProvider {
  sourceSwapPoolProvider: SwapPoolProvider
  redisClient: RedisClient;

  constructor(sourceSwapPoolProvider: SwapPoolProvider, redisClient: RedisClient) {
    this.sourceSwapPoolProvider = sourceSwapPoolProvider
    this.redisClient = redisClient
  }

  async fetchData(token0: Currency, token1: Currency) { // TODO: params
    // TODO: fetch pool list from https://configs.pancakeswap.com/api/data/cached/gauges
    // TODO: fetch pool list from https://gateway.thegraph.com/api/{{api-key}}/subgraphs/id/Hv1GncLY5docZoGtXjo4kwbTvxm3MAhVZqBZE4sUT9eZ
    // TODO: fetch pool list from https://gateway.thegraph.com/api/{{api-key}}/subgraphs/id/A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m
    // TODO: update pool data by multicall
    let pools = await this.sourceSwapPoolProvider.getPoolForTokens(token0, token1)
    await Promise.all(pools.map(async pool => {
      let redisKey: string
      switch (pool.type) {
        case PoolType.V2:
          redisKey = `${swapPoolKeyPrefix}:${pool.type}:${token0.symbol}:${token1.symbol}`
          break;
        case PoolType.V3:
        case PoolType.STABLE:
          redisKey = `${swapPoolKeyPrefix}:${pool.type}:${token0.symbol}:${token1.symbol}:${pool.address}`
          break;
        case PoolType.InfinityBIN:
          redisKey = `${swapPoolKeyPrefix}:${pool.type}:${token0.symbol}:${token1.symbol}:${pool.activeId}` // FIXME:
          break;
        case PoolType.InfinityCL:
          redisKey = `${swapPoolKeyPrefix}:${pool.type}:${token0.symbol}:${token1.symbol}:${pool.id}` // FIXME:
          break;
      }
      const data = toSerializable(pool)
      const result = await this.redisClient.set(redisKey, JSON.stringify({
        pool: data,
        timestamp: Date.now(), // TODO: check if it is useful
      }))
      if (result != 'OK') {
        logger.error(`failed to save pool cache: ${redisKey} ${data}`)
      }
    }))
  }
  
  async getPoolForTokens(token0: Currency, token1: Currency): Promise<Pool[]> {
    if (token0.symbol > token1.symbol) {
      const temp = token0
      token0 = token1
      token1 = temp
    }
    // TODO: access redis
    // let pools = parseSerializable(getPools_busd_usdt()).map(transformToSwapPool)
    // const keys = this.redisClient.json.get(`${swapPoolKeyPrefix}:*:${token0.symbol}`)
    const { cursor, keys } = await this.redisClient.scan('0', {
      MATCH: `${swapPoolKeyPrefix}:*:${token0.symbol}:*`,
    })
    logger.info(cursor)
    logger.info(keys)
    // // TODO: handle error
    // // TODO: check if too less pools are queued
    // // TODO: check if pools are too old?
    // if (!pools) {
    //   pools = await this.sourceSwapPoolProvider.getPoolForTokens(token0, token1)
    //   // TODO: access redis
    // }
    // return pools
    throw new Error('test')
  }
  // TODO: schedule / catch blockchain event to update pool data
}
