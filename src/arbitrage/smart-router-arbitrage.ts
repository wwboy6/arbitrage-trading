import { Account, Chain, createWalletClient, http, PublicClient, WalletClient } from "viem";
import { SmartRouter, SmartRouterTrade, SMART_ROUTER_ADDRESSES, SwapRouter, QuoteProvider, Pool, Route, RouteType } from '@pancakeswap/smart-router'
import { ChainId, Currency, CurrencyAmount, ERC20Token, Native, Percent, TradeType } from "@pancakeswap/sdk";
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json'
import FlashLoanSmartRouterInfo from '../contract/FlashLoanSmartRouter.json'
import { transformToCurrency, transformToCurrencyAmount, transformToSwapPool } from "../swap-pool";
import { getBalanceOfTokenOrNative, prepareTradeForCustomContract } from "../util/bc";

export type AttackPlan = {
  swapFromAmount: CurrencyAmount<ERC20Token>,
  swapTo: ERC20Token,
  trades: SmartRouterTrade<TradeType>[]
  tokenGain: CurrencyAmount<ERC20Token>,
}

export type AttackResult = {
  attackPlan: AttackPlan,
  tokenGain: CurrencyAmount<Currency>,
  nativeCurrencyChange: CurrencyAmount<Currency>,
  hash: `0x${string}`,
  // TODO: estimate profit in usd
}

export class SmartRouterArbitrage {
  chainClient: PublicClient;
  account: Account;
  flashLoadSmartRouterAddress: `0x${string}`;
  nativeCurrency: Native;
  walletClient: WalletClient;
  smartRouterAddress: string;
  quoteProvider: QuoteProvider;

