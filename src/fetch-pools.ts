import { GraphQLClient } from 'graphql-request'
import env from './env'
import * as V3Graph from './swap-pool/graphql-info/PancakeswapV3_A1fv'
import { findTokenWithSymbol } from './util/token'
import { getAddress } from 'viem'
import { arrayUnique } from './util/collection'
import fs from 'fs/promises'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { PatchedRequestInit } from 'graphql-request/dist/types'
import { HttpsProxyAgent } from 'https-proxy-agent'

const { TOKEN0, TOKEN1, THE_GRAPH_KEY, PROXY_URL } = env

if (PROXY_URL) {
  // Corporate proxy uses CA not in undici's certificate` store
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const dispatcher = new ProxyAgent({uri: new URL(PROXY_URL).toString() });
  setGlobalDispatcher(dispatcher);
}


const [token0, token1] = [TOKEN0, TOKEN1].map(sym => findTokenWithSymbol(sym))

const graphQLClientConfig: PatchedRequestInit = {
  headers: [
    ['Authorization', `Bearer ${THE_GRAPH_KEY}`]
  ]
}
if (PROXY_URL) {
  const agent = new HttpsProxyAgent(PROXY_URL)
  graphQLClientConfig.fetch = (url: URL | RequestInfo, init: RequestInit) => {
    return fetch(url, {...init, agent} as any)
  }
}
const v3SubgraphClient = new GraphQLClient(V3Graph.url, graphQLClientConfig)

async function main() {
  // call query in sequence
  let response: V3Graph.Type = {}
  for (const query of V3Graph.queries) {
    let res = await v3SubgraphClient.request<V3Graph.Type>(
      query,
      // TODO: study query with address instead of symbol
      { token0: token0.address.toLowerCase(), token1: token1.address.toLowerCase() }
    )
    response = Object.assign(response, res)
  }
  // extract and remove duplication
  const data = arrayUnique(Object.values(response).flat(), d => d.address)
  // transform and save
  const saveData = data.map(d => {
    return {
      type: 1,
      address: getAddress(d.address),
      token0: {
        ...d.token0,
        address: getAddress(d.token0.address),
        decimals: Number(d.token0.decimals),
      },
      token1: {
        ...d.token1,
        address: getAddress(d.token1.address),
        decimals: Number(d.token1.decimals),
      },
      fee: Number(d.fee),
      // TODO: check if these are optional
      liquidity: 0,
      sqrtRatioX96: 0,
      token0ProtocolFee: 0,
      token1ProtocolFee: 0,
      // TODO: additional
      tvlUSD: Number(d.tvlUSD),
      txCount: Number(d.txCount),
    }
  })
  // TODO: save to redis
  const tokenPairKey = `${TOKEN0.toLocaleLowerCase()}-${TOKEN1.toLocaleLowerCase()}`
  await fs.writeFile(`./src/swap-pool/pools-${tokenPairKey}.json`, JSON.stringify(saveData), { encoding: 'utf8' })
}

main()
