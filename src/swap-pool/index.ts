import { CurrencyAmount, ERC20Token, Native, Percent, Token } from "@pancakeswap/sdk";
import { Pool, PoolType, SmartRouter } from "@pancakeswap/smart-router";
import { PublicClient } from "viem";
import { GraphQLClient } from 'graphql-request'
import { Tick } from "@pancakeswap/v3-sdk"
import { parseSerializable } from "../util"

// FIXME:
import { getPools as getPools_busd_usdt } from './pools-busd-usdt'

export interface SwapPoolProvider {
  getPoolForTokens(token0: ERC20Token, token1: ERC20Token) : Promise<Pool[]>
}

export class OnChainSwapPoolProvider implements SwapPoolProvider {
  chainClient: PublicClient;
  v2SubgraphClient: GraphQLClient;
  v3SubgraphClient: GraphQLClient;
  
  constructor(chainClient: PublicClient) {
    this.chainClient = chainClient
    this.v2SubgraphClient = new GraphQLClient('https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc')
    this.v3SubgraphClient = new GraphQLClient('https://proxy-worker-api.pancakeswap.com/bsc-exchange')
  }

  async getPoolForTokens(token0: ERC20Token, token1: ERC20Token): Promise<Pool[]> {
    const v2p = SmartRouter.getV2CandidatePools({
      onChainProvider: () => this.chainClient,
      v2SubgraphProvider: () => this.v2SubgraphClient,
      v3SubgraphProvider: () => this.v3SubgraphClient,
      currencyA: token0,
      currencyB: token1,
    })
    const v3p = SmartRouter.getV3CandidatePools({
      onChainProvider: () => this.chainClient,
      subgraphProvider: () => this.v3SubgraphClient,
      currencyA: token0,
      currencyB: token1,
      subgraphFallback: false,
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
  sourceSwapPoolProvider: SwapPoolProvider;

  constructor(sourceSwapPoolProvider: SwapPoolProvider) {
    this.sourceSwapPoolProvider = sourceSwapPoolProvider
  }
  
  async getPoolForTokens(token0: ERC20Token, token1: ERC20Token): Promise<Pool[]> {
    if (token0.symbol > token1.symbol) {
      const temp = token0
      token0 = token1
      token1 = temp
    }
    // TODO: access redis
    let pools = parseSerializable(getPools_busd_usdt()).map(transformToSwapPool)
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
