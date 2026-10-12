import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/rateLimit.js';
import { asyncHandler, errors } from '../utils/errors.js';
import { requestOtp, verifyOtpCode, setStepUpProof } from '../services/otpService.js';
import { createAuthSession, destroyAuthSession } from '../services/authSessionService.js';
import { writeAudit } from '../services/auditService.js';
import { clientIp } from '../utils/ip.js';

const router = Router();

const emailSchema = z.object({ email: z.string().email().max(254).transform((e) => e.toLowerCase().trim()) });
const verifySchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const stepUpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    rollNumber: user.roll_number,
  };
}

router.post('/otp/request', ipRateLimit({ route: 'otp-request', limit: 10 }), validate(emailSchema),
  asyncHandler(async (req, res) => {
    const { expiresInSeconds } = await requestOtp(req.body.email);
    res.json({ message: 'If this email is registered, a code has been sent.', expiresInSeconds });
  }),
);

router.post('/otp/verify', ipRateLimit({ route: 'otp-verify', limit: 10 }), validate(verifySchema),
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const deviceId = (req.headers['x-device-id'] || '').toString().trim() || null;
    if (config.enableDeviceBinding && !deviceId) {
      throw errors.validation('The X-Device-Id header is required.');
    }

    await verifyOtpCode(email, code);

    const { rows } = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = rows[0];
    if (!user) throw errors.notInRoster();

    if (config.enableDeviceBinding) {
      if (user.bound_device_id && user.bound_device_id !== deviceId) throw errors.deviceMismatch();
      if (!user.bound_device_id) {
        await query('UPDATE users SET bound_device_id = $1, updated_at = now() WHERE id = $2', [deviceId, user.id]);
      }
    }

    const session = await createAuthSession(user.id, user.role, deviceId);
    await writeAudit({ actorId: user.id, action: 'LOGIN', ip: clientIp(req), deviceId });

    res.json({ token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  }),
);

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await destroyAuthSession(req.tokenId);
  res.status(204).end();
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ user: req.user, deviceBound: !!req.user.boundDeviceId });
}));

router.post('/step-up/request', authenticate, requireRole('student'), ipRateLimit({ route: 'stepup-request', limit: 10 }),
  asyncHandler(async (req, res) => {
    const { expiresInSeconds } = await requestOtp(req.user.email);
    res.json({ message: 'If this email is registered, a code has been sent.', expiresInSeconds });
  }),
);

router.post('/step-up/verify', authenticate, requireRole('student'), ipRateLimit({ route: 'stepup-verify', limit: 10 }),
  validate(stepUpVerifySchema),
  asyncHandler(async (req, res) => {
    await verifyOtpCode(req.user.email, req.body.code);
    await setStepUpProof(req.user.id);
    res.json({ stepUpValidSeconds: 120 });
  }),
);

export default router;
