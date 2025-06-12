const queryLimit = 1000

export const UniswapV2_8EjC_Url = 'https://gateway.thegraph.com/api/subgraphs/id/8EjCaWZumyAfN3wyB4QnibeeXaYS8i4sp1PiWT91AGrt'

type UniswapV2_8EjC_Pool_Type = { address: string; reserve0: string, reserve1: string, token0: { address: string, decimals: string, symbol: string }; token1: { address: string, decimals: string, symbol: string, name: string }; reserveUSD: string }

export type UniswapV2_8EjC_Type = { q0: UniswapV2_8EjC_Pool_Type[], q1: UniswapV2_8EjC_Pool_Type[], qb: UniswapV2_8EjC_Pool_Type[] }

export const UniswapV2_8EjC_query =`
  query ($tokenAddress: [String!]) {
    q0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0_in: $tokenAddress
        token1_not_in: $tokenAddress
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
        name
      }
      token1 {
        address: id
        decimals
        symbol
        name
      }
      reserveUSD
    }
    
    q1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0_not_in: $tokenAddress
        token1_in: $tokenAddress
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
        name
      }
      token1 {
        address: id
        decimals
        symbol
        name
      }
      reserveUSD
    }
    
    qb:pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0_in: $tokenAddress
        token1_in: $tokenAddress
      }
    ) {
      address: id
      reserve0
      reserve1
      token0 {
        address: id
        decimals
        symbol
        name
      }
      token1 {
        address: id
        decimals
        symbol
        name
      }
      reserveUSD
    }
  }
`
