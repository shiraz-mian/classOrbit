import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { auth } from '../middleware/auth.js';
import { fail, safeUser, canAccess, completion } from '../services/learning.service.js';
const id = () => randomUUID();

export function createRouter(db, { configured }) {
  const app = Router();
  app.get('/api/bootstrap', async (req, res) => {
    const users = await db.all('user');
    const allLessons = await db.all('lesson');
    const courses = (await db.all('course'))
      .filter(
        (c) =>
          c.status === 'PUBLISHED' || req.user?.role === 'ADMIN' || c.instructorId === req.user?.id,
      )
      .map((c) => ({
        ...c,
        instructor: users.find((u) => u.id === c.instructorId)?.name || 'Instructor',
        lessonCount: allLessons.filter((l) => l.courseId === c.id).length,
        duration: allLessons
          .filter((l) => l.courseId === c.id)
          .reduce((sum, l) => sum + l.duration, 0),
      }));
    const enrollments = req.user ? await db.all('enrollment', { userId: req.user.id }) : [];
    const learning = await Promise.all(
      enrollments.map(async (e) => ({ ...e, ...(await completion(db, req.user.id, e.courseId)) })),
    );
    const liveClasses = (await db.all('liveClass'))
      .filter((l) => courses.some((c) => c.id === l.courseId))
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    res.json({
      user: req.user ? safeUser(req.user) : null,
      mode: config.demo ? 'demo' : 'postgresql',
      razorpayConfigured: configured,
      courses,
      learning,
      liveClasses,
      certificates: req.user ? await db.all('certificate', { userId: req.user.id }) : [],
    });
  });
  app.get('/api/courses/:courseId', async (req, res) => {
    const c = await db.get('course', req.params.courseId);
    if (!c) fail(404, 'Course not found');
    if (c.status !== 'PUBLISHED' && req.user?.role !== 'ADMIN' && req.user?.id !== c.instructorId)
      fail(404, 'Course not found');
    let access = false;
    try {
      await canAccess(db, req.user, c.id);
      access = true;
    } catch {}
    const lessons = (await db.all('lesson', { courseId: c.id }))
      .sort((a, b) => a.position - b.position)
      .map((l) =>
        access
          ? l
          : {
              id: l.id,
              title: l.title,
              position: l.position,
              duration: l.duration,
              videoStatus: l.videoStatus,
            },
      );
    const quizzes = (await db.all('quiz', { courseId: c.id })).map((q) => ({
      ...q,
      questions: q.questions.map(({ correct, explanation, ...question }) => question),
    }));
    const progress = access ? await db.all('progress', { userId: req.user.id }) : [];
    const attempts = access ? await db.all('attempt', { userId: req.user.id }) : [];
    res.json({ course: c, lessons, quizzes: access ? quizzes : [], progress, attempts, access });
  });
  app.post('/api/courses/:courseId/enroll', auth, async (req, res) => {
    const c = await db.get('course', req.params.courseId);
    if (!c || c.status !== 'PUBLISHED') fail(404, 'Course not found');
    if (c.price > 0) fail(402, 'This course requires checkout');
    await db.atomic(async (tx) => {
      if (!(await tx.all('enrollment', { userId: req.user.id, courseId: c.id })).length)
        await tx.insert('enrollment', {
          id: id(),
          userId: req.user.id,
          courseId: c.id,
          createdAt: new Date(),
        });
    });
    res.json({ enrolled: true });
  });

  return app;
}
