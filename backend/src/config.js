import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();
// Load the repo-root .env so `npm run dev` inside backend/ picks up the same file.
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function list(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  allowedEmailDomain: required('ALLOWED_EMAIL_DOMAIN').toLowerCase(),
  teacherEmails: list('TEACHER_EMAILS'),
  adminEmails: list('ADMIN_EMAILS'),
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT || 1025),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || 'attendance@localhost',
  },
  jwtSecret: required('JWT_SECRET'),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_HOURS || 12) * 3600,
  rotationIntervalDefault: Number(process.env.ROTATION_INTERVAL_DEFAULT || 20),
  allowedSubnets: list('ALLOWED_SUBNETS'),
  enableDeviceBinding: bool('ENABLE_DEVICE_BINDING', true),
  requireFreshOtpOnMark: bool('REQUIRE_FRESH_OTP_ON_MARK', false),
  trustProxy: bool('TRUST_PROXY', false),
  backupTriggerPath: process.env.BACKUP_TRIGGER_PATH || '/backups/.trigger',
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
};

export function isAllowedEmailDomain(email) {
  return email.toLowerCase().endsWith(`@${config.allowedEmailDomain}`);
}
