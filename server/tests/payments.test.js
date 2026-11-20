import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { createPaymentGateway } from '../src/services/razorpay.gateway.js';
import { config } from '../src/config/index.js';
import { fakeRazorpay } from './helpers/razorpay.js';

async function fixture(t) {
  const db = await createDatabase({ demo: true, file: null });
  t.after(() => db.close());
  const provider = fakeRazorpay();
  const app = await createApp(db, { payments: provider.options });
  const agents = {};
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  for (const [id, role] of [
    ['learner', 'STUDENT'],
    ['other', 'STUDENT'],
    ['teacher', 'INSTRUCTOR'],
    ['outsider', 'INSTRUCTOR'],
  ]) {
    await db.insert('user', {
      id,
      role,
      name: id,
      email: id + '@test.local',
      passwordHash,
      instructorApproved: role === 'INSTRUCTOR',
      createdAt: new Date(),
    });
    agents[id] = request.agent(app);
    await agents[id]
      .post('/api/auth/login')
      .send({ email: id + '@test.local', password: 'TestPassword123!' })
      .expect(200);
  }
  const course = (
    await agents.teacher
      .post('/api/studio/courses')
      .send({
        title: 'Paid CSS workshop',
        description: 'A useful course for verifying test payments and enrollment.',
        category: 'Development',
        level: 'Beginner',
        color: 'coral',
        price: 5900,
      })
      .expect(201)
  ).body;
  await agents.teacher
    .post('/api/studio/courses/' + course.id + '/lessons')
    .send({ title: 'A protected lesson', content: 'Paid lesson content', duration: 10 })
    .expect(201);
  await agents.teacher
    .patch('/api/studio/courses/' + course.id)
    .send({ status: 'PUBLISHED' })
    .expect(200);
  const checkout = async () =>
    (
      await agents.learner
        .post('/api/courses/' + course.id + '/checkout')
        .send({ amount: 1, userId: 'other', currency: 'USD' })
        .expect(200)
    ).body;
  const webhook = (event, target = app) =>
    request(target)
      .post('/api/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', event.signature)
      .send(event.body);
  return { db, app, provider, agents, course, checkout, webhook };
}

test('Razorpay creates and reuses a server-priced INR order without granting access', async (t) => {
  const f = await fixture(t),
    a = await f.checkout(),
    b = await f.checkout();
  assert.equal(a.amount, 5900);
  assert.equal(a.currency, 'INR');
  assert.equal(a.orderId, b.orderId);
  assert.equal(f.provider.state.orders.size, 1);
  const stored = await f.db.get('checkoutOrder', a.checkoutId);
  assert.equal(stored.userId, 'learner');
  assert.equal(stored.status, 'PENDING');
  assert.equal(f.provider.state.orders.get(a.orderId).partial_payment, false);
  assert.equal((await f.agents.learner.get('/api/courses/' + f.course.id)).body.access, false);
  const status = await f.agents.learner.get('/api/payments/orders/' + a.checkoutId).expect(200);
  assert.equal(status.body.status, 'PENDING');
  assert.equal(status.headers['cache-control'], 'no-store');
  assert.equal(status.body.keySecret, undefined);
  assert.equal((await f.agents.learner.get('/api/bootstrap')).body.razorpayConfigured, true);
});

test('callback verification rejects forgery and other users and waits for captured payment', async (t) => {
  const f = await fixture(t),
    order = await f.checkout();
  const payment = f.provider.capture(order.orderId, { status: 'authorized', captured: false });
  const input = f.provider.callback(order, payment);
  await request(f.app).post('/api/payments/verify').send(input).expect(401);
  await f.agents.other.post('/api/payments/verify').send(input).expect(404);
  await f.agents.learner
    .post('/api/payments/verify')
    .send({ ...input, razorpay_signature: '0'.repeat(64) })
    .expect(400);
  await f.agents.learner
    .post('/api/payments/verify')
    .send({ ...input, razorpay_order_id: 'order_wrong' })
    .expect(400);
  assert.equal(
    (await f.agents.learner.post('/api/payments/verify').send(input).expect(200)).body.status,
    'PENDING',
  );
  assert.equal((await f.db.all('enrollment')).length, 0);
  Object.assign(payment, { status: 'captured', captured: true });
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.agents.learner.post('/api/payments/verify').send(input).expect(200)).body.status,
      'PAID',
    );
  assert.equal((await f.db.all('payment')).length, 1);
  assert.equal((await f.db.all('enrollment')).length, 1);
  assert.equal((await f.agents.learner.get('/api/courses/' + f.course.id)).body.access, true);
  await f.agents.other.get('/api/payments/orders/' + order.checkoutId).expect(404);
  await request(f.app)
    .get('/api/payments/orders/' + order.checkoutId)
    .expect(401);
});

