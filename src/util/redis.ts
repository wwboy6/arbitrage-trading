import redis, { RedisClientType } from '@redis/client'

export type RedisClient = redis.RedisClientType<{}, {}, {}, 2, {}>
