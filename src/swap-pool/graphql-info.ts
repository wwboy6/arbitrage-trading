

export const UniswapV2_8EjC_Url = 'https://gateway.thegraph.com/api/subgraphs/id/8EjCaWZumyAfN3wyB4QnibeeXaYS8i4sp1PiWT91AGrt'

type UniswapV2_8EjC_Pool_Type = { id: string; reserve0: string, reserve1: string, token0: { id: string, decimals: string, symbol: string }; token1: { id: string, decimals: string, symbol: string }; reserveUSD: string }

export type UniswapV2_8EjC_Type = { q0: UniswapV2_8EjC_Pool_Type[], q1: UniswapV2_8EjC_Pool_Type[], qb: UniswapV2_8EjC_Pool_Type[] }

export const UniswapV2_8EjC_query =`
  query ($tokenSymbols: [String!]) {
    q0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: 100
      where: {
        token0_: {symbol_in: $tokenSymbols}
        token1_: {symbol_not_in: $tokenSymbols}
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
      }
      token1 {
        address: id
        decimals
        symbol
      }
      reserveUSD
    }
    
    q1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: 100
      where: {
        token0_: {symbol_not_in: $tokenSymbols}
        token1_: {symbol_in: $tokenSymbols}
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
      }
      token1 {
        address: id
        decimals
        symbol
      }
      reserveUSD
    }
    
    qb:pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: 100
      where: {
        token0_: {symbol_in: $tokenSymbols}
        token1_: {symbol_in: $tokenSymbols}
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
      }
      token1 {
        address: id
        decimals
        symbol
      }
      reserveUSD
    }
  }
`
