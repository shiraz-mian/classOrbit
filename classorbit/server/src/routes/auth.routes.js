import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { fail, safeUser } from '../services/learning.service.js';
const id = () => randomUUID();
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.production,
  maxAge: 7 * 86400000,
  path: '/',
};
const login = (res, user) => {
  res.cookie(
    'classorbit_session',
    jwt.sign({ sub: user.id }, config.secret, { expiresIn: '7d', algorithm: 'HS256' }),
    cookieOptions,
  );
  return safeUser(user);
};

export function createRouter(db) {
  const app = Router();
  const authLimit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const data = z
      .object({ email: z.email().max(200), password: z.string().min(1).max(128) })
      .parse(req.body);
    const [user] = await db.all('user', { email: data.email.toLowerCase() });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash)))
      fail(401, 'Email or password is incorrect');
    res.json({ user: login(res, user) });
  });
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.email().max(200),
        password: z.string().min(10).max(128),
        role: z.enum(['STUDENT', 'INSTRUCTOR']).default('STUDENT'),
      })
      .parse(req.body);
    const user = await db.insert('user', {
      id: id(),
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(data.password, 12),
      role: data.role,
      instructorApproved: false,
      createdAt: new Date(),
    });
    res.status(201).json({ user: login(res, user) });
  });
  app.post('/api/auth/demo', authLimit, async (req, res) => {
    if (!config.demo) fail(404, 'Demo sign-in is disabled');
    const role = z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN']).parse(req.body.role);
    const [user] = await db.all('user', { role });
    if (!user) fail(404, 'Demo account missing');
    res.json({ user: login(res, user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('classorbit_session', { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });

  return app;
}