  constructor(chain: Chain, chainClient: PublicClient, account: Account, flashLoadSmartRouterAddress: `0x${string}`) {
    this.chainClient = chainClient
    this.account = account
    this.flashLoadSmartRouterAddress = flashLoadSmartRouterAddress
    this.nativeCurrency = Native.onChain(chain.id as ChainId)
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    })
    this.smartRouterAddress = SMART_ROUTER_ADDRESSES[chain.id as ChainId]
    this.quoteProvider = SmartRouter.createQuoteProvider({
      onChainProvider: () => chainClient,
    })
  }

  async findBestAttack(swapFromAmount: CurrencyAmount<ERC20Token>, swapTo: ERC20Token, swapPools: Pool[], gasPriceWei: bigint) : Promise<AttackPlan | null> { // TODO: return type
    try {
      const swapFrom = swapFromAmount.currency
      if (!swapPools || !swapPools.length) throw new Error('no pool')
      // TODO: exclude some pools
      // forward trade
      const forwardTrade = await SmartRouter.getBestTrade(swapFromAmount, swapTo, TradeType.EXACT_INPUT, {
        gasPriceWei,
        maxHops: 2, // TODO: what is this?
        maxSplits: 1, // TODO: what is this?
        distributionPercent: 100, // reduce distribution for faster quotation
        poolProvider: SmartRouter.createStaticPoolProvider(swapPools),
        quoteProvider: this.quoteProvider,
        quoterOptimization: true,
      })
      if (!forwardTrade) throw new Error('no forward trade is found')
      // prepare for backward trade
      // exclude pools used in foward trade
      const pools = forwardTrade.routes.map(r => r.pools).flat()
      // FIXME: use universal identifier
      const poolAddresses = new Set(pools.map(p => (p as any).address))
      const swapPools2 = swapPools.filter((p : any) => !poolAddresses.has(p.address) )
      // backward trade
      // FIXME: getBestTrade for V2 may not compatable with Uniswap pair
      const backwardTrade = await SmartRouter.getBestTrade(forwardTrade.outputAmount, swapFrom, TradeType.EXACT_INPUT, {
        gasPriceWei,
        maxHops: 2,
        maxSplits: 1, // TODO:
        distributionPercent: 100,
        poolProvider: SmartRouter.createStaticPoolProvider(swapPools2),
        quoteProvider: this.quoteProvider,
        quoterOptimization: true,
      })
      if (!backwardTrade) throw new Error('no backward trade is found')
      // evaluate attack
      const tokenGain : CurrencyAmount<ERC20Token> = backwardTrade.outputAmount.subtract(swapFromAmount) as any
      return {
        swapFromAmount,
        swapTo,
        trades: [forwardTrade, backwardTrade],
        tokenGain,
      }
    } catch (e: any) {
      if (e.message === 'Cannot find a valid swap route') return null
      throw e
    }
  }

  async performAttack(attackPlan: AttackPlan) : Promise<AttackResult> {
    const { swapFromAmount, swapTo, trades } = attackPlan
    const swapFrom = swapFromAmount.currency
    const calldatas = trades.map(t => {
      const trade = prepareTradeForCustomContract(t)
      const { calldata } = SwapRouter.swapCallParameters(trade, {
        recipient: this.flashLoadSmartRouterAddress,
        slippageTolerance: new Percent(1), // TODO:
      })
      return calldata
    })
    // TODO: cache balance somewhere
    const tokenBalance0 = await getBalanceOfTokenOrNative(this.chainClient, this.account.address, swapFrom)
    const nativeBalance0 = await getBalanceOfTokenOrNative(this.chainClient, this.account.address , this.nativeCurrency)
    const swapFromBalance = swapFromAmount.numerator / swapFromAmount.denominator
    // approve
    const { request: req0 } = await this.chainClient.simulateContract({
      address: swapFrom.address,
      abi: ERC20.abi,
      functionName: 'approve',
      args: [this.flashLoadSmartRouterAddress, swapFromBalance],
      account: this.account,
    })
    let hash = await this.walletClient.writeContract(req0)
    // TODO: run contract
    const { request: req1, result: res1 } = await this.chainClient.simulateContract({
      account: this.account,
      address: this.flashLoadSmartRouterAddress,
      abi: FlashLoanSmartRouterInfo.abi,
      functionName: "trade",
      args: [swapFrom.address, swapFromBalance, calldatas[0], swapTo.address, calldatas[1]],
    })
    console.log(res1)
    hash = await this.walletClient.writeContract(req1)
    //
    const tokenBalance1 = await getBalanceOfTokenOrNative(this.chainClient, this.account.address, swapFrom)
    const nativeBalance1 = await getBalanceOfTokenOrNative(this.chainClient, this.account.address , this.nativeCurrency)
    return {
      attackPlan,
      tokenGain: CurrencyAmount.fromRawAmount(swapFrom, tokenBalance1 - tokenBalance0),
      nativeCurrencyChange: CurrencyAmount.fromRawAmount(this.nativeCurrency,nativeBalance1 - nativeBalance0),
      hash
    }
  }
}

export function transformToRoute(obj: any, tradeType: TradeType) : Route {
  return {
    // percent
    ...obj,
    type: obj.type as RouteType,
    inputAmount: transformToCurrencyAmount(obj.inputAmount),
    outputAmount: transformToCurrencyAmount(obj.outputAmount),
    path: obj.path.map(transformToCurrency),
    pools: obj.pools.map(transformToSwapPool),
  }
}

export function transformToTrade(obj: any) : SmartRouterTrade<TradeType> {
  return {
    // gasEstimate
    ...obj,
    inputAmount: transformToCurrencyAmount(obj.inputAmount),
    outputAmount: transformToCurrencyAmount(obj.outputAmount),
    routes: obj.routes.map(transformToRoute),
    gasEstimateInUSD: transformToCurrencyAmount(obj.gasEstimateInUSD),
  }
}

export function transformToAttackPlan(obj: any) : AttackPlan {
  return {
    // TODO: typing
    swapFromAmount: transformToCurrencyAmount(obj.swapFromAmount) as any,
    swapTo: transformToCurrency(obj.swapTo) as any,
    trades: obj.trades.map(transformToTrade),
    tokenGain: transformToCurrencyAmount(obj.tokenGain) as any,
  }
}