test('signed captured webhooks are idempotent and earnings belong to the course owner', async (t) => {
  const f = await fixture(t),
    order = await f.checkout(),
    payment = f.provider.capture(order.orderId);
  const event = f.provider.event(payment);
  await Promise.all([f.webhook(event).expect(200), f.webhook(event).expect(200)]);
  await f.webhook(f.provider.event(payment, 'order.paid')).expect(200);
  assert.equal((await f.db.all('payment')).length, 1);
  assert.equal((await f.db.all('enrollment')).length, 1);
  const revenue = (await f.agents.teacher.get('/api/studio/revenue').expect(200)).body;
  assert.equal(revenue.gross, 5900);
  assert.equal(revenue.platformFee, 590);
  assert.equal(revenue.payments[0].provider, 'RAZORPAY_TEST');
  assert.equal((await f.agents.outsider.get('/api/studio/revenue').expect(200)).body.gross, 0);
  await f.agents.learner.get('/api/studio/revenue').expect(403);
  await f.agents.learner
    .post('/api/courses/' + f.course.id + '/checkout')
    .send({})
    .expect(409);
});

test('webhook signatures bind raw bytes and provider amount/currency/order are rechecked', async (t) => {
  const f = await fixture(t),
    order = await f.checkout(),
    payment = f.provider.capture(order.orderId);
  const event = f.provider.event(payment);
  await request(f.app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', event.signature)
    .send(event.body + ' ')
    .expect(400);
  await request(f.app).post('/api/payments/razorpay/webhook').send({}).expect(400);
  payment.amount = 1;
  await f.webhook(event).expect(400);
  payment.amount = order.amount;
  payment.currency = 'USD';
  await f.webhook(event).expect(400);
  payment.currency = 'INR';
  payment.order_id = 'order_wrong';
  await f.webhook(event).expect(400);
  payment.order_id = order.orderId;
  assert.equal((await f.db.all('payment')).length, 0);
  assert.equal((await f.db.all('webhookEvent')).length, 0);
  await f.agents.teacher
    .patch('/api/studio/courses/' + f.course.id)
    .send({ price: 8900 })
    .expect(200);
  await f.webhook(event).expect(200);
  assert.equal((await f.db.get('payment', payment.id)).amount, 5900);
});

test('status reconciliation recovers a captured payment when the callback never arrives', async (t) => {
  const f = await fixture(t),
    order = await f.checkout();
  f.provider.capture(order.orderId);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.agents.learner.get('/api/payments/orders/' + order.checkoutId).expect(200)).body
        .status,
      'PAID',
    );
  assert.equal((await f.db.all('payment')).length, 1);
  assert.equal((await f.db.all('enrollment')).length, 1);
});

test('a timed-out order creation is recovered by its receipt without repeating the POST', async (t) => {
  const f = await fixture(t);
  f.provider.state.timeoutAfterCreate = true;
  const result = await f.agents.learner
    .post('/api/courses/' + f.course.id + '/checkout')
    .send({})
    .expect(503);
  assert.ok(result.body.checkoutId);
  assert.equal(f.provider.state.orders.size, 1);
  const retried = await f.checkout();
  assert.equal(retried.checkoutId, result.body.checkoutId);
  assert.equal(f.provider.state.orders.size, 1);
  f.provider.capture(retried.orderId);
  assert.equal(
    (await f.agents.learner.get('/api/payments/orders/' + retried.checkoutId).expect(200)).body
      .status,
    'PAID',
  );
});

