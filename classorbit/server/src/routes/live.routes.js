import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { auth, instructor } from '../middleware/auth.js';
import { fail, canAccess, canEdit } from '../services/learning.service.js';
const id = () => randomUUID();

export function createRouter(db) {
  const app = Router();
  app.post('/api/studio/live-classes', auth, instructor, async (req, res) => {
    const data = z
      .object({
        courseId: z.string(),
        title: z.string().trim().min(5).max(120),
        startsAt: z.iso.datetime(),
        duration: z.number().int().min(15).max(180),
      })
      .parse(req.body);
    await canEdit(db, req.user, data.courseId);
    if (new Date(data.startsAt) < new Date()) fail(400, 'Choose a future date and time');
    res
      .status(201)
      .json(await db.insert('liveClass', { id: id(), ...data, startsAt: new Date(data.startsAt) }));
  });
  app.get('/api/live-classes/:liveId/config', auth, async (req, res) => {
    const live = await db.get('liveClass', req.params.liveId);
    if (!live) fail(404, 'Class not found');
    await canAccess(db, req.user, live.courseId);
    res.json({
      live,
      iceServers: JSON.parse(
        process.env.ICE_SERVERS_JSON || '[{"urls":"stun:stun.l.google.com:19302"}]',
      ),
      messages: (await db.all('chatMessage', { liveClassId: live.id }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(-100),
    });
  });

  return app;
}
