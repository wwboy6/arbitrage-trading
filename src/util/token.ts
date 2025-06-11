import { bscTokens } from '@pancakeswap/tokens'

export function findTokenWithSymbol(symbol : string) {
  return Object.values(bscTokens).find(t => t.symbol === symbol)
}
