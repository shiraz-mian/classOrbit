import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
import { fulfillPayment, grade } from '../src/services/learning.service.js';
let db, app, student, instructor, admin;
before(async () => {
  db = await createDatabase({ demo: true, file: null });
  await seed(db);
  app = await createApp(db);
  student = request.agent(app);
  instructor = request.agent(app);
  admin = request.agent(app);
  for (const [agent, role] of [
    [student, 'STUDENT'],
    [instructor, 'INSTRUCTOR'],
    [admin, 'ADMIN'],
  ])
    await agent.post('/api/auth/demo').send({ role }).expect(200);
});
after(async () => {
  await db.close();
});
test('public catalog hides passwords and protected lesson contents', async () => {
  const r = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(r.body.courses.length, 4);
  assert.equal(r.body.user, null);
  assert.ok(!JSON.stringify(r.body).includes('passwordHash'));
  const d = await request(app).get('/api/courses/react-foundations').expect(200);
  assert.equal(d.body.access, false);
  assert.equal(d.body.lessons[0].content, undefined);
  assert.deepEqual(d.body.quizzes, []);
});
test('authentication returns safe user and rejects invalid passwords', async () => {
  const r = await request(app)
    .post('/api/auth/login')
    .send({ email: 'student@classorbit.dev', password: 'ClassOrbit123!' })
    .expect(200);
  assert.equal(r.body.user.role, 'STUDENT');
  assert.equal(r.body.user.passwordHash, undefined);
  assert.match(r.headers['set-cookie'][0], /HttpOnly/);
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'student@classorbit.dev', password: 'wrong' })
    .expect(401);
});
test('registration defaults to student and rejects admin role escalation', async () => {
  const r = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'New Learner',
      email: 'new@example.com',
      password: 'ComplexPass123!',
    })
    .expect(201);
  assert.equal(r.body.user.role, 'STUDENT');
  assert.equal(r.body.user.instructorApproved, false);
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Escalation',
      email: 'not-admin@example.com',
      password: 'ComplexPass123!',
      role: 'ADMIN',
    })
    .expect(400);
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Duplicate', email: 'new@example.com', password: 'ComplexPass123!' })
    .expect(409);
});
test('cross-origin mutations and student access to instructor APIs are denied', async () => {
  await student
    .post('/api/courses/learning-habits/enroll')
    .set('Origin', 'https://attacker.example')
    .send({})
    .expect(403);
  await student.post('/api/studio/courses').send({}).expect(403);
  await student.get('/api/admin/users').expect(403);
  await request(app).get('/api/studio/revenue').expect(401);
});
test('quiz answer keys are withheld until a valid submission', async () => {
  const r = await student.get('/api/courses/react-foundations').expect(200);
  assert.equal(r.body.quizzes[0].questions[0].correct, undefined);
  await student
    .post('/api/quizzes/react-foundations-quiz/attempts')
    .send({ answers: [0] })
    .expect(400);
  await student
    .post('/api/quizzes/react-foundations-quiz/attempts')
    .send({ answers: [0, 9, 1] })
    .expect(400);
  const fail = await student
    .post('/api/quizzes/react-foundations-quiz/attempts')
    .send({ answers: [2, 0, 0] })
    .expect(200);
  assert.equal(fail.body.passed, false);
  assert.equal(fail.body.score, 0);
});
test('unpaid learners cannot read protected content, progress, quiz, or room config', async () => {
  const outsider = request.agent(app);
  await outsider
    .post('/api/auth/login')
    .send({ email: 'new@example.com', password: 'ComplexPass123!' })
    .expect(200);
  await outsider.post('/api/courses/react-foundations/enroll').send({}).expect(402);
  await outsider.get('/api/lessons/react-foundations-lesson-0/playback').expect(403);
  await outsider.post('/api/lessons/react-foundations-lesson-0/complete').send({}).expect(403);
  await outsider
    .post('/api/quizzes/react-foundations-quiz/attempts')
    .send({ answers: [0, 1, 1] })
    .expect(403);
  await outsider.get('/api/live-classes/live-0/config').expect(403);
});
test('certificates require all lessons and all quizzes; retries return the same certificate', async () => {
  await student.post('/api/courses/react-foundations/certificate').send({}).expect(400);
  for (let i = 0; i < 5; i++)
    await student
      .post('/api/lessons/react-foundations-lesson-' + i + '/complete')
      .send({})
      .expect(200);
  await student.post('/api/courses/react-foundations/certificate').send({}).expect(400);
  const result = await student
    .post('/api/quizzes/react-foundations-quiz/attempts')
    .send({ answers: [0, 1, 1] })
    .expect(200);
  assert.equal(result.body.score, 100);
  const a = await student.post('/api/courses/react-foundations/certificate').send({}).expect(200);
  const b = await student.post('/api/courses/react-foundations/certificate').send({}).expect(200);
  assert.equal(a.body.id, b.body.id);
  const pdf = await student.get('/api/certificates/' + a.body.id + '/pdf').expect(200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.ok(pdf.body.length > 1000);
  const verify = await request(app)
    .get('/api/certificates/' + a.body.id + '/verify')
    .expect(200);
  assert.equal(verify.body.valid, true);
});
test('progress records and free enrollments are idempotent', async () => {
  await student.post('/api/lessons/react-foundations-lesson-0/complete').send({}).expect(200);
  assert.equal(
    (await db.all('progress', { userId: 'student-demo', lessonId: 'react-foundations-lesson-0' }))
      .length,
    1,
  );
  await student.post('/api/courses/learning-habits/enroll').send({}).expect(200);
  assert.equal(
    (await db.all('enrollment', { userId: 'student-demo', courseId: 'learning-habits' })).length,
    1,
  );
});
test('demo checkout grants access and rejects an already-enrolled second payment', async () => {
  await student.post('/api/courses/design-systems/checkout').send({}).expect(200);
  const course = await student.get('/api/courses/design-systems').expect(200);
  assert.equal(course.body.access, true);
  await student.post('/api/courses/design-systems/checkout').send({}).expect(409);
});
test('payment fulfillment is idempotent and rejects an amount mismatch', async () => {
  const payment = {
    id: 'test-fulfill',
    userId: 'student-demo',
    courseId: 'node-api',
    amount: 5900,
    currency: 'usd',
    provider: 'DEMO',
  };
  await fulfillPayment(db, payment);
  await fulfillPayment(db, payment);
  assert.equal((await db.all('payment')).filter((p) => p.id === payment.id).length, 1);
  await assert.rejects(
    fulfillPayment(db, { ...payment, id: 'mismatch', amount: 1 }),
    /does not match/,
  );
});
test('course publishing requires lessons and editing requires ownership', async () => {
  const r = await instructor
    .post('/api/studio/courses')
    .send({
      title: 'A test course',
      description: 'A useful course for testing instructor authoring.',
      category: 'Development',
      level: 'Beginner',
      price: 0,
      color: 'mint',
    })
    .expect(201);
  const id = r.body.id;
  await instructor
    .patch('/api/studio/courses/' + id)
    .send({ status: 'PUBLISHED' })
    .expect(400);
  await instructor
    .post('/api/studio/courses/' + id + '/lessons')
    .send({ title: 'A useful lesson', content: 'Test content', duration: 10 })
    .expect(201);
  await instructor
    .patch('/api/studio/courses/' + id)
    .send({ status: 'PUBLISHED' })
    .expect(200);
  await db.insert('user', {
    id: 'other-instructor',
    name: 'Other',
    email: 'other@example.com',
    passwordHash: 'unused',
    role: 'INSTRUCTOR',
    createdAt: new Date(),
  });
  await db.patch('course', id, { instructorId: 'other-instructor' });
  await instructor
    .patch('/api/studio/courses/' + id)
    .send({ title: 'Unauthorized edit' })
    .expect(403);
});
test('admin can assign instructor roles but cannot demote themselves', async () => {
  await admin.patch('/api/admin/users/admin-demo/role').send({ role: 'STUDENT' }).expect(400);
  const users = await admin.get('/api/admin/users').expect(200);
  const u = users.body.find((u) => u.email === 'new@example.com');
  await admin
    .patch('/api/admin/users/' + u.id + '/role')
    .send({ role: 'INSTRUCTOR' })
    .expect(200);
  assert.equal((await db.get('user', u.id)).role, 'INSTRUCTOR');
});
test('unauthorized certificate download is denied', async () => {
  await instructor.get('/api/certificates/CO-DEMO-HABITS/pdf').expect(403);
});
test('quiz authoring validates answer indexes and future live schedules', async () => {
  await instructor
    .post('/api/studio/courses/node-api/quizzes')
    .send({
      title: 'Invalid quiz',
      passScore: 70,
      questions: [{ prompt: 'A valid question?', options: ['A', 'B'], correct: 7 }],
    })
    .expect(400);
  await instructor
    .post('/api/studio/live-classes')
    .send({
      courseId: 'node-api',
      title: 'Past live class',
      startsAt: '2020-01-01T12:00:00.000Z',
      duration: 60,
    })
    .expect(400);
  await instructor
    .post('/api/studio/live-classes')
    .send({
      courseId: 'node-api',
      title: 'Future live workshop',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      duration: 60,
    })
    .expect(201);
});
