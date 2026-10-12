import { redis } from '../redis.js';
import { query } from '../db/pool.js';
import { writeAudit } from './auditService.js';
import { toTeachers } from '../sockets/emitter.js';

function sameStudentSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

async function createFlag({ sessionId, type, studentIds, detail }) {
  const { rows } = await query(
    `SELECT meta FROM audit_log WHERE session_id = $1 AND action = 'FLAG'`,
    [sessionId],
  );
  const duplicate = rows.some((r) => r.meta?.type === type && sameStudentSet(r.meta.studentIds, studentIds));
  if (duplicate) return;

  await writeAudit({ action: 'FLAG', sessionId, meta: { type, studentIds, detail } });
  toTeachers(sessionId, 'flag:raised', { sessionId, type, studentIds, detail });
}

export async function runProxyChecks({ sessionId, student, ip, deviceId }) {
  if (ip) {
    const sharedIp = await query(
      `SELECT DISTINCT student_id FROM attendance
       WHERE session_id = $1 AND ip_address = $2::inet AND student_id <> $3
         AND marked_at BETWEEN now() - interval '15 seconds' AND now() + interval '15 seconds'`,
      [sessionId, ip, student.id],
    );
    if (sharedIp.rows.length) {
      await createFlag({
        sessionId,
        type: 'SHARED_IP',
        studentIds: [student.id, ...sharedIp.rows.map((r) => r.student_id)],
        detail: `${sharedIp.rows.length + 1} marks within 15 seconds from ${ip}`,
      });
    }
  }

  if (deviceId) {
    const sharedDevice = await query(
      `SELECT DISTINCT student_id FROM attendance
       WHERE session_id = $1 AND device_id = $2 AND student_id <> $3`,
      [sessionId, deviceId, student.id],
    );
    if (sharedDevice.rows.length) {
      await createFlag({
        sessionId,
        type: 'SHARED_DEVICE',
        studentIds: [student.id, ...sharedDevice.rows.map((r) => r.student_id)],
        detail: `${sharedDevice.rows.length + 1} students marked from device ${deviceId}`,
      });
    }
  }
}

export async function recordCodeFailure({ sessionId, student }) {
  const key = `codefails:${sessionId}:${student.id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 86400);
  if (count >= 5) {
    await createFlag({
      sessionId,
      type: 'CODE_FAILURES',
      studentIds: [student.id],
      detail: `${count} wrong codes submitted in this session`,
    });
  }
  return count;
}
