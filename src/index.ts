import env from './env'
import pino from 'pino'
import { createPublicClient, createWalletClient, defineChain, Hash, http, PublicClient } from 'viem'
import { bsc, Chain } from 'viem/chains'
import { findTokenWithSymbol } from './util/token'
import { AttackPlan, SmartRouterArbitrage } from './arbitrage'
import { z } from 'zod';
import { Currency, CurrencyAmount, ERC20Token, Native, Token } from '@pancakeswap/sdk'
import { fetchV2Pool, OnChainSwapPoolProvider } from './swap-pool'
import { privateKeyToAccount } from 'viem/accounts'
import { bestTradeExactInput } from './swap-pool/trade'
// import * as redis from '@redis/client'
// import { RedisClient } from './util/redis'
import { saveObject } from './util'
import { Transformer, V2Pool, V3Pool } from '@pancakeswap/smart-router'
import { throttledHttp } from './util/throttled-http'
import { setIntersection, randomSelect, arrayContains, setUnion } from './util/collection'

import swapPoolDataRaw from './swap-pool/pools-wbnb-busd.json'

import { getTokenFromPool, getTokenMapFromPools, poolTokenIndexes } from './util/pool'

import { setGlobalDispatcher, ProxyAgent } from "undici";

import dayjs from "dayjs";

const { PINO_LEVEL, NODE_ENV, PRIVATE_KEY, TOKEN0, TOKEN1, SwapFromAmount, FlashLoanSmartRouterAddress, THE_GRAPH_KEY, RedisUrl, PROXY_URL, PREFERRED_TOKENS, V2_POOL_TOP, LINKED_TOKEN_PICK } = env

const logger = pino({ level: PINO_LEVEL })

if (PROXY_URL) {
  // Corporate proxy uses CA not in undici's certificate store
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const dispatcher = new ProxyAgent({uri: new URL(PROXY_URL).toString() });
  setGlobalDispatcher(dispatcher);
}

logger.info('==== Blockchain Arbitrage Trading Bot ====')
logger.info(`NODE_ENV: ${NODE_ENV}`)

let chain : Chain

if (NODE_ENV == 'production') {
  chain = bsc
} else {
  chain = defineChain({
    ...bsc,
    name: 'Local Hardhat',
    network: 'hardhat',
    rpcUrls: {
      default: {
        http: ['http://127.0.0.1:8545'],
      },
      public: {
        http: ['http://127.0.0.1:8545'],
      },
    }
  })
}

logger.info(`Using chain: ${chain.name}`)

// TODO:
const swapMission = {
  swapFrom: findTokenWithSymbol(TOKEN0),
  swapTo: findTokenWithSymbol(TOKEN1),
  swapFromAmountBI: SwapFromAmount, // TODO: dynamic adjust
}

const swapMissionSchema = z.object({
  swapFrom: z.instanceof(ERC20Token),
  swapTo: z.instanceof(ERC20Token),
  swapFromAmountBI: z.bigint()
})

let { swapFrom, swapTo, swapFromAmountBI } = swapMissionSchema.parse(swapMission)
const swapTokens = [swapFrom, swapTo]

function mapToAddress(tokens: Currency[]) {
  return tokens.map(t => t.wrapped.address)
}
const swapTokenAddresses = mapToAddress(swapTokens)

let swapFromAmount = CurrencyAmount.fromRawAmount(swapFrom, swapFromAmountBI)

const chainClient: PublicClient = createPublicClient({
  chain: chain,
  transport: throttledHttp(
    chain.rpcUrls.default.http[0],
    {
      retryCount: Infinity, // FIXME:
      retryDelay: 1 * 1000,
    } as any, // TODO:
    {
      limit: 3, // TODO: this depends on rpc server
      interval: 1000
    }
  ),
  batch: {
    multicall: {
      batchSize: 2**10, // TODO: determine optimal batch size
    }
  },
})

const account = privateKeyToAccount(PRIVATE_KEY);

const onChainSwapPoolProvider = new OnChainSwapPoolProvider(chain, chainClient, THE_GRAPH_KEY)

async function fundToken() {
  const testAccountPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const testClient = createWalletClient({
    account: privateKeyToAccount(testAccountPrivateKey),
    chain,
    transport: http(),
  })
  const fromAmount = 20n * 10n**18n
  await testClient.sendTransaction({
    to: account.address,
    value: fromAmount,
  })
  const nativeCurrency = Native.onChain(chain.id)
  await bestTradeExactInput(chain, chainClient, onChainSwapPoolProvider, account, nativeCurrency, fromAmount / 2n, swapFrom)
}

// TODO: update gasPriceWei periodically
let gasPriceWei: bigint

