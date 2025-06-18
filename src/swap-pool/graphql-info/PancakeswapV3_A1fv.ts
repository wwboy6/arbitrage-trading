const queryLimit = 1000

export const url = 'https://gateway.thegraph.com/api/subgraphs/id/A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m'

type Token_Type = { address: string, decimals: string, symbol: string, name: string }

export type Pool_Type = {
  address: string
  fee: string
  tvlUSD: string
  txCount: string
  token0: Token_Type
  token1: Token_Type
}

export type Type = {
  [key: string]: Pool_Type[]
}

const query_pool = `address: id
    token0 {
      address: id
      symbol
      decimals
      name
    }
    token1 {
      address: id
      symbol
      decimals
      name
    }
    fee: feeTier
    tvlUSD: totalValueLockedUSD
    txCount`

export const query0 = `
query ($token0: String, $token1: String) {
  p0_0: pools(
    first: ${queryLimit}
    orderBy: txCount
    orderDirection: desc
    where: {
      token0: $token0
    }
  ) {
    ${query_pool}
  }
}
`

export const query1 = `
query ($token0: String, $token1: String) {
  p0_1: pools(
    first: ${queryLimit}
    orderBy: txCount
    orderDirection: desc
    where: {
      token1: $token0
    }
  ) {
    ${query_pool}
  }
}
`

export const query2 = `
query ($token0: String, $token1: String) {
  p1_0: pools(
    first: ${queryLimit}
    orderBy: txCount
    orderDirection: desc
    where: {
      token0: $token1
    }
  ) {
    ${query_pool}
  }
}
`

export const query3 = `
query ($token0: String, $token1: String) {
  p1_1: pools(
    first: ${queryLimit}
    orderBy: txCount
    orderDirection: desc
    where: {
      token1: $token1
    }
  ) {
    ${query_pool}
  }
}
`

export const queries = [query0, query1, query2, query3]
