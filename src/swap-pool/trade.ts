import { ChainId, Currency, CurrencyAmount, Percent, TradeType } from "@pancakeswap/sdk"
import { Account, Chain, createWalletClient, hexToBigInt, http, PublicClient } from "viem"
import { OnChainSwapPoolProvider, SwapPoolProvider } from "."
import { SMART_ROUTER_ADDRESSES, SmartRouter, SwapRouter } from "@pancakeswap/smart-router"

export async function bestTradeExactInput(chain: Chain, chainClient: PublicClient, swapPoolProvider: SwapPoolProvider, account: Account, swapFrom: Currency, fromAmount: bigint, swapTo: Currency) {
  const swapPools = await swapPoolProvider.getPoolForTokens(swapFrom, swapTo)
  const amount = CurrencyAmount.fromRawAmount(swapFrom, fromAmount)
  const gasPriceWei = await chainClient.getGasPrice()
  const trade = await SmartRouter.getBestTrade(amount, swapTo, TradeType.EXACT_INPUT, {
    gasPriceWei,
    maxHops: 2,
    maxSplits: 2,
    poolProvider: SmartRouter.createStaticPoolProvider(swapPools),
    quoteProvider: SmartRouter.createOffChainQuoteProvider(),
    quoterOptimization: true,
  })
  if (!trade) throw new Error('no trade found')
  const { value, calldata } = SwapRouter.swapCallParameters(trade, {
    recipient: account.address,
    slippageTolerance: new Percent(1),
  })
  const smartRouterAddress = SMART_ROUTER_ADDRESSES[chain.id as ChainId]
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  walletClient.account
  const hash = await walletClient.sendTransaction({
    to: smartRouterAddress,
    data: calldata,
    value: hexToBigInt(value),
  })
  return hash
}