function logAttackPlan(attackPlan: AttackPlan) {
  // log pools
  let poolDes: string[] = []
  let inputTokenAddress = attackPlan.swapFromAmount.currency.wrapped.address
  const pools = [...attackPlan.trades[0].routes[0].pools, ...attackPlan.trades[1].routes[0].pools]
  for (const pool of pools) {
    const token0 = getTokenFromPool(pool, 0)
    const token1 = getTokenFromPool(pool, 1)
    const outputToken = token0.address === inputTokenAddress ? token1 : token0
    poolDes = [...poolDes, `${pool.type}-${outputToken.symbol}`]
    // prepare for next one
    inputTokenAddress = outputToken.address
  }
  logger.info(`[plan] gain:${attackPlan.tokenGain.toFixed(5)} tokens:${poolDes}`)
}

async function fetchAndFilterV3Pool(preferredTokenAddresses: Set<String>) {
  // TODO: load pool cache from redis
  let swapPools: V3Pool[] = swapPoolDataRaw.map((d: any) => Transformer.parsePool(chain.id, d)) as any[]
  if (!swapPools || !swapPools.length) throw new Error('No pool is found')
  logger.info(`swap pool count ${swapPools.length}`)
  // TODO: better fee selection
  // select pool with lowest fee if more than 1 pool with same token pair
  // TODO: assume token0 token1 is sorted
  const poolMap = swapPools.reduce((map:any, pool) => {
    const tokenPairKey = `${getTokenFromPool(pool, 0).address}-${getTokenFromPool(pool, 1).address}`
    const pool1 = map[tokenPairKey]
    if (
      !pool1 ||
      pool.fee < pool1.fee
    ) {
      map[tokenPairKey] = pool
    }
    return map
  }, {})
  swapPools = Object.values(poolMap)
  logger.info(`swap pool count after fee selection ${swapPools.length}`)
  // filter pool and token that can form route (consider route of 1 / 2 pool only)
  // seperate direct pool and indirect pool
  const poolGroups = Object.groupBy(swapPools, p =>
    arrayContains(swapTokenAddresses, getTokenFromPool(p, 0).address) && arrayContains(swapTokenAddresses, getTokenFromPool(p, 1).address) ? 'directPoolsAll' :
    preferredTokenAddresses.has(getTokenFromPool(p, 0).address) || preferredTokenAddresses.has(getTokenFromPool(p, 1).address) ? 'preferredPools' :
        'indirectPoolsAll'
  )
  const { directPoolsAll = [], preferredPools = [], indirectPoolsAll = [] } = poolGroups
  // search for linked tokens for each target token
  const linkedTokenSets = swapTokenAddresses.map(
    tokenAddress => indirectPoolsAll
      .map(p => poolTokenIndexes.map(i => getTokenFromPool(p, i).address))
      .filter(addresses => arrayContains(addresses, tokenAddress))
      .map(addresses => addresses.find(addr => addr !== tokenAddress))
      .filter(addr => addr != undefined) // TODO: this is for typing only
  ).map(tokens => new Set(tokens))
  // find interseaction
  // FIXME: not sure why cannot setup es2024 in vscode
  // const linkedTokensForRoute = linkedTokenSets[0].intersection(linkedTokenSets[1])
  let linkedTokensForRoute = setIntersection(linkedTokenSets[0], linkedTokenSets[1])
  // filter related pool
  const indirectPools = indirectPoolsAll.filter(p =>
    linkedTokensForRoute.has(getTokenFromPool(p, 0).address) ||
    linkedTokensForRoute.has(getTokenFromPool(p, 1).address)
  )
  return {
    preferredPools,
    directPools: directPoolsAll,
    indirectPools,
    linkedTokensForRoute,
  }
}

