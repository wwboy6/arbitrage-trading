import dotenv from 'dotenv'
dotenv.config()

import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  INFURA_KEY: z.string(),
  PRIVATE_KEY: z.string().startsWith("0x").transform<`0x${string}`>((s: any) => s),
  PINO_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FlashLoanSmartRouterAddress: z.string().startsWith('0x').transform<`0x${string}`>((s: any) => s),
  TOKEN0: z.string(),
  TOKEN1: z.string(),
  SwapFromAmount: z.string().transform<bigint>(s => BigInt(s)),
  THE_GRAPH_KEY: z.string(),
  RedisUrl: z.string(),
  PROXY_URL: z.string(),
  LINKED_TOKEN_PICK: z.string().transform(s => Number(s)),
});
export default envSchema.parse(process.env);
