import crypto from 'node:crypto';
import { redis } from '../redis.js';
import { query } from '../db/pool.js';
import { config, isAllowedEmailDomain } from '../config.js';
import { errors } from '../utils/errors.js';
import { sendOtpEmailSafe } from './mailService.js';

const OTP_TTL = 300;
const ATTEMPTS_TTL = 600;
const REQUESTS_TTL = 900;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS = 3;

function hashOtp(code) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`otp:${code}`).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

export async function requestOtp(email) {
  if (!isAllowedEmailDomain(email)) throw errors.emailDomainNotAllowed();

  const requestsKey = `otp:requests:${email}`;
  const requests = await redis.incr(requestsKey);
  if (requests === 1) await redis.expire(requestsKey, REQUESTS_TTL);
  if (requests > MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(await redis.ttl(requestsKey), 1);
    throw errors.rateLimited(retryAfterSeconds);
  }

  const { rows } = await query('SELECT id, role FROM users WHERE email = $1 AND is_active = true', [email]);
  if (!rows.length) {
    return { delivered: false, expiresInSeconds: OTP_TTL };
  }

  const code = generateOtpCode();
  await redis.set(`otp:${email}`, hashOtp(code), 'EX', OTP_TTL);
  await redis.del(`otp:attempts:${email}`);
  sendOtpEmailSafe(email, code);
  return { delivered: true, expiresInSeconds: OTP_TTL };
}

export async function verifyOtpCode(email, code) {
  const stored = await redis.get(`otp:${email}`);
  if (!stored) throw errors.invalidOtp();

  const attemptsKey = `otp:attempts:${email}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, ATTEMPTS_TTL);
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(`otp:${email}`);
    throw errors.invalidOtp();
  }

  if (!safeEqual(stored, hashOtp(code))) throw errors.invalidOtp();

  await redis.del(`otp:${email}`, `otp:attempts:${email}`);
  return true;
}

export async function setStepUpProof(userId) {
  await redis.set(`stepup:${userId}`, '1', 'EX', 120);
}

export async function consumeStepUpProof(userId) {
  const result = await redis.del(`stepup:${userId}`);
  return result === 1;
}
