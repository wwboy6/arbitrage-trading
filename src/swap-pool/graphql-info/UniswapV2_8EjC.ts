const queryLimit = 1000

export const UniswapV2_8EjC_Url = 'https://gateway.thegraph.com/api/subgraphs/id/8EjCaWZumyAfN3wyB4QnibeeXaYS8i4sp1PiWT91AGrt'

type UniswapV2_8EjC_Pool_Type = {
  address: string
  reserve0: string
  reserve1: string
  token0: { address: string, decimals: string, symbol: string }
  token1: { address: string, decimals: string, symbol: string, name: string }
  reserveUSD: string
}

export type UniswapV2_8EjC_Type = {
  q00_0: UniswapV2_8EjC_Pool_Type[]
  q00_1: UniswapV2_8EjC_Pool_Type[]
  q01_0: UniswapV2_8EjC_Pool_Type[]
  q01_1: UniswapV2_8EjC_Pool_Type[]
  q10_0: UniswapV2_8EjC_Pool_Type[]
  q10_1: UniswapV2_8EjC_Pool_Type[]
  q11_0: UniswapV2_8EjC_Pool_Type[]
  q11_1: UniswapV2_8EjC_Pool_Type[]
  qb: UniswapV2_8EjC_Pool_Type[]
}

const UniswapV2_8EjC_query_pool = `address: id
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
      reserveUSD`

export const UniswapV2_8EjC_query =`
  query ($token0: String, $token1: String) {
    q00_0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0: $token0
        token1_not: $token1
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q00_1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      skip: ${queryLimit}
      where: {
        token0: $token0
        token1_not: $token1
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q01_0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0_not: $token1
        token1: $token0
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q01_1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      skip: ${queryLimit}
      where: {
        token0_not: $token1
        token1: $token0
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    q10_0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0: $token1
        token1_not: $token0
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q10_1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      skip: ${queryLimit}
      where: {
        token0: $token1
        token1_not: $token0
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q11_0: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0_not: $token0
        token1: $token1
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
    
    q11_1: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      skip: ${queryLimit}
      where: {
        token0_not: $token0
        token1: $token1
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }

    qb: pairs(
      orderBy: reserveUSD
      orderDirection: desc
      first: ${queryLimit}
      where: {
        token0: $token0
        token1: $token1
      }
    ) {
      ${UniswapV2_8EjC_query_pool}
    }
  }
`
