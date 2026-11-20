import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { config } from '../server/src/config/index.js';
import { createApp } from '../server/src/app.js';
import { createPrismaRepository } from '../server/src/repositories/prisma.js';
import { fakeRazorpay } from '../server/tests/helpers/razorpay.js';

if (config.demo || config.production || process.argv.length > 2)
  throw new Error(
    'Use a development PostgreSQL database with DEMO_MODE=false; no arguments are supported.',
  );
const runId = randomUUID(),
  short = runId.slice(0, 8);
const directory = path.join(config.root, '.data/payment-verification', runId);
const prisma = new PrismaClient({ log: [] }),
  db = createPrismaRepository(prisma);
const provider = fakeRazorpay();
const accounts = ['STUDENT', 'INSTRUCTOR', 'ADMIN'].map((role) => ({
  role,
  name: 'Payment verification ' + role.toLowerCase(),
  email: 'payment.' + role.toLowerCase() + '.' + short + '@classorbit.test',
  password: randomBytes(24).toString('base64url'),
}));
const report = {
  runId,
  startedAt: new Date().toISOString(),
  database: 'postgresql',
  provider: 'FAKE Razorpay API; locally generated HMAC signatures; no hosted payment',
  checks: [],
};
const eventIds = [];
let course, checkout, payment;
await mkdir(directory, { recursive: true });
async function check(name, fn) {
  await fn();
  report.checks.push({ name, passed: true });
  console.log('PASS ' + name);
}
const app = await createApp(db, { payments: provider.options });
const agents = Object.fromEntries(accounts.map((a) => [a.role, request.agent(app)]));
const send = async (agent, method, url, body, status = 200) => {
  const response = await agent[method](url)
    .timeout({ response: 45000, deadline: 60000 })
    .send(body);
  assert.equal(response.status, status, method + ' ' + url + ' returned ' + response.status);
  return response.body;
};
try {
  await check('PostgreSQL checkout schema is available', async () => {
    await prisma.checkoutOrder.count();
    await prisma.payment.count();
  });
  await check(
    'Isolated users register and admin approves its instructor through the API',
    async () => {
      for (const account of accounts) {
        const result = await send(
          agents[account.role],
          'post',
          '/api/auth/register',
          { ...account, role: account.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'STUDENT' },
          201,
        );
        account.id = result.user.id;
      }
      const admin = accounts.find((a) => a.role === 'ADMIN');
      await prisma.user.update({
        where: { id: admin.id, email: admin.email },
        data: { role: 'ADMIN' },
      });
      await send(agents.ADMIN, 'post', '/api/auth/login', {
        email: admin.email,
        password: admin.password,
      });
      const instructor = accounts.find((a) => a.role === 'INSTRUCTOR');
      await send(
        agents.ADMIN,
        'patch',
        '/api/admin/users/' + instructor.id + '/instructor-access',
        { approved: true },
      );
    },
  );
  await check('Approved instructor publishes a paid INR course', async () => {
    course = await send(
      agents.INSTRUCTOR,
      'post',
      '/api/studio/courses',
      {
        title: 'Razorpay verification ' + short,
        description: 'Temporary test course created only for payment verification.',
        category: 'Development',
        level: 'Beginner',
        color: 'coral',
        price: 49900,
      },
      201,
    );
    await send(
      agents.INSTRUCTOR,
      'post',
      '/api/studio/courses/' + course.id + '/lessons',
      {
        title: 'Protected payment test lesson',
        content: 'Temporary verification content.',
        duration: 5,
      },
      201,
    );
    await send(agents.INSTRUCTOR, 'patch', '/api/studio/courses/' + course.id, {
      status: 'PUBLISHED',
    });
  });
  await check(
    'Server price is persisted before Razorpay order creation; access remains locked',
    async () => {
      checkout = await send(agents.STUDENT, 'post', '/api/courses/' + course.id + '/checkout', {
        amount: 1,
        currency: 'USD',
      });
      assert.equal(checkout.amount, 49900);
      assert.equal(checkout.currency, 'INR');
      const stored = await prisma.checkoutOrder.findUniqueOrThrow({
        where: { id: checkout.checkoutId },
      });
      assert.equal(stored.status, 'PENDING');
      assert.equal(stored.amount, 49900);
      assert.equal((await send(agents.STUDENT, 'get', '/api/courses/' + course.id)).access, false);
    },
  );
  await check('Forged signatures are rejected and authorized payments cannot enroll', async () => {
    payment = provider.capture(checkout.orderId, { status: 'authorized', captured: false });
    const input = provider.callback(checkout, payment);
    await send(
      agents.STUDENT,
      'post',
      '/api/payments/verify',
      { ...input, razorpay_signature: '0'.repeat(64) },
      400,
    );
    const result = await send(agents.STUDENT, 'post', '/api/payments/verify', input);
    assert.equal(result.status, 'PENDING');
    assert.equal(await prisma.payment.count({ where: { checkoutId: checkout.checkoutId } }), 0);
  });
  await check(
    'Signed captured webhook atomically saves payment, enrollment and original quote',
    async () => {
      await send(agents.INSTRUCTOR, 'patch', '/api/studio/courses/' + course.id, { price: 69900 });
      Object.assign(payment, { status: 'captured', captured: true });
      const event = provider.event(payment);
      eventIds.push('razorpay:' + createHash('sha256').update(event.body).digest('hex'));
      for (let i = 0; i < 2; i++)
        await request(app)
          .post('/api/payments/razorpay/webhook')
          .set('Content-Type', 'application/json')
          .set('X-Razorpay-Signature', event.signature)
          .send(event.body)
          .expect(200);
      assert.equal(
        (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amount,
        49900,
      );
      assert.equal(await prisma.payment.count({ where: { checkoutId: checkout.checkoutId } }), 1);
      assert.equal(await prisma.enrollment.count({ where: { courseId: course.id } }), 1);
      assert.equal((await send(agents.STUDENT, 'get', '/api/courses/' + course.id)).access, true);
    },
  );
  await check(
    'Callback retry stays idempotent and only the learner can read its checkout',
    async () => {
      assert.equal(
        (
          await send(
            agents.STUDENT,
            'post',
            '/api/payments/verify',
            provider.callback(checkout, payment),
          )
        ).status,
        'PAID',
      );
      await send(
        agents.ADMIN,
        'get',
        '/api/payments/orders/' + checkout.checkoutId,
        undefined,
        404,
      );
      assert.equal(await prisma.payment.count({ where: { checkoutId: checkout.checkoutId } }), 1);
    },
  );
  await check('Instructor revenue counts the captured INR payment once', async () => {
    const revenue = await send(agents.INSTRUCTOR, 'get', '/api/studio/revenue');
    assert.equal(revenue.gross, 49900);
    assert.equal(revenue.platformFee, 4990);
    assert.equal(revenue.currency, 'inr');
    await send(agents.STUDENT, 'get', '/api/studio/revenue', undefined, 403);
  });
  await check(
    'Fresh PostgreSQL connection retains paid state without payment credentials',
    async () => {
      const freshClient = new PrismaClient({ log: [] });
      try {
        const freshApp = await createApp(createPrismaRepository(freshClient), {
          payments: { keyId: '', keySecret: '', webhookSecret: '' },
        });
        const learner = accounts.find((a) => a.role === 'STUDENT'),
          agent = request.agent(freshApp);
        await send(agent, 'post', '/api/auth/login', {
          email: learner.email,
          password: learner.password,
        });
        assert.equal(
          (await send(agent, 'get', '/api/payments/orders/' + checkout.checkoutId)).status,
          'PAID',
        );
        assert.equal((await send(agent, 'get', '/api/courses/' + course.id)).access, true);
      } finally {
        await freshClient.$disconnect();
      }
    },
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: accounts.map((a) => a.email) } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length)
      await prisma.$transaction([
        prisma.payment.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.checkoutOrder.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.enrollment.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.webhookEvent.deleteMany({ where: { id: { in: eventIds } } }),
        prisma.course.deleteMany({ where: { instructorId: { in: userIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    assert.equal(
      await prisma.user.count({ where: { email: { in: accounts.map((a) => a.email) } } }),
      0,
    );
    report.cleanup = 'passed';
    console.log('PASS Isolated fixtures removed');
  } catch (error) {
    report.cleanup = 'failed';
    report.cleanupError = error.message;
    process.exitCode = 1;
    console.error('Fixture cleanup failed: ' + error.message);
  }
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await db.close();
  console.log('Report: ' + path.join(directory, 'report.json'));
}
