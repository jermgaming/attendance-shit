import Redis from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => console.error('Redis error:', err.message));
