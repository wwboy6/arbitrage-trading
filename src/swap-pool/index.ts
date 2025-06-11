import { Currency, CurrencyAmount, Native, Percent, Token } from '@pancakeswap/sdk'
import { Pool, PoolType, SmartRouter } from '@pancakeswap/smart-router'
import { PublicClient } from 'viem';
import { GraphQLClient } from 'graphql-request'
import { Tick } from '@pancakeswap/v3-sdk'
import { toSerializable, parseSerializable } from '../util'
import pino from 'pino'

// FIXME:
import { getPools as getPools_busd_usdt } from './pools-busd-usdt'
import { RedisClientType } from '@redis/client'

const logger = pino({ level: 'info' })

export interface SwapPoolProvider {
  getPoolForTokens(token0: Currency, token1: Currency) : Promise<Pool[]>
}

export class OnChainSwapPoolProvider implements SwapPoolProvider {
  chainClient: PublicClient;
  v2SubgraphClient: GraphQLClient;
  v3SubgraphClient: GraphQLClient;
  
  constructor(chainClient: PublicClient, apiKey: string) {
    this.chainClient = chainClient
    
    this.v2SubgraphClient = new GraphQLClient('https://proxy-worker-api.pancakeswap.com/bsc-exchange')
    // this.v2SubgraphClient = new GraphQLClient(`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/Hv1GncLY5docZoGtXjo4kwbTvxm3MAhVZqBZE4sUT9eZ`)
    this.v3SubgraphClient = new GraphQLClient('https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc')
    // this.v3SubgraphClient = new GraphQLClient(`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/G5MUbSBM7Nsrm9tH2tGQUiAF4SZDGf2qeo1xPLYjKr7K`)
  }

  async getPoolForTokens(token0: Currency, token1: Currency): Promise<Pool[]> {
    const v2p = SmartRouter.getV2CandidatePools({
      onChainProvider: () => this.chainClient,
      v2SubgraphProvider: () => this.v2SubgraphClient,
      v3SubgraphProvider: () => this.v3SubgraphClient,
      currencyA: token0,
      currencyB: token1,
      // fallbackTimeout: 10000,
    })
    const v3p = SmartRouter.getV3CandidatePools({
      onChainProvider: () => this.chainClient,
      subgraphProvider: () => this.v3SubgraphClient,
      currencyA: token0,
      currencyB: token1,
      subgraphFallback: false,
      // fallbackTimeout: 10000,
    })
    const [v2Pools, v3Pools] = await Promise.all([
      v2p,
      v3p,
    ])
    return [...v2Pools, ...v3Pools]
  }
}

function transformToCurrency(data: any) {
  if (data.isToken) {
    return new Token(
      data.chainId,
      data.address,
      data.decimals,
      data.symbol,
      data.name,
      data.projectLink)
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

export class RedisSwapPoolProvider implements SwapPoolProvider {
  static swapPoolDataPrefx = "swappool-"

  sourceSwapPoolProvider: SwapPoolProvider
  redisClient: any;

  constructor(sourceSwapPoolProvider: SwapPoolProvider, redisClient: any) {
    this.sourceSwapPoolProvider = sourceSwapPoolProvider
    this.redisClient = redisClient
  }

  async fetchData(token0: Currency, token1: Currency) { // TODO: params
    // TODO: fetch pool list from https://configs.pancakeswap.com/api/data/cached/gauges
    // TODO: fetch pool list from https://gateway.thegraph.com/api/{{api-key}}/subgraphs/id/Hv1GncLY5docZoGtXjo4kwbTvxm3MAhVZqBZE4sUT9eZ
    // TODO: fetch pool list from https://gateway.thegraph.com/api/{{api-key}}/subgraphs/id/A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m
    // TODO: update pool data by multicall
    let pools = await this.sourceSwapPoolProvider.getPoolForTokens(token0, token1)
    pools = toSerializable(pools)
    for (let pool of pools) {
      let redisKey: string
      switch (pool.type) {
        case PoolType.V2:
          redisKey = `${RedisSwapPoolProvider.swapPoolDataPrefx}-${pool.type}-${token0.symbol}-${token1.symbol}`
          break;
        case PoolType.V3:
        case PoolType.STABLE:
          redisKey = `${RedisSwapPoolProvider.swapPoolDataPrefx}-${pool.type}-${token0.symbol}-${token1.symbol}-${pool.address}`
          break;
        case PoolType.InfinityBIN:
          redisKey = `${RedisSwapPoolProvider.swapPoolDataPrefx}-${pool.type}-${token0.symbol}-${token1.symbol}-${pool.activeId}` // FIXME:
          break;
        case PoolType.InfinityCL:
          redisKey = `${RedisSwapPoolProvider.swapPoolDataPrefx}-${pool.type}-${token0.symbol}-${token1.symbol}-${pool.id}` // FIXME:
          break;
      }
      this.redisClient.json.set(redisKey, pool)
    }
  }
  
  async getPoolForTokens(token0: Currency, token1: Currency): Promise<Pool[]> {
    if (token0.symbol > token1.symbol) {
      const temp = token0
      token0 = token1
      token1 = temp
    }
    // TODO: access redis
    // let pools = parseSerializable(getPools_busd_usdt()).map(transformToSwapPool)
    const keys = this.redisClient.json.get('')
    // TODO: handle error
    // TODO: check if too less pools are queued
    // TODO: check if pools are too old?
    if (!pools) {
      pools = await this.sourceSwapPoolProvider.getPoolForTokens(token0, token1)
      // TODO: access redis
    }
    return pools
  }
  // TODO: schedule / catch blockchain event to update pool data
}
