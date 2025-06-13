import { Currency, CurrencyAmount, Native, TradeType } from "@pancakeswap/sdk"
import { PublicClient } from "viem"
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { SmartRouterTrade } from "@pancakeswap/smart-router"

export async function getBalanceOfTokenOrNative(chainClient: PublicClient, address : `0x${string}` , token : Currency) : Promise<bigint> {
  if (token.isNative) {
    // bsc
    const balance = await chainClient.getBalance({
      address
    })
    return balance
  } else {
    const balance : any = await chainClient.readContract({
      address: token.address,
      abi: ERC20.abi,
      functionName: 'balanceOf',
      args: [address],
    })
    return balance
  }
}

export function prepareTradeForCustomContract(trade: SmartRouterTrade<TradeType>) {
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
