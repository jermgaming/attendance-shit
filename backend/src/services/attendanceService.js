import fs from 'node:fs/promises';
import { query, pool } from '../db/pool.js';
import { redis } from '../redis.js';
import { config } from '../config.js';
import { errors } from '../utils/errors.js';
import { writeAudit } from './auditService.js';
import { consumeStepUpProof } from './otpService.js';
import { runProxyChecks, recordCodeFailure } from './flagService.js';
import { stopRotation } from './rotationService.js';
import { toSessionRoom, toTeachers } from '../sockets/emitter.js';

const PRESENT_SET_TTL = 24 * 3600;

export async function rosterCountForSession(session) {
  const { rows } = await query(
    `SELECT count(*)::int AS count FROM users WHERE role = 'student' AND is_active AND ($1::text IS NULL OR section = $1)`,
    [session.section],
  );
  return rows[0].count;
}

export async function rebuildPresentSet(sessionId) {
  const { rows } = await query(
    `SELECT student_id FROM attendance WHERE session_id = $1 AND status = 'present'`,
    [sessionId],
  );
  if (rows.length) await redis.sadd(`present:${sessionId}`, ...rows.map((r) => r.student_id));
  await redis.expire(`present:${sessionId}`, PRESENT_SET_TTL);
}

export async function countsForSession(session) {
  const total = await rosterCountForSession(session);
  let present;
  if (session.status === 'open') {
    present = await redis.scard(`present:${session.id}`);
  } else {
    const { rows } = await query(
      `SELECT count(*)::int AS count FROM attendance WHERE session_id = $1 AND status = 'present'`,
      [session.id],
    );
    present = rows[0].count;
  }
  return { present, absent: Math.max(total - present, 0), total };
}

export async function markPresent({ session, student, code, ip, deviceId }) {
  if (config.enableDeviceBinding && student.boundDeviceId && deviceId !== student.boundDeviceId) {
    throw errors.deviceMismatch();
  }

  if (config.requireFreshOtpOnMark) {
    const hasProof = await consumeStepUpProof(student.id);
    if (!hasProof) {
      throw errors.forbidden('Fresh OTP verification is required before marking.', { reason: 'STEP_UP_REQUIRED' });
    }
  }

  const attemptsKey = `mark:attempts:${session.id}:${student.id}`;
  const attempts = Number(await redis.get(attemptsKey) || 0);
  if (attempts >= 5) {
    throw errors.rateLimited(Math.max(await redis.ttl(attemptsKey), 1));
  }

  const current = await redis.get(`code:current:${session.id}`);
  const previous = await redis.get(`code:previous:${session.id}`);
  if (!current || (code !== current && code !== previous)) {
    const n = await redis.incr(attemptsKey);
    if (n === 1) await redis.expire(attemptsKey, 60);
    await recordCodeFailure({ sessionId: session.id, student });
    throw errors.invalidCode();
  }
  await redis.del(attemptsKey);

  const added = await redis.sadd(`present:${session.id}`, student.id);
  await redis.expire(`present:${session.id}`, PRESENT_SET_TTL);
  if (added === 0) throw errors.alreadyMarked();

  const windowId = await redis.get(`code:window:${session.id}`);
  const markedAt = new Date();
  try {
    await query(
      `INSERT INTO attendance (session_id, student_id, status, marked_by, ip_address, device_id, code_window)
       VALUES ($1, $2, 'present', 'student', $3::inet, $4, $5)`,
      [session.id, student.id, ip, deviceId, windowId],
    );
  } catch (err) {
    if (err.code === '23505') throw errors.alreadyMarked();
    await redis.srem(`present:${session.id}`, student.id);
    throw err;
  }

  const counts = await countsForSession(session);
  await writeAudit({
    actorId: student.id,
    action: 'MARK',
    sessionId: session.id,
    ip,
    deviceId,
    meta: { window: windowId ? Number(windowId) : null },
  });
  runProxyChecks({ sessionId: session.id, student, ip, deviceId }).catch((err) =>
    console.error('Flag check failed:', err.message),
  );
  toTeachers(session.id, 'attendance:marked', {
    sessionId: session.id,
    student: { id: student.id, name: student.name, rollNumber: student.rollNumber },
    markedAt: markedAt.toISOString(),
    counts,
  });

  return { status: 'present', markedAt: markedAt.toISOString(), subject: session.subject };
}

