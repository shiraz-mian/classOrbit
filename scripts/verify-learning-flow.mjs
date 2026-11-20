import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { config } from '../server/src/config/index.js';
import { createApp } from '../server/src/app.js';
import { createPrismaRepository } from '../server/src/repositories/prisma.js';

// Deliberately separate from npm test: this command writes to the configured database.
const keep = process.argv.includes('--keep-fixtures');
const supported = new Set(['--keep-fixtures']);
if (process.argv.slice(2).some((arg) => !supported.has(arg)))
  throw new Error('Usage: npm run db:verify -- [--keep-fixtures]');
if (config.demo || config.production)
  throw new Error('Use DEMO_MODE=false and a development database, not NODE_ENV=production.');

const runId = randomUUID();
const shortId = runId.slice(0, 8);
const directory = path.join(config.root, '.data', 'neon-verification', runId);
const accounts = ['STUDENT', 'INSTRUCTOR', 'ADMIN'].map((role) => ({
  role,
  name: 'ClassOrbit ' + role[0] + role.slice(1).toLowerCase() + ' Demo',
  email: role.toLowerCase() + '.' + shortId + '@classorbit.test',
  password: randomBytes(24).toString('base64url'),
}));
const report = { runId, startedAt: new Date().toISOString(), adapter: 'postgresql', checks: [] };
let prisma = new PrismaClient({ log: [] });
let db = createPrismaRepository(prisma);
let courseId;
let succeeded = false;
let credentialsSaved = false;
await mkdir(directory, { recursive: true });

