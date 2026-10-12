import { ApiError, errors } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist.`, details: {} },
  });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed request body.', details: {} } });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'File too large.', details: {} } });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: errors.internal().message, details: {} },
  });
}
