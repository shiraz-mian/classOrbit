import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { fail, safeUser } from '../services/learning.service.js';
export function createRouter(db) {
  const router = Router();
  router.get('/api/admin/users', auth, async (req, res) => {
    if (req.user.role !== 'ADMIN') fail(403, 'Admin access required');
    res.json((await db.all('user')).map(safeUser));
  });
  router.patch('/api/admin/users/:userId/role', auth, async (req, res) => {
    if (req.user.role !== 'ADMIN') fail(403, 'Admin access required');
    if (req.params.userId === req.user.id) fail(400, 'You cannot change your own role');
    const role = z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN']).parse(req.body.role);
    const user = await db.get('user', req.params.userId);
    if (!user) fail(404, 'User not found');
    res.json(
      safeUser(
        await db.patch('user', req.params.userId, {
          role,
          instructorApproved:
            role === user.role && role === 'INSTRUCTOR' && user.instructorApproved === true,
        }),
      ),
    );
  });
  router.patch('/api/admin/users/:userId/instructor-access', auth, async (req, res) => {
    if (req.user.role !== 'ADMIN') fail(403, 'Admin access required');
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
    const user = await db.get('user', req.params.userId);
    if (!user) fail(404, 'User not found');
    if (user.role !== 'INSTRUCTOR')
      fail(400, 'Teaching access can only be assigned to instructor accounts');
    res.json(safeUser(await db.patch('user', user.id, { instructorApproved: approved })));
  });
  return router;
}
