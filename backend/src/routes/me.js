import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/attendance', requireRole('student'), asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
  const where = [`a.student_id = $1`];
  const params = [req.user.id];
  if (req.query.from) { params.push(String(req.query.from)); where.push(`s.started_at >= $${params.length}::timestamptz`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`s.started_at <= $${params.length}::timestamptz`); }
  if (req.query.subject) { params.push(`%${req.query.subject}%`); where.push(`s.subject ILIKE $${params.length}`); }

  const whereSql = where.join(' AND ');
  const totalRes = await query(
    `SELECT count(*)::int AS count FROM attendance a JOIN class_sessions s ON s.id = a.session_id WHERE ${whereSql}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT a.session_id AS "sessionId", s.subject, s.section, s.started_at AS "startedAt",
            a.status, a.marked_at AS "markedAt", a.marked_by AS "markedBy"
     FROM attendance a JOIN class_sessions s ON s.id = a.session_id
     WHERE ${whereSql} ORDER BY s.started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ records: rows, page, pageSize, total: totalRes.rows[0].count });
}));

router.get('/attendance/summary', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.subject,
            count(*) FILTER (WHERE a.status IN ('present','excused'))::int AS attended,
            count(*)::int AS total
     FROM attendance a JOIN class_sessions s ON s.id = a.session_id
     WHERE a.student_id = $1
     GROUP BY s.subject ORDER BY s.subject`,
    [req.user.id],
  );
  const overall = rows.reduce(
    (acc, r) => ({ attended: acc.attended + r.attended, total: acc.total + r.total }),
    { attended: 0, total: 0 },
  );
  res.json({
    overall: {
      ...overall,
      percentage: overall.total ? Math.round((overall.attended / overall.total) * 1000) / 10 : 0,
    },
    bySubject: rows.map((r) => ({
      ...r,
      percentage: r.total ? Math.round((r.attended / r.total) * 1000) / 10 : 0,
    })),
  });
}));

export default router;
