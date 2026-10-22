import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { asyncHandler, errors } from '../utils/errors.js';
import { ipInAllowedSubnets, clientIp } from '../utils/ip.js';
import { markPresent } from '../services/attendanceService.js';
import { loadSession } from './sessions.js';

const router = Router();

const markSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'The code must be 6 digits.'),
});

router.get('/active', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.subject, s.section, s.started_at, s.auto_close_at, s.mark_mode, u.name AS teacher_name
     FROM class_sessions s JOIN users u ON u.id = s.teacher_id
     WHERE s.status = 'open' AND (s.section IS NULL OR s.section = $1)
     ORDER BY s.started_at DESC LIMIT 1`,
    [req.user.section],
  );
  const session = rows[0];
  if (!session) throw errors.notFound('There is no open session for you right now.');

  const marked = await query(
    `SELECT 1 FROM attendance WHERE session_id = $1 AND student_id = $2 AND status IN ('present','excused')`,
    [session.id, req.user.id],
  );
  res.json({
    id: session.id,
    subject: session.subject,
    section: session.section,
    teacherName: session.teacher_name,
    startedAt: session.started_at,
    autoCloseAt: session.auto_close_at,
    markMode: session.mark_mode,
    alreadyMarked: marked.rows.length > 0,
  });
}));

router.post('/:id/mark', requireRole('student'), validate(markSchema), asyncHandler(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (session.status !== 'open') throw errors.sessionClosed();

  if (!ipInAllowedSubnets(req)) throw errors.networkNotAllowed();

  if (session.section && req.user.section !== session.section) {
    throw errors.forbidden('This session is not for your section.');
  }

  const result = await markPresent({
    session,
    student: req.user,
    code: req.body.code,
    ip: clientIp(req),
    deviceId: req.deviceId,
  });
  res.status(201).json(result);
}));

export default router;
