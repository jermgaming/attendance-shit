import crypto from 'node:crypto';
import { redis } from '../redis.js';
import { query } from '../db/pool.js';
import { errors } from '../utils/errors.js';
import { toTeachers } from '../sockets/emitter.js';
import { closeSession, rebuildPresentSet } from './attendanceService.js';

const timers = new Map();
const PAUSED_KEY_TTL = 7200;

function randomCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

async function storeCode(sessionId, intervalSeconds) {
  const code = randomCode();
  const ttl = intervalSeconds + 5;
  const previous = await redis.get(`code:current:${sessionId}`);
  if (previous) await redis.set(`code:previous:${sessionId}`, previous, 'EX', ttl);
  await redis.set(`code:current:${sessionId}`, code, 'EX', ttl);
  const windowId = await redis.incr(`code:window:${sessionId}`);
  await redis.expire(`code:window:${sessionId}`, ttl);
  return { code, windowId };
}

function stopTimer(sessionId) {
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.delete(sessionId);
}

async function scheduleNext(sessionId) {
  stopTimer(sessionId);
  const { rows } = await query(
    `SELECT status, rotation_interval_seconds, rotation_paused FROM class_sessions WHERE id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (!session || session.status !== 'open' || session.rotation_paused) return;
  const timer = setTimeout(() => {
    tick(sessionId).catch((err) => console.error(`Rotation tick failed for ${sessionId}:`, err.message));
  }, session.rotation_interval_seconds * 1000);
  timers.set(sessionId, timer);
}

async function tick(sessionId) {
  await rotate(sessionId);
  await scheduleNext(sessionId);
}

export async function rotate(sessionId) {
  const { rows } = await query(
    `SELECT status, rotation_interval_seconds FROM class_sessions WHERE id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (!session || session.status !== 'open') {
    stopTimer(sessionId);
    return null;
  }
  const { code, windowId } = await storeCode(sessionId, session.rotation_interval_seconds);
  toTeachers(sessionId, 'code:updated', {
    sessionId,
    code,
    validForSeconds: session.rotation_interval_seconds,
    intervalSeconds: session.rotation_interval_seconds,
    windowId,
  });
  return { code, windowId };
}

export async function startRotation(session) {
  stopTimer(session.id);
  if (session.rotation_paused) return;
  const result = await rotate(session.id);
  await scheduleNext(session.id);
  return result;
}

export function stopRotation(sessionId) {
  stopTimer(sessionId);
}

export async function pauseRotation(sessionId) {
  stopTimer(sessionId);
  for (const key of [`code:current:${sessionId}`, `code:previous:${sessionId}`, `code:window:${sessionId}`]) {
    await redis.expire(key, PAUSED_KEY_TTL);
  }
}

export async function resumeRotation(sessionId) {
  await rotate(sessionId);
  await scheduleNext(sessionId);
}

export async function rotateNow(sessionId) {
  return resumeRotation(sessionId);
}

export async function setRotationInterval(sessionId, intervalSeconds) {
  await query(`UPDATE class_sessions SET rotation_interval_seconds = $1 WHERE id = $2`, [intervalSeconds, sessionId]);
  await scheduleNext(sessionId);
}

export async function getCodePayload(session) {
  if (session.status !== 'open') throw errors.sessionClosed();
  if (session.rotation_paused) {
    const code = await redis.get(`code:current:${session.id}`);
    const windowId = Number(await redis.get(`code:window:${session.id}`) || 0);
    if (!code) await rotate(session.id);
    return {
      code: code || '',
      validForSeconds: null,
      paused: true,
      intervalSeconds: session.rotation_interval_seconds,
      windowId,
    };
  }
  let code = await redis.get(`code:current:${session.id}`);
  if (!code) {
    await rotate(session.id);
    code = await redis.get(`code:current:${session.id}`);
  }
  const windowId = Number(await redis.get(`code:window:${session.id}`) || 0);
  const pttl = await redis.pttl(`code:current:${session.id}`);
  return {
    code,
    validForSeconds: Math.max(0, Math.ceil((pttl - 5000) / 1000)),
    paused: false,
    intervalSeconds: session.rotation_interval_seconds,
    windowId,
  };
}

export async function recoverOpenSessions() {
  const { rows } = await query(`SELECT * FROM class_sessions WHERE status = 'open'`);
  for (const session of rows) {
    if (session.auto_close_at && session.auto_close_at < new Date()) {
      await closeSession(session.id, null, { reason: 'auto_close_at passed while the server was down' });
      continue;
    }
    await rebuildPresentSet(session.id);
    await startRotation(session);
  }
  if (rows.length) console.log(`Recovered ${rows.length} open session(s).`);
}
