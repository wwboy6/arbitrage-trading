import env from './env'
import pino from 'pino'
import { createPublicClient, createWalletClient, defineChain, Hash, http, PublicClient } from 'viem'
import { bsc, Chain } from 'viem/chains'
import { findTokenWithSymbol } from './util/token'
import { AttackPlan, SmartRouterArbitrage } from './arbitrage'
import { z } from 'zod'
import { Currency, CurrencyAmount, ERC20Token, Native, Token } from '@pancakeswap/sdk'
import { fetchV2Pool, OnChainSwapPoolProvider } from './swap-pool'
import { privateKeyToAccount } from 'viem/accounts'
import { bestTradeExactInput } from './swap-pool/trade'
// import * as redis from '@redis/client'
// import { RedisClient } from './util/redis'
import { saveObject, toSerializable } from './util'
import { Transformer, V2Pool, V3Pool } from '@pancakeswap/smart-router'
import { throttledHttp } from './util/throttled-http'
import { setIntersection, randomSelect, arrayContains, setUnion } from './util/collection'

import { getTokenFromPool, getTokenMapFromPools, poolTokenIndexes } from './util/pool'

import { setGlobalDispatcher, ProxyAgent } from "undici"

import dayjs from "dayjs"
import fs from 'fs/promises'
import pMemoize from 'p-memoize'
import ExpiryMap from 'expiry-map'

const { PINO_LEVEL, NODE_ENV, PRIVATE_KEY, TOKEN0, TOKEN1, SwapFromAmount, PancakeswapArbitrageAddress, THE_GRAPH_KEY, RedisUrl, PROXY_URL, PREFERRED_TOKENS, V2_POOL_TOP, LINKED_TOKEN_PICK, PROFIT_THRESHOLD } = env

if (new Set([TOKEN0, TOKEN1, ...PREFERRED_TOKENS]).size != 2 + PREFERRED_TOKENS.length) {
  throw new Error('invaild config about tokens: no duplication is allowed')
}
const tokenPairKey = `${TOKEN0.toLowerCase()}-${TOKEN1.toLowerCase()}`

const logger = pino({ level: PINO_LEVEL })

if (PROXY_URL) {
  // Corporate proxy uses CA not in undici's certificate store
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  const dispatcher = new ProxyAgent({uri: new URL(PROXY_URL).toString() })
  setGlobalDispatcher(dispatcher)
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

const chainClientForAttack: PublicClient = createPublicClient({
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

// TODO:
const mainnetChainClient: PublicClient = createPublicClient({
  chain: bsc,
  transport: throttledHttp(
    bsc.rpcUrls.default.http[0],
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

const account = privateKeyToAccount(PRIVATE_KEY)

const onChainSwapPoolProvider = new OnChainSwapPoolProvider(chain, mainnetChainClient, THE_GRAPH_KEY)

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
  await bestTradeExactInput(chain, mainnetChainClient, onChainSwapPoolProvider, account, nativeCurrency, fromAmount / 2n, swapFrom)
}

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
  const desc = `gain:${attackPlan.tokenGain.toFixed(5)} tokens:${poolDes}`
  logger.info(`[plan] ${desc}`)
  return desc
}

async function writeLog(str: string) {
  logger.info(str)
  const dateStr = dayjs().format("YYYY-MM-DD_HH-mm-ss")
  const result = await fs.appendFile(`./data/${tokenPairKey}/log.txt`, `${dateStr} ${str}\n`, { encoding: 'utf8' })
  return result
}

type WithTxCount = {
  txCount: Number
}

async function fetchAndFilterV3Pool(preferredTokenAddresses: Set<String>) {
  // TODO: load pool cache from redis
  const swapPoolDataRaw = JSON.parse(await fs.readFile(`./data/${tokenPairKey}/pools-${tokenPairKey}.json`, 'utf8'))
  let swapPools: (V3Pool & WithTxCount)[] = swapPoolDataRaw.map((d: any) => Transformer.parsePool(chain.id, d)) as any[]
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
      pool.txCount > pool1.txCount
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
    const balance = await chainClientForAttack.getBalance({
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
  const arbitrage = new SmartRouterArbitrage(bsc, mainnetChainClient, account, PancakeswapArbitrageAddress)
  const arbitrageForAttack = new SmartRouterArbitrage(chain, chainClientForAttack, account, PancakeswapArbitrageAddress)
  // load swap pool
  const preferredTokens = PREFERRED_TOKENS.map(sym => findTokenWithSymbol(sym))
  const preferredTokenAddresses = new Set(preferredTokens.map(t => t.address))
  // console.time('find swap pool')
  // const swapPoolProvider = onChainSwapPoolProvider
  // const swapPools = await swapPoolProvider.getPoolForTokens(swapFrom, swapTo)
  // console.timeEnd('find swap pool')
  // TODO:
  let v2Pools = await fetchV2Pool(mainnetChainClient, swapFrom, swapTo)
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
    const t = v2SelectedTokens.find(t => t.address === addr)
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
  const estimateFeesPerGas = pMemoize(async () => ({
    gasPriceWei: await chainClientForAttack.getGasPrice(),
    ...await chainClientForAttack.estimateFeesPerGas(),
  }), {cache: new ExpiryMap(10000)})
  // approve contract
  if (NODE_ENV == 'development') {
    arbitrageForAttack.approve(swapFrom)
  }
  // start searching loop
  while (true) { // TODO: stop condition for refreshing pool
    logger.info(`--------------------------------`)
    // regularly fetch gas fee
    const { gasPriceWei, maxFeePerGas, maxPriorityFeePerGas } = await estimateFeesPerGas()
    logger.info({ gasPriceWei, maxFeePerGas, maxPriorityFeePerGas })
    //
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
    const attackPlanDesc = logAttackPlan(attackPlan)
    logger.info(`currency amount ${swapFromAmount.toFixed(5)} ${attackPlan.trades[0].outputAmount.toFixed(5)} ${attackPlan.trades[1].outputAmount.toFixed(5)}`)
    // TODO: perform attack on another async op / thread
    if (attackPlan.tokenGain.numerator > 0) {
      if (attackPlan.tokenGain.numerator < PROFIT_THRESHOLD) {
        writeLog(`too less profit ${attackPlan.tokenGain.numerator}`)
      }
      if (NODE_ENV === 'development') continue
      writeLog(`perform attack ${attackPlanDesc}`)
      // save current attack plan
      const dateStr = dayjs().format("YYYY-MM-DD_HH-mm-ss")
      saveObject(attackPlan, `./data/${tokenPairKey}/attackPlan-${dateStr}.json`)
      // perform attack
      // TODO: not to wait for transaction
      console.time('perform attack')
      const result = await arbitrageForAttack.performAttack(attackPlan, gasPriceWei, maxFeePerGas, maxPriorityFeePerGas)
      console.timeEnd('perform attack')
      logger.info(`result ${result.hash}`)
      const bscPriceHkd = 5062
      const currencyChange = Number(result.nativeCurrencyChange.toFixed(5))
      logger.info(`currency change ${currencyChange} ${currencyChange * bscPriceHkd}`)
      const swapInPriceHkd = 5062
      const swapInChange = Number(result.tokenGain.toFixed(5))
      logger.info(`swapIn change ${swapInChange} ${swapInChange * swapInPriceHkd}`)
      const attackResultStr = JSON.stringify(toSerializable({
        ...result,
        attackPlan: dateStr,
      }), null , 2)
      await fs.writeFile(`./data/${tokenPairKey}/attackResult-${dateStr}.json`, attackResultStr, { encoding: 'utf8' })
    }
    // TODO: delay for scanning interval
  }
}

main()
