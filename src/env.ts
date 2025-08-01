import dotenv from 'dotenv'
dotenv.config()

import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  INFURA_KEY: z.string(),
  PRIVATE_KEY: z.string().startsWith("0x").transform<`0x${string}`>((s: any) => s),
  PINO_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PancakeswapArbitrageAddress: z.string().startsWith('0x').transform<`0x${string}`>((s: any) => s),
  TOKEN0: z.string(),
  TOKEN1: z.string(),
  SwapFromAmount: z.string().transform<bigint>(s => BigInt(s)),
  THE_GRAPH_KEY: z.string(),
  RedisUrl: z.string(),
  PROXY_URL: z.string(),
  PREFERRED_TOKENS: z.string().transform(s => s.split(',')),
  V2_POOL_TOP: z.string().transform(s => Number(s)),
  LINKED_TOKEN_PICK: z.string().transform(s => Number(s)),
  PROFIT_THRESHOLD: z.string().transform(s => Number(s)),
  ZAN_API_KEY: z.string(),
});
export default envSchema.parse(process.env);
