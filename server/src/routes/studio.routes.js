import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { auth, instructor } from '../middleware/auth.js';
import { fail, canEdit } from '../services/learning.service.js';
import { courseSchema, lessonSchema, questionSchema } from '../validators/course.js';
const id = () => randomUUID();

export function createRouter(db) {
  const app = Router();
  app.post('/api/studio/courses', auth, instructor, async (req, res) => {
    const data = courseSchema.parse(req.body);
    res.status(201).json(
      await db.insert('course', {
        id: id(),
        ...data,
        status: 'DRAFT',
        instructorId: req.user.id,
        createdAt: new Date(),
      }),
    );
  });
  app.patch('/api/studio/courses/:courseId', auth, instructor, async (req, res) => {
    const c = await canEdit(db, req.user, req.params.courseId);
    const data = courseSchema
      .partial()
      .extend({ status: z.enum(['DRAFT', 'PUBLISHED']).optional() })
      .parse(req.body);
    if (data.status === 'PUBLISHED' && !(await db.all('lesson', { courseId: c.id })).length)
      fail(400, 'Add at least one lesson before publishing');
    if (
      data.price !== undefined &&
      data.price !== c.price &&
      (await db.all('enrollment', { courseId: c.id })).length
    )
      fail(400, 'Prices are fixed after the first enrollment');
    if ((await db.all('certificate', { courseId: c.id })).length && data.status === 'DRAFT')
      fail(400, 'Courses with issued certificates must remain published');
    res.json(await db.patch('course', c.id, data));
  });
  app.post('/api/studio/courses/:courseId/lessons', auth, instructor, async (req, res) => {
    await canEdit(db, req.user, req.params.courseId);
    const data = lessonSchema.parse(req.body);
    if ((await db.all('certificate', { courseId: req.params.courseId })).length)
      fail(400, 'This course has issued certificates. Create a new course version to add lessons.');
    const lesson = await db.atomic(async (tx) => {
      const lessons = await tx.all('lesson', { courseId: req.params.courseId });
      return tx.insert('lesson', {
        id: id(),
        courseId: req.params.courseId,
        ...data,
        position: lessons.length + 1,
        videoStatus: 'EMPTY',
        videoPath: null,
        sampleVideo: null,
      });
    });
    res.status(201).json(lesson);
  });
  app.post('/api/studio/courses/:courseId/quizzes', auth, instructor, async (req, res) => {
    await canEdit(db, req.user, req.params.courseId);
    if ((await db.all('certificate', { courseId: req.params.courseId })).length)
      fail(
        400,
        'Create a new course version to add assessments after certificates have been issued.',
      );
    const data = z
      .object({
        title: z.string().trim().min(3).max(100),
        passScore: z.number().int().min(1).max(100),
        questions: z.array(questionSchema).min(1).max(30),
      })
      .parse(req.body);
    res
      .status(201)
      .json(await db.insert('quiz', { id: id(), courseId: req.params.courseId, ...data }));
  });

  return app;
}
