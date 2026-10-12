import { query } from '../db/pool.js';

export async function writeAudit({ actorId = null, action, sessionId = null, ip = null, deviceId = null, meta = null }) {
  await query(
    `INSERT INTO audit_log (actor_id, action, session_id, ip_address, device_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, sessionId, ip, deviceId, meta ? JSON.stringify(meta) : null],
  );
}
