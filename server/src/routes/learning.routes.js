import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { auth } from '../middleware/auth.js';
import { fail, canAccess, completion, grade } from '../services/learning.service.js';
const id = () => randomUUID();

export function createRouter(db) {
  const app = Router();
  app.post('/api/lessons/:lessonId/complete', auth, async (req, res) => {
    const lesson = await db.get('lesson', req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found');
    await canAccess(db, req.user, lesson.courseId);
    await db.atomic(async (tx) => {
      if (!(await tx.all('progress', { userId: req.user.id, lessonId: lesson.id })).length)
        await tx.insert('progress', {
          id: id(),
          userId: req.user.id,
          lessonId: lesson.id,
          completedAt: new Date(),
        });
    });
    res.json(await completion(db, req.user.id, lesson.courseId));
  });
  app.post('/api/quizzes/:quizId/attempts', auth, async (req, res) => {
    const q = await db.get('quiz', req.params.quizId);
    if (!q) fail(404, 'Quiz not found');
    await canAccess(db, req.user, q.courseId);
    const result = grade(q, req.body.answers);
    await db.insert('attempt', {
      id: id(),
      quizId: q.id,
      userId: req.user.id,
      answers: req.body.answers,
      score: result.score,
      passed: result.passed,
      createdAt: new Date(),
    });
    res.json(result);
  });

  return app;
}
