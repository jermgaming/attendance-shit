import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler, errors } from '../utils/errors.js';

const router = Router();

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function summaryRows({ section, subject, from, to }) {
  const where = [`u.role = 'student'`, `u.is_active = true`];
  const params = [];
  if (section) { params.push(section); where.push(`u.section = $${params.length}`); }
  if (subject) { params.push(`%${subject}%`); where.push(`s.subject ILIKE $${params.length}`); }
  if (from) { params.push(String(from)); where.push(`s.started_at >= $${params.length}::timestamptz`); }
  if (to) { params.push(String(to)); where.push(`s.started_at <= $${params.length}::timestamptz`); }

  const { rows } = await query(
    `SELECT u.id, u.name, u.roll_number AS "rollNumber", u.email, u.section,
            count(a.id) FILTER (WHERE a.status IN ('present','excused'))::int AS attended,
            count(a.id)::int AS total
     FROM users u
     LEFT JOIN attendance a ON a.student_id = u.id
     LEFT JOIN class_sessions s ON s.id = a.session_id
     WHERE ${where.join(' AND ')}
     GROUP BY u.id ORDER BY u.roll_number NULLS LAST, u.name`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    percentage: r.total ? Math.round((r.attended / r.total) * 1000) / 10 : 0,
  }));
}

router.get('/students/:id', asyncHandler(async (req, res) => {
  const student = await query(`SELECT * FROM users WHERE id = $1 AND role = 'student'`, [req.params.id]);
  if (!student.rows[0]) throw errors.notFound('Student does not exist.');
  const s = student.rows[0];

  const { rows } = await query(
    `SELECT a.session_id AS "sessionId", s.subject, s.section, s.started_at AS "startedAt",
            a.status, a.marked_at AS "markedAt", a.marked_by AS "markedBy", a.note
     FROM attendance a JOIN class_sessions s ON s.id = a.session_id
     WHERE a.student_id = $1 ORDER BY s.started_at DESC`,
    [req.params.id],
  );
  const attended = rows.filter((r) => ['present', 'excused'].includes(r.status)).length;
  res.json({
    student: { id: s.id, name: s.name, email: s.email, rollNumber: s.roll_number, section: s.section },
    records: rows,
    summary: {
      attended,
      total: rows.length,
      percentage: rows.length ? Math.round((attended / rows.length) * 1000) / 10 : 0,
    },
  });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const rows = await summaryRows({
    section: req.query.section ? String(req.query.section) : null,
    subject: req.query.subject ? String(req.query.subject) : null,
    from: req.query.from ? String(req.query.from) : null,
    to: req.query.to ? String(req.query.to) : null,
  });

  let students = rows;
  const below = Number(req.query.below);
  if (!Number.isNaN(below) && req.query.below !== undefined) {
    students = rows.filter((r) => r.percentage < below);
  }

  if (req.query.format === 'csv') {
    const header = ['Roll Number', 'Name', 'Email', 'Section', 'Attended', 'Total', 'Percentage'];
    const lines = students.map((r) =>
      [r.rollNumber, r.name, r.email, r.section, r.attended, r.total, r.percentage].map(csvEscape).join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-summary-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send([header.join(','), ...lines].join('\n'));
  }

  res.json({ students });
}));

export default router;
