import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { query, withTransaction } from '../db/pool.js';
import { isAllowedEmailDomain } from '../config.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, errors } from '../utils/errors.js';
import { destroyUserSessions } from '../services/authSessionService.js';
import { writeAudit } from '../services/auditService.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(254).transform((e) => e.toLowerCase().trim()),
  rollNumber: z.string().trim().min(1).max(50),
  section: z.string().trim().max(50).optional().nullable(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  rollNumber: z.string().trim().min(1).max(50).optional(),
  section: z.string().trim().max(50).optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update.' });

function mapStudent(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    rollNumber: row.roll_number,
    section: row.section,
    isActive: row.is_active,
    deviceBound: !!row.bound_device_id,
    createdAt: row.created_at,
  };
}

router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw errors.validation('Attach a CSV file under the field "file".');
  let records;
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: (header) => header.map((h) => String(h).trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    throw errors.validation('The file could not be parsed as CSV.');
  }
  for (const col of ['name', 'email', 'roll_number']) {
    if (!records.length || !(col in records[0])) {
      throw errors.validation(`CSV is missing the required column "${col}".`, { column: col });
    }
  }

  const result = await withTransaction(async (client) => {
    let imported = 0;
    let updated = 0;
    const errorList = [];
    for (let i = 0; i < records.length; i++) {
      const rowNo = i + 2;
      const rec = records[i];
      const name = (rec.name || '').trim();
      const email = (rec.email || '').trim().toLowerCase();
      const rollNumber = (rec.roll_number || '').trim();
      const section = (rec.section || '').trim() || null;
      if (!name || !email || !rollNumber) {
        errorList.push({ row: rowNo, reason: 'VALIDATION_ERROR' });
        continue;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !isAllowedEmailDomain(email)) {
        errorList.push({ row: rowNo, reason: 'EMAIL_DOMAIN_NOT_ALLOWED' });
        continue;
      }
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length) {
        await client.query(
          `UPDATE users SET name = $1, section = $2, roll_number = COALESCE($3, roll_number), updated_at = now() WHERE id = $4`,
          [name, section, rollNumber, existing.rows[0].id],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO users (email, name, role, roll_number, section) VALUES ($1, $2, 'student', $3, $4)`,
          [email, name, rollNumber, section],
        );
        imported++;
      }
    }
    return { imported, updated, skipped: errorList.length, errors: errorList };
  });

  await writeAudit({ actorId: req.user.id, action: 'ROSTER_IMPORT', meta: { ...result } });
  res.json(result);
}));

router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
  const section = req.query.section ? String(req.query.section) : null;
  const search = req.query.search ? `%${String(req.query.search)}%` : null;

  const where = [`role = 'student'`];
  const params = [];
  if (section) { params.push(section); where.push(`section = $${params.length}`); }
  if (search) { params.push(search); where.push(`(name ILIKE $${params.length} OR roll_number ILIKE $${params.length} OR email ILIKE $${params.length})`); }

  const totalRes = await query(`SELECT count(*)::int AS count FROM users WHERE ${where.join(' AND ')}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY roll_number NULLS LAST, name LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ students: rows.map(mapStudent), page, pageSize, total: totalRes.rows[0].count });
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { name, email, rollNumber, section } = req.body;
  if (!isAllowedEmailDomain(email)) throw errors.emailDomainNotAllowed();
  try {
    const { rows } = await query(
      `INSERT INTO users (email, name, role, roll_number, section) VALUES ($1, $2, 'student', $3, $4) RETURNING *`,
      [email, name, rollNumber, section || null],
    );
    res.status(201).json(mapStudent(rows[0]));
  } catch (err) {
    if (err.code === '23505') throw errors.validation('A student with this email or roll number already exists.');
    throw err;
  }
}));

router.patch('/:id', validate(patchSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const sets = [];
  const params = [];
  const fields = { name: 'name', rollNumber: 'roll_number', section: 'section', isActive: 'is_active' };
  for (const [key, column] of Object.entries(fields)) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  params.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND role = 'student' RETURNING *`,
    params,
  );
  if (!rows.length) throw errors.notFound('Student does not exist.');
  res.json(mapStudent(rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 AND role = 'student' RETURNING id`,
    [req.params.id],
  );
  if (!rows.length) throw errors.notFound('Student does not exist.');
  res.status(204).end();
}));

router.post('/:id/reset-device', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE users SET bound_device_id = NULL, updated_at = now() WHERE id = $1 AND role = 'student' RETURNING id`,
    [req.params.id],
  );
  if (!rows.length) throw errors.notFound('Student does not exist.');
  await destroyUserSessions(req.params.id);
  await writeAudit({ actorId: req.user.id, action: 'DEVICE_RESET', meta: { studentId: req.params.id } });
  res.status(204).end();
}));

export default router;
