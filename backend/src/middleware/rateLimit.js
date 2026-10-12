import { redis } from '../redis.js';
import { clientIp } from '../utils/ip.js';
import { errors } from '../utils/errors.js';

export async function slidingRateLimit(key, limit, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  const ttl = await redis.ttl(key);
  return { allowed: count <= limit, retryAfterSeconds: Math.max(ttl, 1) };
}

export function ipRateLimit({ route, limit = 10, windowSeconds = 60 }) {
  return async (req, _res, next) => {
    try {
      const key = `rl:ip:${clientIp(req)}:${route}`;
      const { allowed, retryAfterSeconds } = await slidingRateLimit(key, limit, windowSeconds);
      if (!allowed) return next(errors.rateLimited(retryAfterSeconds));
      next();
    } catch (err) {
      next(err);
    }
  };
}