async function main () {
  if (NODE_ENV == 'development') {
    // fund token for development
    // FIXME: check token balance instead
    const balance = await chainClient.getBalance({
      address: account.address
    })
    logger.info(`balance: ${balance}`)
    if (!balance) {
      if (swapFrom.symbol == "WBNB") {
        logger.warn('cannot fund WBNB yet')
      } else {
        await fundToken()
        logger.info('fund complete')
      }
    }
  } else {
    // TODO: check token balance
  }
  //
  // const redisClient: RedisClient = await redis.createClient({
  //   url: RedisUrl,
  //   // modules: {
  //   //   json: redisJson // Register RedisJSON module
  //   // }
  // })
  //   .on('error', (err) => console.log('Redis Client Error', err))
  //   .on('connect', () => console.log('Connected to Redis'))
  //   .connect()
  //
  gasPriceWei = await chainClient.getGasPrice()
  const arbitrage = new SmartRouterArbitrage(chain, chainClient, account, FlashLoanSmartRouterAddress)
  // load swap pool
  const preferredTokens = PREFERRED_TOKENS.map(sym => findTokenWithSymbol(sym))
  const preferredTokenAddresses = new Set(preferredTokens.map(t => t.address))
  // console.time('find swap pool')
  // const swapPoolProvider = onChainSwapPoolProvider
  // const swapPools = await swapPoolProvider.getPoolForTokens(swapFrom, swapTo)
  // console.timeEnd('find swap pool')
  // TODO:
  let v2Pools = await fetchV2Pool(chainClient, swapFrom, swapTo)
  logger.info(`v2Pools ${v2Pools.length}`)
  let v2SelectedTokens = [
    ...v2Pools.map(p => getTokenFromPool(p, 0)),
    ...v2Pools.map(p => getTokenFromPool(p, 1))
  ].filter(token => !arrayContains(swapTokenAddresses, token.address))
  // make v2SelectedTokens unique
  let v2SelectedTokenAddresses = new Set(v2SelectedTokens.map(t => t.address))
  v2SelectedTokens = [...v2SelectedTokenAddresses].map(addr => {
    const t = v2SelectedTokens.find(t => t.address === addr)
    if (t === undefined) throw new Error('WTF')
    return t
  })
  //
  logger.info(`v2 tokens: ${v2SelectedTokens.length}`)
  logger.info(`${v2SelectedTokens.map(t => t.symbol)}`)
  // select v2 pools
  let v2FilterredTokens = [
    ...v2SelectedTokens.slice(0, V2_POOL_TOP),
  ]
  const preferredV2TokenAddresses = setIntersection(preferredTokenAddresses, v2SelectedTokenAddresses)
  let v2FilterredTokenAddresses = new Set([...v2FilterredTokens.map(t => t.address), ...preferredV2TokenAddresses])
  v2FilterredTokens = [...v2FilterredTokenAddresses].map(addr => {
    const t = v2FilterredTokens.find(t => t.address === addr)
    if (t === undefined) throw new Error('WTF')
    return t
  })
  let v2FilterredTokenSymbols = v2FilterredTokens.map(t => t.symbol)
  logger.info(`v2 tokens filterred: ${v2FilterredTokens.length}`)
  logger.info(`${v2FilterredTokenSymbols}`)
  //
  v2Pools = v2Pools.filter(pool =>
    v2FilterredTokenAddresses.has(getTokenFromPool(pool, 0).address) || // token0 in tokens
    v2FilterredTokenAddresses.has(getTokenFromPool(pool, 1).address) || // token1 in tokens
    // directed pool
    arrayContains(swapTokenAddresses, getTokenFromPool(pool, 0).address) && arrayContains(swapTokenAddresses, getTokenFromPool(pool, 1).address)
  )
  //
  const v3PreferredAddress = setUnion(v2FilterredTokenAddresses, preferredTokenAddresses)
  const { preferredPools, directPools, indirectPools, linkedTokensForRoute } = await fetchAndFilterV3Pool(v3PreferredAddress)
  logger.info(`preferredPools ${preferredPools.length}`)
  logger.info(`directPools ${directPools.length}`)
  logger.info(`indirectPools ${indirectPools.length}`)
  const indirectPooltokenMap = getTokenMapFromPools(indirectPools)
  // start searching loop
  while (true) { // TODO: stop condition for refreshing pool
    logger.info(`--------------------------------`)
    logger.info(`v2 Filterred ${v2FilterredTokenSymbols}`)
    // random select limited linked tokens
    const selectedTokens = new Set(randomSelect([...linkedTokensForRoute], LINKED_TOKEN_PICK - v2FilterredTokenAddresses.size))
    // const selectedTokens = new Set(randomSelect([...linkedTokensForRoute], 1))
    const usingIndirectPools = indirectPools.filter(p =>
      selectedTokens.has(getTokenFromPool(p, 0).address) ||
      selectedTokens.has(getTokenFromPool(p, 1).address)
    )
    const selectedTokenSymbols = [...selectedTokens].map(addr => indirectPooltokenMap[addr].symbol)
    logger.info(`selectedTokens ${selectedTokenSymbols}`)
    //
    const swapPools = [...v2Pools, ...preferredPools, ...directPools, ...usingIndirectPools]
    logger.info(`v2Pools:${v2Pools.length} pref:${preferredPools.length} direct:${directPools.length} ind:${usingIndirectPools.length}`)
    logger.info(`swapPools ${swapPools.length}`)
    // draft attack plan
    console.time('find attack')
    const attackPlan = await arbitrage.findBestAttack(swapFromAmount, swapTo, swapPools, gasPriceWei)
    console.timeEnd('find attack')
    if (!attackPlan) continue
    // logger.info(attackPlan, 'attackPlan')
    logAttackPlan(attackPlan)
    logger.info(`currency amount ${swapFromAmount.toFixed(5)} ${attackPlan.trades[0].outputAmount.toFixed(5)} ${attackPlan.trades[1].outputAmount.toFixed(5)}`)
    // TODO: perform attack on another async op / thread
    if (attackPlan.tokenGain.numerator > 0) {
      logger.info(`can perform attack`)
      // save current attack plan
      const dateStr = dayjs().format("YYYY-MM-DD_HH-mm-ss")
      saveObject(attackPlan, `./data/attackPlan-${dateStr}.json`)
      // perform attack
      // TODO: check attack plan profit
      // console.time('perform attack')
      // const result = await arbitrage.performAttack(attackPlan)
      // console.timeEnd('perform attack')
      // logger.info(`result ${result.hash}`);
      // logger.info(`${result.nativeCurrencyChange.toFixed(5)} ${result.tokenGain.toFixed(5)}`)
    }
    // TODO: delay for scanning interval
  }
}

main()