export async function closeSession(sessionId, actorId, { reason = null } = {}) {
  const client = await pool.connect();
  let session;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM class_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    session = rows[0];
    if (!session) throw errors.notFound('Session does not exist.');
    if (session.status === 'closed') throw errors.sessionClosed();

    await client.query(
      `UPDATE class_sessions SET status = 'closed', closed_at = now() WHERE id = $1`,
      [sessionId],
    );
    await client.query(
      `INSERT INTO attendance (session_id, student_id, status, marked_by, note)
       SELECT $1, u.id, 'absent', 'teacher', 'Auto-marked absent at session close'
       FROM users u
       WHERE u.role = 'student' AND u.is_active AND ($2::text IS NULL OR u.section = $2)
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = $1 AND a.student_id = u.id)`,
      [sessionId, session.section],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  stopRotation(sessionId);
  await redis.del(
    `code:current:${sessionId}`,
    `code:previous:${sessionId}`,
    `code:window:${sessionId}`,
    `present:${sessionId}`,
  );
  const failKeys = await redis.keys(`codefails:${sessionId}:*`);
  if (failKeys.length) await redis.del(failKeys);

  await fs.writeFile(config.backupTriggerPath, String(Date.now())).catch((err) =>
    console.error('Backup trigger failed:', err.message),
  );
  await writeAudit({ actorId, action: 'SESSION_CLOSE', sessionId, meta: reason ? { reason } : null });

  session.status = 'closed';
  const counts = await countsForSession(session);
  toSessionRoom(sessionId, 'session:closed', { sessionId, counts });
  return counts;
}

async function flaggedStudentIds(sessionId) {
  const { rows } = await query(
    `SELECT meta FROM audit_log WHERE session_id = $1 AND action = 'FLAG'`,
    [sessionId],
  );
  const ids = new Set();
  for (const row of rows) {
    for (const id of row.meta?.studentIds || []) ids.add(id);
  }
  return ids;
}

export async function getLiveAttendance(session, { status = 'all', search = null } = {}) {
  const searchClause = search ? `AND (name ILIKE $2 OR roll_number ILIKE $2 OR email ILIKE $2)` : '';
  const searchParam = search ? `%${search}%` : null;
  const { rows: roster } = await query(
    `SELECT id, name, roll_number AS "rollNumber", email FROM users
     WHERE role = 'student' AND is_active AND ($1::text IS NULL OR section = $1) ${searchClause}
     ORDER BY roll_number NULLS LAST, name`,
    [session.section, searchParam].filter((p, i) => search || i === 0),
  );

  const marks = new Map();
  if (session.status === 'open') {
    if (!(await redis.exists(`present:${session.id}`))) await rebuildPresentSet(session.id);
    const presentIds = new Set(await redis.smembers(`present:${session.id}`));
    if (presentIds.size) {
      const { rows } = await query(
        `SELECT student_id, marked_at, marked_by, note FROM attendance
         WHERE session_id = $1 AND student_id = ANY($2)`,
        [session.id, [...presentIds]],
      );
      for (const row of rows) {
        marks.set(row.student_id, {
          status: 'present',
          markedAt: row.marked_at,
          markedBy: row.marked_by,
          note: row.note,
        });
      }
    }
    for (const student of roster) {
      if (!marks.has(student.id) && presentIds.has(student.id)) {
        marks.set(student.id, { status: 'present', markedAt: null, markedBy: 'student', note: null });
      }
    }
  } else {
    const { rows } = await query(
      `SELECT student_id, status, marked_at, marked_by, note FROM attendance WHERE session_id = $1`,
      [session.id],
    );
    for (const row of rows) {
      marks.set(row.student_id, {
        status: row.status,
        markedAt: row.marked_at,
        markedBy: row.marked_by,
        note: row.note,
      });
    }
  }

  const flagged = await flaggedStudentIds(session.id);
  const students = roster
    .map((student) => {
      const mark = marks.get(student.id);
      return {
        studentId: student.id,
        name: student.name,
        rollNumber: student.rollNumber,
        email: student.email,
        status: mark?.status || 'absent',
        markedAt: mark?.markedAt || null,
        markedBy: mark?.markedBy || null,
        note: mark?.note || null,
        flagged: flagged.has(student.id),
      };
    })
    .filter((s) => status === 'all' || s.status === status);

  const counts = await countsForSession(session);
  return { sessionId: session.id, counts, students };
}

export async function overrideAttendance({ session, studentId, status, note, actor, ip }) {
  if (!['present', 'absent', 'excused'].includes(status)) {
    throw errors.validation('Status must be present, absent or excused.');
  }
  const { rows } = await query(
    `INSERT INTO attendance (session_id, student_id, status, marked_by, ip_address, note)
     VALUES ($1, $2, $3, 'teacher', $4::inet, $5)
     ON CONFLICT (session_id, student_id) DO UPDATE
       SET status = EXCLUDED.status, note = EXCLUDED.note, marked_by = 'teacher', marked_at = now()
     RETURNING student_id, status, marked_at, marked_by, note`,
    [session.id, studentId, status, ip, note || null],
  );
  if (!rows.length) throw errors.notFound('Student does not exist.');
  const row = rows[0];

  if (session.status === 'open') {
    if (status === 'present') {
      await redis.sadd(`present:${session.id}`, studentId);
      await redis.expire(`present:${session.id}`, PRESENT_SET_TTL);
    } else {
      await redis.srem(`present:${session.id}`, studentId);
    }
  }

  const counts = await countsForSession(session);
  await writeAudit({
    actorId: actor.id,
    action: 'OVERRIDE',
    sessionId: session.id,
    ip,
    meta: { studentId, status, note: note || null },
  });
  toTeachers(session.id, 'attendance:updated', { sessionId: session.id, studentId, status, counts });
  return { ...row, counts };
}

export async function getSessionFlags(sessionId) {
  const { rows } = await query(
    `SELECT meta, created_at FROM audit_log
     WHERE session_id = $1 AND action = 'FLAG' ORDER BY created_at DESC`,
    [sessionId],
  );
  return {
    flags: rows.map((row) => ({
      type: row.meta?.type,
      studentIds: row.meta?.studentIds || [],
      detail: row.meta?.detail || '',
      createdAt: row.created_at,
    })),
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportAttendanceRows(sessionId) {
  const { rows } = await query(
    `SELECT u.roll_number, u.name, u.email, a.status, a.marked_at, a.marked_by, a.note
     FROM attendance a JOIN users u ON u.id = a.student_id
     WHERE a.session_id = $1
     ORDER BY u.roll_number NULLS LAST, u.name`,
    [sessionId],
  );
  return rows;
}

export function rowsToCsv(rows) {
  const header = ['Roll Number', 'Name', 'Email', 'Status', 'Marked At', 'Marked By', 'Note'];
  const lines = rows.map((r) =>
    [r.roll_number, r.name, r.email, r.status, r.marked_at, r.marked_by, r.note].map(csvEscape).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
