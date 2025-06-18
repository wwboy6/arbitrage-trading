import { bscTokens } from '@pancakeswap/tokens'
import { bsc } from 'viem/chains'

export function findTokenWithSymbol(symbol : string, chainId = bsc.id) {
  // FIXME: find tokens w.r.t. chainId
  if (chainId !== bsc.id) throw new Error('not yet implemented')
  const token = Object.values(bscTokens).find(t => t.symbol === symbol)
  if (token === undefined) throw new Error(`no such symbol ${symbol}`)
  return token
}
