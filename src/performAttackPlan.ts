import { SmartRouterArbitrage, AttackPlan, transformToAttackPlan } from "./arbitrage"
import { loadObject, saveObject } from "./util"
import env from './env'
import pino from "pino"
import { createPublicClient, createWalletClient, defineChain, http, PublicClient } from "viem"
import { bsc } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { SmartRouter, SwapRouter } from "@pancakeswap/smart-router"
import { CurrencyAmount, Percent, TradeType } from "@pancakeswap/sdk"
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { getBalanceOfTokenOrNative, prepareTradeForCustomContract } from "./util/bc"
import { bestTradeExactInput } from "./swap-pool/trade"
import { OnChainSwapPoolProvider } from "./swap-pool"
const { SMART_ROUTER_ADDRESSES } = require('@pancakeswap/smart-router')

const { PINO_LEVEL, PRIVATE_KEY, THE_GRAPH_KEY, FlashLoanSmartRouterAddress } = env
const logger = pino({ level: PINO_LEVEL })

const chain = defineChain({
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

const chainClient : PublicClient = createPublicClient({
  chain: chain,
  transport: http(),
  batch: {
    multicall: {
      batchSize: 1024 * 200,
    }
  },
});

const smartRouterAddress = SMART_ROUTER_ADDRESSES[chain.id];

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(),
})

async function forwardTrade (attackPlan : AttackPlan) {
  const swapFrom = attackPlan.swapFromAmount.currency
  const swapTo = attackPlan.swapTo
  // for logging
  const tokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  let hash
  // perform forward trade
  const swapFromBalance = attackPlan.swapFromAmount.numerator / attackPlan.swapFromAmount.denominator
  const trade = prepareTradeForCustomContract(attackPlan.trades[0])
  const { calldata } = SwapRouter.swapCallParameters(trade, {
    recipient: account.address,
    slippageTolerance: new Percent(1), // TODO:
  })
  const { request: req0 } = await chainClient.simulateContract({
    address: swapFrom.address,
    abi: ERC20.abi,
    functionName: 'transfer',
    args: [smartRouterAddress, swapFromBalance],
    account,
  })
  hash = await walletClient.writeContract(req0)
  logger.info(`transfer ${hash}`)
  hash = await walletClient.sendTransaction({
    to: smartRouterAddress,
    data: calldata,
    // value: hexToBigInt(value),
    // gas: calculateGasMargin(gasEstimate),
  })
  logger.info(`forward trade ${hash}`)
  // logging
  const tokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  logger.info(`in token: ${tokenBalance1 - tokenBalance0}`)
  logger.info(`mid token: ${midTokenBalance1 - midTokenBalance0}`)
}

async function backwardTrade (attackPlan : AttackPlan) {
  const swapFrom = attackPlan.swapFromAmount.currency
  const swapTo = attackPlan.swapTo
  // for logging
  const tokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  const srb = await getBalanceOfTokenOrNative(chainClient, smartRouterAddress, swapTo)
  logger.info(`srb ${srb}`)
  if (!midTokenBalance0 && !srb) throw new Error('no mid coin')
  let hash
  // perform backward trade
  const trade = prepareTradeForCustomContract(attackPlan.trades[1])
  const { calldata } = SwapRouter.swapCallParameters(trade, {
    recipient: account.address,
    slippageTolerance: new Percent(1), // TODO:
  })
  if (midTokenBalance0) {
    const { request: req0 } = await chainClient.simulateContract({
      address: swapTo.address,
      abi: ERC20.abi,
      functionName: 'transfer',
      args: [smartRouterAddress, midTokenBalance0],
      account,
    })
    hash = await walletClient.writeContract(req0)
    logger.info(`transfer ${hash}`)
  }
  hash = await walletClient.sendTransaction({
    to: smartRouterAddress,
    data: calldata,
    // value: hexToBigInt(value),
    // gas: calculateGasMargin(gasEstimate),
  })
  logger.info(`backward trade ${hash}`)
  // logging
  const tokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  logger.info(`in token: ${tokenBalance1 - tokenBalance0}`)
  logger.info(`mid token: ${midTokenBalance1 - midTokenBalance0}`)
}

// FIXME: it is not successful yet
async function replanBackwardTrade (attackPlan : AttackPlan) {
  const swapFrom = attackPlan.swapFromAmount.currency
  const swapTo = attackPlan.swapTo
  // for logging
  const tokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance0 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  const srb = await getBalanceOfTokenOrNative(chainClient, smartRouterAddress, swapTo)
  logger.info(`srb ${srb}`)
  if (!midTokenBalance0 && !srb) throw new Error('no mid coin')
  let hash
  const amount = midTokenBalance0 + srb
  // transfer
  if (midTokenBalance0) {
    const { request: req0 } = await chainClient.simulateContract({
      address: swapTo.address,
      abi: ERC20.abi,
      functionName: 'transfer',
      args: [smartRouterAddress, midTokenBalance0],
      account,
    })
    hash = await walletClient.writeContract(req0)
    logger.info(`transfer ${hash}`)
  }
  // perform trade
  const swapPoolProvider = new OnChainSwapPoolProvider(chain, chainClient, THE_GRAPH_KEY)
  const result = await bestTradeExactInput(chain, chainClient, swapPoolProvider, account, swapTo, amount, swapFrom, true)
  await saveObject(result, "./data/replanBackwardTrade.json")
  // logging
  const tokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapFrom)
  const midTokenBalance1 = await getBalanceOfTokenOrNative(chainClient, account.address, swapTo)
  logger.info(`in token: ${tokenBalance1 - tokenBalance0}`)
  logger.info(`mid token: ${midTokenBalance1 - midTokenBalance0}`)
}

async function main() {
  const attackPlan = transformToAttackPlan(await loadObject('./data/attackPlan.json'))
  // logger.info(attackPlan)
  // await forwardTrade(attackPlan)
  // await backwardTrade(attackPlan)
  await replanBackwardTrade(attackPlan)
}

main()
