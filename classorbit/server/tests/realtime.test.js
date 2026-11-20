import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { attachRealtime } from '../src/sockets/classroom.js';
import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
const event = (socket, name, ms = 3000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, done);
      reject(new Error('Timed out waiting for ' + name));
    }, ms);
    function done(value) {
      clearTimeout(timeout);
      resolve(value);
    }
    socket.once(name, done);
  });
test('live rooms authenticate, authorize, persist chat, and isolate signaling', async (t) => {
  const db = await createDatabase({ demo: true, file: null });
  await seed(db);
  const app = await createApp(db);
  const server = createServer(app);
  const io = attachRealtime(server, db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise((resolve) => io.close(resolve));
    await db.close();
  });
  const anonymous = connect(url, { transports: ['websocket'], reconnection: false });
  sockets.push(anonymous);
  assert.match((await event(anonymous, 'connect_error')).message, /Sign in/);
  async function login(role) {
    const r = await request(app).post('/api/auth/demo').send({ role });
    const socket = connect(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: r.headers['set-cookie'][0].split(';')[0] },
    });
    sockets.push(socket);
    await event(socket, 'connect');
    return socket;
  }
  const student = await login('STUDENT'),
    instructor = await login('INSTRUCTOR');
  const denied = await student.timeout(3000).emitWithAck('join-class', 'live-2');
  assert.match(denied.error, /Enroll/);
  const a = await student.timeout(3000).emitWithAck('join-class', 'live-0');
  assert.equal(a.peers.length, 0);
  const b = await instructor.timeout(3000).emitWithAck('join-class', 'live-0');
  assert.equal(b.peers[0].user.id, 'student-demo');
  const incoming = event(student, 'chat-message');
  await instructor.timeout(3000).emitWithAck('chat', 'Hello, learners!');
  assert.equal((await incoming).text, 'Hello, learners!');
  assert.equal((await db.all('chatMessage', { liveClassId: 'live-0' })).length, 1);
  const signal = event(student, 'signal');
  instructor.emit('signal', { to: student.id, description: { type: 'offer', sdp: 'test-offer' } });
  assert.equal((await signal).description.sdp, 'test-offer');
  await instructor.timeout(3000).emitWithAck('join-class', 'live-1');
  const blocked = event(student, 'signal', 150).then(
    () => false,
    () => true,
  );
  instructor.emit('signal', { to: student.id, description: { type: 'offer', sdp: 'cross-room' } });
  assert.equal(await blocked, true);
  student.emit('signal', null);
  student.emit('signal', { to: instructor.id, description: 123 });
  student.emit('chat', 'A harmless test message', 'invalid-ack');
  const healthy = await student.timeout(3000).emitWithAck('chat', 'Still connected');
  assert.equal(healthy.ok, true);
  const empty = await instructor.timeout(3000).emitWithAck('chat', '   ');
  assert.match(empty.error, /1–1000/);
});
