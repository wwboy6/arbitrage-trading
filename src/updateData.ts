import { Transformer } from '@pancakeswap/smart-router'
import fs from 'fs/promises'
import { parseSerializable } from './util'
import { CurrencyAmount, WBNB } from '@pancakeswap/sdk'

async function removeBadData () {
  for await (const filePath of fs.glob('./data/wbnb-usdt/attackPlan-*.json')) {
    const data = JSON.parse(await fs.readFile(filePath, { encoding: 'utf8' }))
    if (BigInt(data.tokenGain.numerator._value) < 100000000000000n) {
      await fs.rm(filePath)
    }
  }
}

function logAttackPlanData(attackPlan: any) {
  // log pools
  let poolDes: string[] = []
  let inputTokenAddress = attackPlan.swapFromAmount.currency.address
  const pools = [...attackPlan.trades[0].routes[0].pools, ...attackPlan.trades[1].routes[0].pools]
  for (const pool of pools) {
    const token0 = pool.token0 ? pool.token0 : pool.reserve0.currency
    const token1 = pool.token1 ? pool.token1 : pool.reserve1.currency
    const outputToken = token0.address === inputTokenAddress ? token1 : token0
    poolDes = [...poolDes, `${pool.type}-${outputToken.symbol}`]
    // prepare for next one
    inputTokenAddress = outputToken.address
  }
  const amount = CurrencyAmount.fromRawAmount(WBNB[56], attackPlan.tokenGain.numerator)
  const desc = `gain:${amount.toFixed(5)} tokens:${poolDes}`
  return desc
}

async function descAttackPlans() {
  for await (const filePath of fs.glob('./data/wbnb-usdt/attackPlan-*.json')) {
    const data = parseSerializable(JSON.parse(await fs.readFile(filePath, { encoding: 'utf8' })))
    const [timeStr] = filePath.match(/attackPlan-(.*?)\.json/) ?? []
    if (!timeStr) {
      console.log(`error: ${filePath}`)
      continue
    }
    const attackPlanDesc = logAttackPlanData(data)
    const log = `${timeStr} perform attack ${attackPlanDesc}`
    console.log(log)
  }
}

async function main () {
  // await removeBadData()
  await descAttackPlans()
}

main()
