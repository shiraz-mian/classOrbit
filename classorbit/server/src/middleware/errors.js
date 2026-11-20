import { ZodError } from 'zod';
import { isTemporaryDatabaseError } from '../services/database-retry.js';
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (isTemporaryDatabaseError(err)) {
    res.set('Retry-After', '2');
    return res.status(503).json({
      code: 'DATABASE_UNAVAILABLE',
      error: 'Your learning space is temporarily unavailable. Please try again in a moment.',
    });
  }
  if (err instanceof ZodError)
    return res
      .status(400)
      .json({ error: err.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') });
  if (err.code === 'P2002') return res.status(409).json({ error: 'This record already exists' });
  if (err.code === 'P2034')
    return res
      .status(409)
      .json({ error: 'Another update happened at the same time. Please retry.' });
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'Video must be under 500 MB' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Something went wrong. Please try again.' : err.message,
    ...(err.checkoutId ? { checkoutId: err.checkoutId } : {}),
  });
}
