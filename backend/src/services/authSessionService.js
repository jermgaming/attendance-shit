import crypto from 'node:crypto';
import { redis } from '../redis.js';
import { config } from '../config.js';

export async function createAuthSession(userId, role, deviceId) {
  const token = crypto.randomBytes(32).toString('hex');
  const key = `auth:session:${token}`;
  await redis
    .multi()
    .hset(key, 'userId', userId, 'role', role, 'deviceId', deviceId || '')
    .expire(key, config.sessionTtlSeconds)
    .sadd(`auth:user-sessions:${userId}`, token)
    .expire(`auth:user-sessions:${userId}`, config.sessionTtlSeconds)
    .exec();
  return {
    token,
    expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString(),
  };
}

export async function getAuthSession(token) {
  const data = await redis.hgetall(`auth:session:${token}`);
  if (!data || !data.userId) return null;
  return { userId: data.userId, role: data.role, deviceId: data.deviceId || null };
}

export async function destroyAuthSession(token) {
  const session = await getAuthSession(token);
  if (!session) return;
  await redis
    .multi()
    .del(`auth:session:${token}`)
    .srem(`auth:user-sessions:${session.userId}`, token)
    .exec();
}

export async function destroyUserSessions(userId) {
  const tokens = await redis.smembers(`auth:user-sessions:${userId}`);
  if (tokens.length) {
    await redis.del(tokens.map((t) => `auth:session:${t}`));
  }
  await redis.del(`auth:user-sessions:${userId}`);
}
