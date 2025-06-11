import { Account, Chain, createWalletClient, formatEther, http, PublicClient, WalletClient } from "viem";
import { SmartRouter, SmartRouterTrade, SMART_ROUTER_ADDRESSES, SwapRouter, QuoteProvider } from '@pancakeswap/smart-router'
import { ChainId, CurrencyAmount, ERC20Token, Native, Percent, TradeType } from "@pancakeswap/sdk";
import { SwapPoolProvider } from "../swap-pool";
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json'

export type AttackPlan = {
  swapFrom: ERC20Token,
  swapTo: ERC20Token,
  swapFromAmount: bigint,
  trades: SmartRouterTrade<TradeType>[]
  tokenGain: bigint,
}

export type AttackResult = {
  attackPlan: AttackPlan,
  tokenGain: bigint,
  nativeCurrencyChange: bigint,
  hash: `0x${string}`,
  // TODO: estimate profit in usd
}

export class Arbitrage {
  chainClient: PublicClient;
  account: Account;
  swapPoolProvider: SwapPoolProvider;
  flashLoadSmartRouterAddress: `0x${string}`;
  nativeCurrency: Native;
  walletClient: WalletClient;
  smartRouterAddress: string;
  quoteProvider: QuoteProvider;

  constructor(chain: Chain, chainClient: PublicClient, account: Account, swapPoolProvider: SwapPoolProvider, flashLoadSmartRouterAddress: `0x${string}`) {
    this.chainClient = chainClient
    this.account = account
    this.swapPoolProvider = swapPoolProvider
    this.flashLoadSmartRouterAddress = flashLoadSmartRouterAddress
    this.nativeCurrency = Native.onChain(chain.id as ChainId)
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    })
    this.smartRouterAddress = SMART_ROUTER_ADDRESSES[chain.id as ChainId]
    this.quoteProvider = SmartRouter.createOffChainQuoteProvider()
  }

  async findBestAttack(swapFrom: ERC20Token, swapTo: ERC20Token, swapFromAmount: bigint, gasPriceWei: bigint) : Promise<AttackPlan> { // TODO: return type
    const swapPools = await this.swapPoolProvider.getPoolForTokens(swapFrom, swapTo)
    if (!swapPools || !swapPools.length) throw new Error('No pool is found')
    // TODO: exclude some pools
    // forward trade
    const amount = CurrencyAmount.fromRawAmount(swapFrom, swapFromAmount)
    const forwardTrade = await SmartRouter.getBestTrade(amount, swapTo, TradeType.EXACT_INPUT, {
      gasPriceWei,
      maxHops: 2,
      maxSplits: 1, // TODO:
      poolProvider: SmartRouter.createStaticPoolProvider(swapPools),
      quoteProvider: this.quoteProvider,
      quoterOptimization: true,
    })
    if (!forwardTrade) throw new Error('No forward trade is found')
    // prepare for backward trade
    // exclude pools used in foward trade
    const pools = forwardTrade.routes.map(r => r.pools).flat()
    const poolAddresses = new Set(pools.map(p => (p as any).address))
    const swapPools2 = swapPools.filter((p : any) => !poolAddresses.has(p.address) )
    // backward trade
    const backwardTrade = await SmartRouter.getBestTrade(forwardTrade.outputAmount, swapFrom, TradeType.EXACT_INPUT, {
      gasPriceWei,
      maxHops: 2,
      maxSplits: 1, // TODO:
      poolProvider: SmartRouter.createStaticPoolProvider(swapPools2),
      quoteProvider: this.quoteProvider,
      quoterOptimization: true,
    })
    if (!backwardTrade) throw new Error('No backward trade is found')
    // evaluate attack
    const tokenGain = backwardTrade.outputAmount.numerator - swapFromAmount
    return {
      swapFrom,
      swapTo,
      swapFromAmount,
      trades: [forwardTrade, backwardTrade], tokenGain
    }
  }
  
  async getBalanceOfTokenOrNative(address : `0x${string}` , token : Native | ERC20Token) : Promise<bigint> {
    if (token.isNative) {
      // bsc
      const balance = await this.chainClient.getBalance({
        address
      })
      return balance
    } else {
      const balance : any = await this.chainClient.readContract({
        address: token.address,
        abi: ERC20.abi,
        functionName: 'balanceOf',
        args: [address],
      })
      return balance
    }
  }

  prepareTradeForCustomContract(trade: SmartRouterTrade<TradeType>) {
    const inputAmount = CurrencyAmount.fromRawAmount(trade.inputAmount.currency, 0n) // get all transferred balance
    const outputAmount = CurrencyAmount.fromRawAmount(trade.outputAmount.currency, 0n) // no minimum output
    const updatedTrade : SmartRouterTrade<TradeType> = {
      ...trade,
      inputAmount,
      outputAmount,
      routes: [
        {
          ...trade.routes[0],
          inputAmount,
          outputAmount,
          percent: 100,
        }
      ]
    }
    return updatedTrade
  }

  async performAttack(attackPlan: AttackPlan) : Promise<AttackResult> {
    const { swapFrom, swapTo, swapFromAmount, trades } = attackPlan
    // const forwardTrade = this.prepareTradeForCustomContract(ft)
    // const backwardTrade = this.prepareTradeForCustomContract(bt)
    const calldatas = trades.map(t => {
      const trade = this.prepareTradeForCustomContract(t)
      const { calldata } = SwapRouter.swapCallParameters(trade, {
        recipient: this.flashLoadSmartRouterAddress,
        slippageTolerance: new Percent(1), // TODO:
      })
      return calldata
    })
    // TODO: cache balance somewhere
    const tokenBalance0 = await this.getBalanceOfTokenOrNative(this.account.address, swapFrom)
    const nativeBalance0 = await this.getBalanceOfTokenOrNative(this.account.address , this.nativeCurrency)
    // approve
    const { request } = await this.chainClient.simulateContract({
      address: swapFrom.address,
      abi: ERC20.abi,
      functionName: 'approve',
      args: [this.flashLoadSmartRouterAddress, swapFromAmount],
      account: this.account,
    })
    let hash = await this.walletClient.writeContract(request)
    const tokenBalance1 = await this.getBalanceOfTokenOrNative(this.account.address, swapFrom)
    const nativeBalance1 = await this.getBalanceOfTokenOrNative(this.account.address , this.nativeCurrency)
    return {
      attackPlan,
      tokenGain: tokenBalance1 - tokenBalance0,
      nativeCurrencyChange: nativeBalance1 - nativeBalance0,
      hash
    }
  }
}
