import { query } from '../db/pool.js';
import { getAuthSession } from '../services/authSessionService.js';
import { errors } from '../utils/errors.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw errors.unauthenticated();

    const session = await getAuthSession(token);
    if (!session) throw errors.unauthenticated();

    const { rows } = await query(
      'SELECT id, email, name, role, roll_number, section, bound_device_id, is_active FROM users WHERE id = $1',
      [session.userId],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw errors.unauthenticated();

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      rollNumber: user.roll_number,
      section: user.section,
      boundDeviceId: user.bound_device_id,
    };
    req.tokenId = token;
    req.deviceId = (req.headers['x-device-id'] || '').toString().trim() || null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(errors.forbidden('Your role is not allowed to use this endpoint.'));
    }
    next();
  };
}
