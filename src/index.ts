import env from './env'
import pino from 'pino'
import { createPublicClient, createWalletClient, defineChain, formatEther, http, PublicClient } from 'viem'
import { bsc, Chain } from 'viem/chains'
import { findTokenWithSymbol } from './util/token'
import { Arbitrage } from './arbitrage'
import { z } from 'zod';
import { CurrencyAmount, ERC20Token, Native } from '@pancakeswap/sdk'
import { OnChainSwapPoolProvider, RedisSwapPoolProvider } from './swap-pool'
import { privateKeyToAccount } from 'viem/accounts'
import { bestTradeExactInput } from './swap-pool/trade'
import * as redis from '@redis/client'
import { RedisClient } from './util/redis'

const { PINO_LEVEL, NODE_ENV, PRIVATE_KEY, TOKEN0, TOKEN1, SwapFromAmount, FlashLoadSmartRouterAddress, THE_GRAPH_KEY, RedisUrl } = env

const logger = pino({ level: PINO_LEVEL })

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
let swapFromAmount = CurrencyAmount.fromRawAmount(swapFrom, swapFromAmountBI)

const chainClient : PublicClient = createPublicClient({
  chain: chain,
  transport: http(),
  batch: {
    multicall: {
      batchSize: 1024 * 200,
    }
  },
});

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

async function main () {
  if (NODE_ENV == 'development') {
    // fund token for development
    const balance = await chainClient.getBalance({
      address: account.address
    })
    if (!balance) {
      await fundToken()
      logger.info('fund complete')
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

  // const swapPoolProvider = new RedisSwapPoolProvider(
  //   onChainSwapPoolProvider,
  //   redisClient,
  // )
  // // TODO:
  // await swapPoolProvider.fetchData(swapFrom, swapTo)
  // FIXME:
  const swapPoolProvider = onChainSwapPoolProvider
  //
  gasPriceWei = await chainClient.getGasPrice()
  const arbitrage = new Arbitrage(chain, chainClient, account, FlashLoadSmartRouterAddress)
  //
  console.time('find swap pool')
  const swapPools = await swapPoolProvider.getPoolForTokens(swapFrom, swapTo)
  console.timeEnd('find swap pool')
  if (!swapPools || !swapPools.length) throw new Error('No pool is found')
  logger.info(`swap pool count ${swapPools.length}`)
  //
  console.time('find attack')
  const attackPlan = await arbitrage.findBestAttack(swapFromAmount, swapTo, swapPools, gasPriceWei)
  console.timeEnd('find attack')
  // logger.info(attackPlan, 'attackPlan')
  logger.info(`attackPlan ${swapFromAmount.toFixed(5)} ${attackPlan.trades[0].outputAmount.toFixed(5)} ${attackPlan.trades[1].outputAmount.toFixed(5)}`)
  logger.info(`tokenGain ${attackPlan.tokenGain.toFixed(5)}`)
  //
  // const result = await arbitrage.performAttack(attackPlan)
  // logger.info(`result ${result}`)
}

main()