test('webhook retries recover from provider failure and never trust an unconfirmed capture', async (t) => {
  const f = await fixture(t),
    order = await f.checkout();
  const payment = f.provider.capture(order.orderId, { status: 'authorized', captured: false });
  const event = f.provider.event(payment);
  await f.webhook(event).expect(500);
  assert.equal((await f.db.all('webhookEvent')).length, 0);
  Object.assign(payment, { status: 'captured', captured: true });
  f.provider.state.failReads = true;
  await f.webhook(event).expect(500);
  f.provider.state.failReads = false;
  await f.webhook(event).expect(200);
  assert.equal((await f.db.all('payment')).length, 1);
});

test('a failed enrollment rolls back payment and checkout state so the webhook can retry', async (t) => {
  const f = await fixture(t),
    order = await f.checkout(),
    payment = f.provider.capture(order.orderId);
  const faultDb = {
    ...f.db,
    atomic: (fn) =>
      f.db.atomic((tx) =>
        fn({
          ...tx,
          insert: (model, value) => {
            if (model === 'enrollment') throw new Error('Injected write failure');
            return tx.insert(model, value);
          },
        }),
      ),
  };
  const faultApp = await createApp(faultDb, { payments: f.provider.options });
  const event = f.provider.event(payment);
  await f.webhook(event, faultApp).expect(500);
  assert.equal((await f.db.all('payment')).length, 0);
  assert.equal((await f.db.all('enrollment')).length, 0);
  assert.equal((await f.db.get('checkoutOrder', order.checkoutId)).status, 'PENDING');
  await f.webhook(event).expect(200);
  assert.equal((await f.db.all('payment')).length, 1);
});

test('Razorpay rejects live keys and PostgreSQL mode cannot fall back to simulated checkout', async (t) => {
  assert.throws(
    () => createPaymentGateway({ keyId: 'rzp_live_example', keySecret: 'unused' }),
    /test keys only/,
  );
  const f = await fixture(t),
    original = config.demo;
  const unconfigured = await createApp(f.db, {
    payments: { keyId: '', keySecret: '', webhookSecret: '' },
  });
  const login = await request(unconfigured)
    .post('/api/auth/login')
    .send({ email: 'learner@test.local', password: 'TestPassword123!' })
    .expect(200);
  try {
    config.demo = false;
    await request(unconfigured)
      .post('/api/courses/' + f.course.id + '/checkout')
      .set('Cookie', login.headers['set-cookie'])
      .send({})
      .expect(503);
    await request(unconfigured).post('/api/payments/razorpay/webhook').send({}).expect(503);
    assert.equal((await f.db.all('checkoutOrder')).length, 0);
    assert.equal((await f.db.all('payment')).length, 0);
  } finally {
    config.demo = original;
  }
});

test('INR revenue totals do not combine legacy payments in a different currency', async (t) => {
  const f = await fixture(t),
    order = await f.checkout(),
    payment = f.provider.capture(order.orderId);
  await f.webhook(f.provider.event(payment)).expect(200);
  await f.db.insert('payment', {
    id: 'legacy-payment',
    userId: 'other',
    courseId: f.course.id,
    amount: 1000,
    currency: 'usd',
    status: 'PAID',
    provider: 'DEMO',
    createdAt: new Date(),
  });
  const revenue = (await f.agents.teacher.get('/api/studio/revenue').expect(200)).body;
  assert.equal(revenue.gross, 5900);
  assert.equal(revenue.payments.length, 2);
  assert.equal(revenue.currency, 'inr');
});

test('a rejected status read never marks an existing provider order as failed', async (t) => {
  const f = await fixture(t),
    order = await f.checkout();
  f.provider.state.rejectReads = true;
  const response = await f.agents.learner
    .post('/api/courses/' + f.course.id + '/checkout')
    .send({})
    .expect(503);
  assert.equal(response.body.checkoutId, order.checkoutId);
  assert.equal((await f.db.get('checkoutOrder', order.checkoutId)).status, 'PENDING');
  f.provider.state.rejectReads = false;
  f.provider.capture(order.orderId);
  assert.equal(
    (await f.agents.learner.get('/api/payments/orders/' + order.checkoutId).expect(200)).body
      .status,
    'PAID',
  );
  assert.equal(f.provider.state.orders.size, 1);
});
