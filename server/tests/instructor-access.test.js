import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
let db, app, admin, student, applicant, applicantId;
const course = {
  title: 'An approved teaching course',
  description: 'A course used to verify teaching permissions and approval.',
  category: 'Development',
  level: 'Beginner',
  price: 0,
  color: 'mint',
};
beforeEach(async () => {
  db = await createDatabase({ demo: true, file: null });
  await seed(db);
  app = await createApp(db);
  admin = request.agent(app);
  student = request.agent(app);
  applicant = request.agent(app);
  await admin.post('/api/auth/demo').send({ role: 'ADMIN' }).expect(200);
  await student.post('/api/auth/demo').send({ role: 'STUDENT' }).expect(200);
  const result = await applicant
    .post('/api/auth/register')
    .send({
      name: 'New Instructor',
      email: 'teacher@example.com',
      password: 'TeachingPass123!',
      role: 'INSTRUCTOR',
      instructorApproved: true,
    })
    .expect(201);
  applicantId = result.body.user.id;
});
afterEach(async () => {
  await db.close();
});

test('instructor self-registration permits login and learning but cannot self-approve or create content', async () => {
  const user = await db.get('user', applicantId);
  assert.equal(user.role, 'INSTRUCTOR');
  assert.equal(user.instructorApproved, false);
  await applicant.post('/api/auth/logout').send({}).expect(200);
  const login = await applicant
    .post('/api/auth/login')
    .send({ email: 'teacher@example.com', password: 'TeachingPass123!' })
    .expect(200);
  assert.equal(login.body.user.role, 'INSTRUCTOR');
  assert.equal(login.body.user.instructorApproved, false);
  await applicant.post('/api/courses/learning-habits/enroll').send({}).expect(200);
  const blocked = await applicant.post('/api/studio/courses').send(course).expect(403);
  assert.equal(blocked.body.code, 'INSTRUCTOR_APPROVAL_REQUIRED');
  await applicant
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: true })
    .expect(403);
  await student
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: true })
    .expect(403);
  assert.equal((await db.all('course')).length, 4);
});

test('admin approval unlocks teaching and revocation blocks the existing session including multipart video uploads', async () => {
  await admin
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: true })
    .expect(200);
  const result = await applicant.post('/api/studio/courses').send(course).expect(201);
  const lesson = await applicant
    .post('/api/studio/courses/' + result.body.id + '/lessons')
    .send({ title: 'A sample lesson', content: 'Lesson text', duration: 10 })
    .expect(201);
  // Approved requests pass authorization and reach the demo-mode service check.
  await applicant
    .post('/api/studio/lessons/' + lesson.body.id + '/video')
    .attach('video', Buffer.from('sample'), { filename: 'sample.mp4', contentType: 'video/mp4' })
    .expect(503);
  await admin
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: false })
    .expect(200);
  const upload = await applicant
    .post('/api/studio/lessons/' + lesson.body.id + '/video')
    .attach('video', Buffer.from('sample'), { filename: 'sample.mp4', contentType: 'video/mp4' })
    .expect(403);
  assert.equal(upload.body.code, 'INSTRUCTOR_APPROVAL_REQUIRED');
  assert.equal((await db.get('lesson', lesson.body.id)).videoStatus, 'EMPTY');
  await applicant
    .patch('/api/studio/courses/' + result.body.id)
    .send({ status: 'PUBLISHED' })
    .expect(403);
  await applicant.post('/api/studio/courses').send(course).expect(403);
  await applicant.post('/api/studio/live-classes').send({}).expect(403);
  await applicant.get('/api/studio/revenue').expect(403);
  const bootstrap = await applicant.get('/api/bootstrap').expect(200);
  assert.equal(bootstrap.body.user.role, 'INSTRUCTOR');
  assert.equal(bootstrap.body.user.instructorApproved, false);
});

test('teaching approval validates the target and role changes clear previous permission', async () => {
  await request(app)
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: true })
    .expect(401);
  await admin
    .patch('/api/admin/users/student-demo/instructor-access')
    .send({ approved: true })
    .expect(400);
  await admin
    .patch('/api/admin/users/missing/instructor-access')
    .send({ approved: true })
    .expect(404);
  await admin
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: 'true' })
    .expect(400);
  await admin
    .patch('/api/admin/users/' + applicantId + '/instructor-access')
    .send({ approved: true })
    .expect(200);
  await admin
    .patch('/api/admin/users/' + applicantId + '/role')
    .send({ role: 'STUDENT' })
    .expect(200);
  await admin
    .patch('/api/admin/users/' + applicantId + '/role')
    .send({ role: 'INSTRUCTOR' })
    .expect(200);
  assert.equal((await db.get('user', applicantId)).instructorApproved, false);
  await applicant.post('/api/studio/courses').send(course).expect(403);
});
