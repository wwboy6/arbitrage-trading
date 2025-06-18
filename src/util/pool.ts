import { Currency, Token } from "@pancakeswap/sdk"
import { Pool, PoolType } from "@pancakeswap/smart-router"
import { Hex } from 'viem'

export type PoolTokenIndex = 0 | 1
export const poolTokenIndexes: PoolTokenIndex[] = [0,1]

export function getCurrencyFromPool(pool: Pool, tokenIndex: PoolTokenIndex): Currency {
  switch (pool.type) {
    case PoolType.V2:
      return (tokenIndex == 0 ? pool.reserve0 : pool.reserve1).currency
    case PoolType.V3:
      return tokenIndex == 0 ? pool.token0 : pool.token1
    case PoolType.InfinityBIN:
    case PoolType.InfinityCL:
    case PoolType.STABLE:
    default:
      throw new Error('not yet implemented')
  }
}

export function getTokenFromPool(pool: Pool, tokenIndex: PoolTokenIndex): Token {
  return getCurrencyFromPool(pool, tokenIndex).wrapped
}

export function getTokenMapFromPools(pools: Pool[]) {
  const map: any = {}
  for (const pool of pools) {
    for (const index of poolTokenIndexes) {
      const token = getTokenFromPool(pool, index)
      map[token.address] = token
    }
  }
  return map
}
