import { Router } from 'express';
import os from 'node:os';
import { pool } from '../db/pool.js';
import { redis } from '../redis.js';
import { config } from '../config.js';

const router = Router();

function lanAddress() {
  if (config.publicUrl) return config.publicUrl;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) return `http://${addr.address}:${config.port}`;
    }
  }
  return null;
}

router.get('/health', async (_req, res) => {
  let db = 'down';
  let redisStatus = 'down';
  try {
    await pool.query('SELECT 1');
    db = 'up';
  } catch { /* down */ }
  try {
    if ((await redis.ping()) === 'PONG') redisStatus = 'up';
  } catch { /* down */ }
  const status = db === 'up' && redisStatus === 'up' ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    db,
    redis: redisStatus,
    time: new Date().toISOString(),
    lan: lanAddress(),
  });
});

export default router;
