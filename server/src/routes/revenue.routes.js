import { Router } from 'express';
import { auth, instructor } from '../middleware/auth.js';

export function createRouter(db) {
  const app = Router();
  app.get('/api/studio/revenue', auth, instructor, async (req, res) => {
    const courses = (await db.all('course')).filter(
      (c) => req.user.role === 'ADMIN' || c.instructorId === req.user.id,
    );
    const payments = (await db.all('payment')).filter(
      (p) => courses.some((c) => c.id === p.courseId) && p.status === 'PAID',
    );
    const enrollments = (await db.all('enrollment')).filter((e) =>
      courses.some((c) => c.id === e.courseId),
    );
    const inrPayments = payments.filter((p) => p.currency.toLowerCase() === 'inr');
    res.json({
      currency: 'inr',
      courses,
      payments,
      enrollments,
      gross: inrPayments.reduce((s, p) => s + p.amount, 0),
      platformFee: inrPayments.reduce((s, p) => s + Math.round(p.amount * 0.1), 0),
    });
  });

  return app;
}
