import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
export const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue' });
  next();
};
export const instructor = (req, res, next) => {
  if (!req.user || !['INSTRUCTOR', 'ADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Instructor access required' });
  if (req.user.role === 'INSTRUCTOR' && req.user.instructorApproved !== true)
    return res.status(403).json({
      code: 'INSTRUCTOR_APPROVAL_REQUIRED',
      error: 'Admin approval is required before you can create courses or upload videos.',
    });
  next();
};
export const authenticate = (db) => async (req, res, next) => {
  req.user = null;
  const token = req.cookies.classorbit_session;
  if (!token) return next();
  let payload;
  try {
    payload = jwt.verify(token, config.secret, { algorithms: ['HS256'] });
  } catch {
    return next();
  }
  // A temporary database outage must not turn a valid session into an anonymous visitor.
  req.user = await db.get('user', payload.sub);
  next();
};
export const checkOrigin = (req, res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== config.appUrl &&
    req.headers.origin !== req.protocol + '://' + req.get('host')
  )
    return res.status(403).json({ error: 'Request origin is not allowed' });
  next();
};
