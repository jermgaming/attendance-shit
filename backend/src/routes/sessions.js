import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, errors } from '../utils/errors.js';
import { writeAudit } from '../services/auditService.js';
import * as rotation from '../services/rotationService.js';
import {
  closeSession,
  countsForSession,
  exportAttendanceRows,
  getLiveAttendance,
  getSessionFlags,
  overrideAttendance,
  rosterCountForSession,
  rowsToCsv,
} from '../services/attendanceService.js';
import { toStudents } from '../sockets/emitter.js';
import { clientIp } from '../utils/ip.js';

const router = Router();

const createSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  section: z.string().trim().max(50).optional().nullable(),
  durationMinutes: z.number().int().min(1).max(720).default(60),
  rotationIntervalSeconds: z.number().int().min(15).max(30).default(config.rotationIntervalDefault),
});

const rotationSchema = z.object({
  paused: z.boolean().optional(),
  intervalSeconds: z.number().int().min(15).max(30).optional(),
  rotateNow: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update.' });

const overrideSchema = z.object({
  status: z.enum(['present', 'absent', 'excused']),
  note: z.string().max(500).optional().nullable(),
});

export async function loadSession(id) {
  const { rows } = await query('SELECT * FROM class_sessions WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Session does not exist.');
  return rows[0];
}

export function assertSessionAccess(user, session) {
  if (user.role === 'admin') return;
  if (user.role === 'teacher' && session.teacher_id === user.id) return;
  throw errors.forbidden('You can only manage your own sessions.');
}

function mapSession(row) {
  return {
    id: row.id,
    subject: row.subject,
    section: row.section,
    status: row.status,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    autoCloseAt: row.auto_close_at,
    rotationIntervalSeconds: row.rotation_interval_seconds,
    rotationPaused: row.rotation_paused,
    teacherName: row.teacher_name || undefined,
    teacherId: row.teacher_id,
  };
}

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { subject, section, durationMinutes, rotationIntervalSeconds } = req.body;
  const open = await query(
    `SELECT id FROM class_sessions WHERE teacher_id = $1 AND status = 'open'`,
    [req.user.id],
  );
  if (open.rows.length) throw errors.sessionAlreadyOpen();

  try {
    const { rows } = await query(
      `INSERT INTO class_sessions (teacher_id, subject, section, auto_close_at, rotation_interval_seconds)
       VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, $5) RETURNING *`,
      [req.user.id, subject, section || null, String(durationMinutes), rotationIntervalSeconds],
    );
    const session = rows[0];
    await rotation.startRotation(session);
    await writeAudit({ actorId: req.user.id, action: 'SESSION_OPEN', sessionId: session.id });
    toStudents('session:opened', {
      sessionId: session.id,
      subject: session.subject,
      section: session.section,
      teacherName: req.user.name,
    });
    res.status(201).json(mapSession(session));
  } catch (err) {
    if (err.code === '23505') throw errors.sessionAlreadyOpen();
    throw err;
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
  const where = [`true`];
  const params = [];
  if (req.user.role === 'teacher') {
    params.push(req.user.id);
    where.push(`s.teacher_id = $${params.length}`);
  }
  if (req.query.status === 'open' || req.query.status === 'closed') {
    params.push(req.query.status);
    where.push(`s.status = $${params.length}`);
  }
  if (req.query.subject) {
    params.push(`%${req.query.subject}%`);
    where.push(`s.subject ILIKE $${params.length}`);
  }
  if (req.query.from) {
    params.push(String(req.query.from));
    where.push(`s.started_at >= $${params.length}::timestamptz`);
  }
  if (req.query.to) {
    params.push(String(req.query.to));
    where.push(`s.started_at <= $${params.length}::timestamptz`);
  }

  const baseWhere = where.join(' AND ');
  const totalRes = await query(
    `SELECT count(*)::int AS count FROM class_sessions s WHERE ${baseWhere}`, params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT s.*, u.name AS teacher_name FROM class_sessions s
     JOIN users u ON u.id = s.teacher_id
     WHERE ${baseWhere} ORDER BY s.started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ sessions: rows.map(mapSession), page, pageSize, total: totalRes.rows[0].count });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const { rows } = await query('SELECT name FROM users WHERE id = $1', [session.teacher_id]);
  const counts = await countsForSession(session);
  res.json({
    ...mapSession({ ...session, teacher_name: rows[0]?.name }),
    presentCount: counts.present,
    rosterCount: counts.total,
  });
}));

router.patch('/:id/close', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const counts = await closeSession(session.id, req.user.id);
  res.json({ counts });
}));

router.patch('/:id/rotation', validate(rotationSchema), asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  if (session.status !== 'open') throw errors.sessionClosed();

  const { paused, intervalSeconds, rotateNow } = req.body;
  if (intervalSeconds !== undefined) {
    await rotation.setRotationInterval(session.id, intervalSeconds);
  }
  if (paused === true) {
    await query('UPDATE class_sessions SET rotation_paused = true WHERE id = $1', [session.id]);
    await rotation.pauseRotation(session.id);
  } else if (paused === false) {
    await query('UPDATE class_sessions SET rotation_paused = false WHERE id = $1', [session.id]);
    await rotation.resumeRotation(session.id);
  } else if (rotateNow) {
    await rotation.rotateNow(session.id);
  }

  const { rows } = await query(
    'SELECT rotation_paused, rotation_interval_seconds FROM class_sessions WHERE id = $1',
    [session.id],
  );
  res.json({
    paused: rows[0].rotation_paused,
    intervalSeconds: rows[0].rotation_interval_seconds,
  });
}));

router.get('/:id/code', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const payload = await rotation.getCodePayload(session);
  if (payload.code === undefined || payload.code === '') throw errors.sessionClosed();
  res.json(payload);
}));

router.get('/:id/attendance', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const status = ['present', 'absent'].includes(String(req.query.status)) ? String(req.query.status) : 'all';
  const search = req.query.search ? String(req.query.search) : null;
  res.json(await getLiveAttendance(session, { status, search }));
}));

router.patch('/:id/attendance/:studentId', validate(overrideSchema), asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const result = await overrideAttendance({
    session,
    studentId: req.params.studentId,
    status: req.body.status,
    note: req.body.note,
    actor: req.user,
    ip: clientIp(req),
  });
  res.json(result);
}));

router.get('/:id/flags', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  res.json(await getSessionFlags(session.id));
}));

router.get('/:id/export', asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  assertSessionAccess(req.user, session);
  const rows = await exportAttendanceRows(session.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `attendance-${session.subject.replace(/[^\w-]+/g, '_')}-${stamp}`;

  if (req.query.format === 'xlsx') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');
    sheet.columns = [
      { header: 'Roll Number', key: 'roll_number', width: 14 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Marked At', key: 'marked_at', width: 26 },
      { header: 'Marked By', key: 'marked_by', width: 12 },
      { header: 'Note', key: 'note', width: 40 },
    ];
    for (const row of rows) sheet.addRow({ ...row, marked_at: row.marked_at?.toISOString?.() || row.marked_at });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
  res.send(rowsToCsv(rows));
}));

export default router;
