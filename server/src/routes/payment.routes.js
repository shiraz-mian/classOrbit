import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { auth } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { fail, fulfillPayment } from '../services/learning.service.js';
import {
  createCheckout,
  ownCheckout,
  syncCheckout,
  verifyCheckout,
  checkoutStatus,
} from '../services/payment.service.js';

export function createRouter(db, gateway) {
  const app = Router();
  app.post('/api/courses/:courseId/checkout', auth, async (req, res) => {
    const course = await db.get('course', req.params.courseId);
    if (!course || course.status !== 'PUBLISHED') fail(404, 'Course not found');
    if ((await db.all('enrollment', { userId: req.user.id, courseId: course.id })).length)
      fail(409, 'You are already enrolled');
    if (course.price === 0) fail(400, 'Use free enrollment for this course');
    if (gateway.configured) return res.json(await createCheckout(db, req.user, course, gateway));
    if (!config.demo) fail(503, 'Configure Razorpay test keys to enable checkout');
    await fulfillPayment(db, {
      id: 'demo-' + randomUUID(),
      userId: req.user.id,
      courseId: course.id,
      amount: course.price,
      currency: 'inr',
      provider: 'DEMO',
    });
    res.json({ enrolled: true, demo: true });
  });
  app.get('/api/payments/orders/:checkoutId', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const quote = await ownCheckout(db, req.params.checkoutId, req.user.id);
    res.json(await checkoutStatus(db, await syncCheckout(db, quote, gateway)));
  });
  app.post('/api/payments/verify', auth, async (req, res) => {
    const input = z
      .object({
        checkoutId: z.uuid(),
        razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
        razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
      })
      .parse(req.body);
    res.json(await checkoutStatus(db, await verifyCheckout(db, req.user, input, gateway)));
  });
  return app;
}
