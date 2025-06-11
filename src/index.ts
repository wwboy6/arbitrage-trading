import env from './env'
import pino from 'pino'
import { createPublicClient, defineChain, http, PublicClient } from 'viem'
import { bsc, Chain } from 'viem/chains'
import { findTokenWithSymbol } from './util/token'
import { Arbitrage } from './arbitrage'
import { z } from 'zod';
import { ERC20Token } from '@pancakeswap/sdk'
import { OnChainSwapPoolProvider, RedisSwapPoolProvider } from './swap-pool'
import { privateKeyToAccount } from 'viem/accounts'

const { PINO_LEVEL, NODE_ENV, PRIVATE_KEY, TOKEN0, TOKEN1, SwapFromAmount, FlashLoadSmartRouterAddress } = env

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
  swapFromAmount: SwapFromAmount, // TODO: dynamic adjust
}

const swapMissionSchema = z.object({
  swapFrom: z.instanceof(ERC20Token),
  swapTo: z.instanceof(ERC20Token),
  swapFromAmount: z.bigint()
})

let { swapFrom, swapTo, swapFromAmount } = swapMissionSchema.parse(swapMission)

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

const swapPoolProvider = new RedisSwapPoolProvider(
  new OnChainSwapPoolProvider(chainClient)
)

async function main () {
  if (NODE_ENV == 'development') {
    // fund token for development
  } else {
    // TODO: check token balance
  }
  // TODO: update gasPriceWei periodically
  const gasPriceWei = await chainClient.getGasPrice()
  const arbitrage = new Arbitrage(chain, chainClient, account, swapPoolProvider, FlashLoadSmartRouterAddress)
  const attackPlan = await arbitrage.findBestAttack(swapFrom, swapTo, swapFromAmount, gasPriceWei)
  logger.info(attackPlan)
}

main()
