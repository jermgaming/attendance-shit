import { config } from '../config.js';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  validation: (message = 'Missing or malformed field', details = {}) =>
    new ApiError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'No token, bad token, or expired session.'),
  forbidden: (message = 'You do not have permission for this action.', details = {}) =>
    new ApiError(403, 'FORBIDDEN', message, details),
  emailDomainNotAllowed: () =>
    new ApiError(403, 'EMAIL_DOMAIN_NOT_ALLOWED', `Only @${config.allowedEmailDomain} emails are allowed.`),
  notInRoster: () => new ApiError(403, 'NOT_IN_ROSTER', 'This email is not on the student roster.'),
  networkNotAllowed: () =>
    new ApiError(403, 'NETWORK_NOT_ALLOWED', 'You must be on the classroom network to mark attendance.'),
  deviceMismatch: () =>
    new ApiError(403, 'DEVICE_MISMATCH', 'This account is bound to a different device. Ask your teacher to reset it.'),
  notFound: (message = 'Resource does not exist.') => new ApiError(404, 'NOT_FOUND', message),
  alreadyMarked: () =>
    new ApiError(409, 'ALREADY_MARKED', 'You already marked attendance in this session.'),
  sessionClosed: () => new ApiError(409, 'SESSION_CLOSED', 'This attendance session is closed.'),
  sessionAlreadyOpen: () =>
    new ApiError(409, 'SESSION_ALREADY_OPEN', 'You already have an open session. Close it first.'),
  invalidCode: () => new ApiError(422, 'INVALID_CODE', 'The code is wrong or has expired.'),
  invalidOtp: () => new ApiError(422, 'INVALID_OTP', 'The code is wrong or has expired.'),
  rateLimited: (retryAfterSeconds = 60) =>
    new ApiError(429, 'RATE_LIMITED', 'Too many requests or attempts. Slow down.', { retryAfterSeconds }),
  internal: (message = 'Unexpected failure.') => new ApiError(500, 'INTERNAL_ERROR', message),
};

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
