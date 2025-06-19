import fs from 'fs/promises'

async function main () {
  for await (const filePath of fs.glob('./data/wbnb-usdt/*.json')) {
    const data = JSON.parse(await fs.readFile(filePath, { encoding: 'utf8' }))
    if (!data.tokenGain) continue
    if (BigInt(data.tokenGain.numerator._value) < 100000000000000n) {
      await fs.rm(filePath)
    }
  }
}

main()