async function call(agent, method, url, body, expected = 200) {
  let operation = agent[method](url).timeout({ response: 45000, deadline: 60000 });
  if (body !== undefined) operation = operation.send(body);
  const response = await operation;
  assert.equal(
    response.status,
    expected,
    method.toUpperCase() + ' ' + url + ' returned ' + response.status + ', expected ' + expected,
  );
  return response;
}
async function check(name, fn) {
  const started = performance.now();
  await fn();
  report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
  console.log('PASS ' + name);
}
async function cleanup() {
  // Only identities generated for this unique run can be removed. Existing users are untouched.
  const users = await prisma.user.findMany({
    where: { email: { in: accounts.map((a) => a.email) } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (!userIds.length) return;
  const courses = await prisma.course.findMany({
    where: { instructorId: { in: userIds } },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.certificate.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.attempt.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.progress.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.enrollment.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.course.deleteMany({
      where: { id: { in: courses.map((c) => c.id) }, instructorId: { in: userIds } },
    }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
  assert.equal(await prisma.course.count({ where: { id: { in: courses.map((c) => c.id) } } }), 0);
}

try {
  await check('PostgreSQL connectivity and isolated fixture preflight', async () => {
    await prisma.$queryRawUnsafe('SELECT 1');
    assert.equal(
      await prisma.user.count({ where: { email: { in: accounts.map((a) => a.email) } } }),
      0,
    );
    report.existing = { users: await prisma.user.count(), courses: await prisma.course.count() };
  });
  let app = await createApp(db);
  const agents = Object.fromEntries(accounts.map((a) => [a.role, request.agent(app)]));
  await check(
    'Student and instructor signup store hashed passwords without teaching access',
    async () => {
      for (const account of accounts) {
        const result = await call(
          agents[account.role],
          'post',
          '/api/auth/register',
          {
            ...account,
            role: account.role === 'ADMIN' ? 'STUDENT' : account.role,
            instructorApproved: true,
          },
          201,
        );
        account.id = result.body.user.id;
        assert.equal(result.body.user.role, account.role === 'ADMIN' ? 'STUDENT' : account.role);
        assert.equal(result.body.user.instructorApproved, false);
        assert.equal(result.body.user.passwordHash, undefined);
        const stored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
        assert.notEqual(stored.passwordHash, account.password);
        assert.match(stored.passwordHash, /^\$2[aby]\$/);
      }
    },
  );
  await check('Admin provisioning, teaching approval, and password login', async () => {
    const adminAccount = accounts.find((a) => a.role === 'ADMIN');
    const instructorAccount = accounts.find((a) => a.role === 'INSTRUCTOR');
    // Bootstrap only the newly created test admin; normal promotion uses the protected API.
    await prisma.user.update({ where: { id: adminAccount.id }, data: { role: 'ADMIN' } });
    const pending = await call(agents.INSTRUCTOR, 'post', '/api/studio/courses', {}, 403);
    assert.equal(pending.body.code, 'INSTRUCTOR_APPROVAL_REQUIRED');
    await call(agents.INSTRUCTOR, 'post', '/api/studio/lessons/any-lesson/video', {}, 403);
    await call(
      agents.INSTRUCTOR,
      'patch',
      '/api/admin/users/' + instructorAccount.id + '/instructor-access',
      { approved: true },
      403,
    );
    await call(
      agents.ADMIN,
      'patch',
      '/api/admin/users/' + instructorAccount.id + '/instructor-access',
      { approved: true },
    );
    await call(
      agents.ADMIN,
      'patch',
      '/api/admin/users/' + adminAccount.id + '/role',
      { role: 'STUDENT' },
      400,
    );
    for (const account of accounts) {
      await call(agents[account.role], 'post', '/api/auth/logout', {});
      const result = await call(agents[account.role], 'post', '/api/auth/login', {
        email: account.email,
        password: account.password,
      });
      assert.equal(result.body.user.role, account.role);
      assert.match(result.headers['set-cookie'][0], /HttpOnly/);
    }
  });
  await check('Student role restrictions and disabled demo sign-in', async () => {
    await call(
      request(app),
      'post',
      '/api/auth/register',
      {
        name: 'No Admin Signup',
        email: 'admin.' + shortId + '@classorbit.test',
        password: accounts[0].password,
        role: 'ADMIN',
      },
      400,
    );
    await call(agents.STUDENT, 'get', '/api/admin/users', undefined, 403);
    await call(agents.STUDENT, 'post', '/api/studio/courses', {}, 403);
    await call(request(app), 'post', '/api/auth/demo', { role: 'ADMIN' }, 404);
    const account = accounts[0];
    await call(
      request(app),
      'post',
      '/api/auth/login',
      { email: account.email, password: 'incorrect-password' },
      401,
    );
  });
  let lessons = [];
  let quiz;
  await check('Instructor creates a draft, lessons, and an auto-graded quiz', async () => {
    const result = await call(
      agents.INSTRUCTOR,
      'post',
      '/api/studio/courses',
      {
        title: 'Web foundations: requests, APIs, and databases',
        description:
          'A short ClassOrbit demonstration course. Learn how browser requests reach an API and how PostgreSQL stores related learning records. Includes two written lessons and a knowledge check.',
        category: 'Development',
        level: 'Beginner',
        price: 0,
        color: 'mint',
      },
      201,
    );
    courseId = result.body.id;
    assert.equal(result.body.status, 'DRAFT');
    await call(agents.STUDENT, 'get', '/api/courses/' + courseId, undefined, 404);
    await call(
      agents.INSTRUCTOR,
      'patch',
      '/api/studio/courses/' + courseId,
      { status: 'PUBLISHED' },
      400,
    );
    for (const lesson of [
      {
        title: 'From browser to API',
        duration: 8,
        content:
          'A browser sends an HTTP request to a server. The request has a method, path, headers, and sometimes a body. GET reads a resource; POST commonly creates one. An Express route validates the request and returns a status code with JSON. A successful response commonly uses 200; a new resource commonly uses 201. Authentication proves who is making a request, while authorization determines what that person can do.\n\nPractice: Open the browser Network panel, reload ClassOrbit, and locate GET /api/bootstrap. Identify its method, status, and response type. Explain why role checks must run on the server.',
      },
      {
        title: 'Store learning records in PostgreSQL',
        duration: 10,
        content:
          'PostgreSQL persists relational data independently of the running Node.js process. A course belongs to an instructor; lessons belong to a course. An enrollment links a student to a course. Foreign keys keep those relationships valid. A unique constraint on userId and courseId prevents duplicate enrollment records. A transaction groups related writes so that they commit together or roll back together. Prisma translates repository operations into database queries.\n\nPractice: Sketch User, Course, Lesson, and Enrollment with their relationships. Explain why progress should remain available after the API restarts. Never put database credentials in React code or public repositories.',
      },
    ]) {
      const result = await call(
        agents.INSTRUCTOR,
        'post',
        '/api/studio/courses/' + courseId + '/lessons',
        lesson,
        201,
      );
      lessons.push(result.body);
    }
    const resultQuiz = await call(
      agents.INSTRUCTOR,
      'post',
      '/api/studio/courses/' + courseId + '/quizzes',
      {
        title: 'Web foundations knowledge check',
        passScore: 70,
        questions: [
          {
            prompt: 'Which HTTP method normally reads a resource?',
            options: ['GET', 'POST', 'DELETE'],
            correct: 0,
            explanation: 'GET retrieves a representation of a resource.',
          },
          {
            prompt: 'What links a student to a course in the database?',
            options: ['A CSS class', 'An enrollment record', 'A browser tab'],
            correct: 1,
            explanation: 'Enrollment stores the user and course relationship.',
          },
          {
            prompt: 'Where must access permissions be enforced?',
            options: ['Only in React', 'Only in the browser menu', 'On the server'],
            correct: 2,
            explanation: 'The server must check authorization for every protected operation.',
          },
        ],
      },
      201,
    );
    quiz = resultQuiz.body;
  });
  await check('Publishing exposes metadata and protects lesson content', async () => {
    await call(agents.INSTRUCTOR, 'patch', '/api/studio/courses/' + courseId, {
      status: 'PUBLISHED',
    });
    const result = await call(request(app), 'get', '/api/courses/' + courseId);
    assert.equal(result.body.access, false);
    assert.equal(result.body.lessons[0].content, undefined);
    assert.deepEqual(result.body.quizzes, []);
    await call(agents.STUDENT, 'post', '/api/lessons/' + lessons[0].id + '/complete', {}, 403);
  });
  await check('Free enrollment persists once and unlocks learning content', async () => {
    for (let i = 0; i < 2; i++)
      await call(agents.STUDENT, 'post', '/api/courses/' + courseId + '/enroll', {});
    assert.equal(await prisma.enrollment.count({ where: { userId: accounts[0].id, courseId } }), 1);
    const result = await call(agents.STUDENT, 'get', '/api/courses/' + courseId);
    assert.equal(result.body.access, true);
    assert.equal(result.body.lessons[0].content, lessons[0].content);
    assert.equal(result.body.quizzes[0].questions[0].correct, undefined);
    assert.equal(result.body.quizzes[0].questions[0].explanation, undefined);
  });
  await check('Incomplete lessons and failed quizzes block certificates', async () => {
    await call(agents.STUDENT, 'post', '/api/courses/' + courseId + '/certificate', {}, 400);
    await call(
      agents.STUDENT,
      'post',
      '/api/quizzes/' + quiz.id + '/attempts',
      { answers: [0] },
      400,
    );
    const failed = await call(agents.STUDENT, 'post', '/api/quizzes/' + quiz.id + '/attempts', {
      answers: [1, 0, 0],
    });
    assert.equal(failed.body.score, 0);
    assert.equal(failed.body.passed, false);
  });
  await check('Lesson completion persists once and reports 100 percent progress', async () => {
    for (const lesson of lessons)
      await call(agents.STUDENT, 'post', '/api/lessons/' + lesson.id + '/complete', {});
    const repeated = await call(
      agents.STUDENT,
      'post',
      '/api/lessons/' + lessons[0].id + '/complete',
      {},
    );
    assert.equal(repeated.body.percent, 100);
    assert.equal(repeated.body.eligible, false);
    assert.equal(
      await prisma.progress.count({
        where: { userId: accounts[0].id, lessonId: { in: lessons.map((l) => l.id) } },
      }),
      2,
    );
    await call(agents.STUDENT, 'post', '/api/courses/' + courseId + '/certificate', {}, 400);
  });
  await check('Server auto-grades a passing quiz and issues one certificate', async () => {
    const passed = await call(agents.STUDENT, 'post', '/api/quizzes/' + quiz.id + '/attempts', {
      answers: [0, 1, 2],
    });
    assert.equal(passed.body.score, 100);
    assert.equal(passed.body.passed, true);
    const certificate = await call(
      agents.STUDENT,
      'post',
      '/api/courses/' + courseId + '/certificate',
      {},
    );
    report.certificateId = certificate.body.id;
    const repeated = await call(
      agents.STUDENT,
      'post',
      '/api/courses/' + courseId + '/certificate',
      {},
    );
    assert.equal(repeated.body.id, report.certificateId);
    assert.equal(
      await prisma.certificate.count({ where: { userId: accounts[0].id, courseId } }),
      1,
    );
  });
  await check('Certificate PDF downloads, verifies publicly, and enforces ownership', async () => {
    const result = await call(
      agents.STUDENT,
      'get',
      '/api/certificates/' + report.certificateId + '/pdf',
    );
    assert.match(result.headers['content-type'], /application\/pdf/);
    assert.ok(Buffer.isBuffer(result.body));
    assert.equal(result.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(result.body.length > 1000);
    await writeFile(path.join(directory, 'certificate.pdf'), result.body);
    const verified = await call(
      request(app),
      'get',
      '/api/certificates/' + report.certificateId + '/verify',
    );
    assert.equal(verified.body.valid, true);
    assert.equal(verified.body.name, accounts[0].name);
    await call(
      agents.INSTRUCTOR,
      'get',
      '/api/certificates/' + report.certificateId + '/pdf',
      undefined,
      403,
    );
    await call(
      request(app),
      'get',
      '/api/certificates/' + report.certificateId + '/pdf',
      undefined,
      401,
    );
    await call(agents.ADMIN, 'get', '/api/certificates/' + report.certificateId + '/pdf');
  });
  await check(
    'Revoking teaching access locks the same instructor session and video upload',
    async () => {
      const teacher = accounts.find((a) => a.role === 'INSTRUCTOR');
      await call(agents.ADMIN, 'patch', '/api/admin/users/' + teacher.id + '/instructor-access', {
        approved: false,
      });
      await call(
        agents.INSTRUCTOR,
        'patch',
        '/api/studio/courses/' + courseId,
        { title: 'Unauthorized update' },
        403,
      );
      await call(
        agents.INSTRUCTOR,
        'post',
        '/api/studio/lessons/' + lessons[0].id + '/video',
        {},
        403,
      );
      await call(agents.ADMIN, 'patch', '/api/admin/users/' + teacher.id + '/instructor-access', {
        approved: true,
      });
      const result = await call(agents.INSTRUCTOR, 'get', '/api/bootstrap');
      assert.equal(result.body.user.instructorApproved, true);
    },
  );
  await check(
    'Fresh database connection and API instance preserve the learning state',
    async () => {
      await db.close();
      prisma = new PrismaClient({ log: [] });
      db = createPrismaRepository(prisma);
      app = await createApp(db);
      const student = request.agent(app);
      await call(student, 'post', '/api/auth/login', {
        email: accounts[0].email,
        password: accounts[0].password,
      });
      const result = await call(student, 'get', '/api/bootstrap');
      assert.equal(result.body.mode, 'postgresql');
      const learning = result.body.learning.find((item) => item.courseId === courseId);
      assert.equal(learning.percent, 100);
      assert.equal(learning.eligible, true);
      assert.ok(result.body.certificates.some((item) => item.id === report.certificateId));
      assert.equal(
        await prisma.attempt.count({ where: { userId: accounts[0].id, quizId: quiz.id } }),
        2,
      );
      assert.equal(await prisma.payment.count({ where: { courseId } }), 0);
    },
  );
  report.courseId = courseId;
  if (keep) {
    await writeFile(
      path.join(directory, 'accounts.json'),
      JSON.stringify({ appUrl: config.appUrl, courseId, accounts }, null, 2),
      { mode: 0o600 },
    );
    credentialsSaved = true;
  }
  succeeded = true;
} catch (error) {
  // Do not print Prisma errors, response bodies, credentials, or connection URLs.
  report.failure = {
    type: error.name,
    code: error.code || null,
    message:
      error.name === 'AssertionError'
        ? error.message
        : 'Verification stopped; inspect the last completed check.',
  };
  console.error('FAIL ' + report.failure.message + (error.code ? ' (' + error.code + ')' : ''));
  process.exitCode = 1;
} finally {
  const retain = succeeded && keep && credentialsSaved;
  report.fixturesRetained = retain;
  if (!retain) {
    try {
      await cleanup();
      report.cleanup = 'completed';
      console.log('Removed only this run’s temporary fixture records.');
    } catch (error) {
      report.cleanup = 'failed';
      console.error(
        'Fixture cleanup failed' +
          (error.code ? ' (' + error.code + ')' : '') +
          '; see the run ID in the report.',
      );
      process.exitCode = 1;
    }
  }
  report.passed = succeeded && (retain || report.cleanup === 'completed');
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await db.close();
  console.log('Report: ' + path.relative(config.root, path.join(directory, 'report.json')));
  if (retain)
    console.log(
      'Private demo credentials: ' +
        path.relative(config.root, path.join(directory, 'accounts.json')),
    );
  console.log(report.checks.length + ' learning-flow checks passed.');
}
