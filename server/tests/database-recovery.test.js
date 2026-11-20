import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createPrismaRepository } from '../src/repositories/prisma.js';
import { authenticate, auth } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errors.js';
import { config } from '../src/config/index.js';

const failure = (code) => Object.assign(new Error('simulated database failure'), { code });
const clientFor = (methods) => ({
  user: methods,
  $transaction: async (fn) => fn({ user: methods }),
  $disconnect: async () => {},
});

test('a database read recovers once after a temporary connection failure', async () => {
  let calls = 0;
  const db = createPrismaRepository(
    clientFor({
      findUnique: async () => {
        if (++calls === 1) throw failure('P1017');
        return { id: 'learner' };
      },
    }),
  );
  assert.equal((await db.get('user', 'learner')).id, 'learner');
  assert.equal(calls, 2);
});

test('a persistent connection failure has a bounded retry; configuration errors fail immediately', async () => {
  for (const [code, expected] of [
    ['P1001', 2],
    ['P1000', 1],
  ]) {
    let calls = 0;
    const db = createPrismaRepository(
      clientFor({
        findMany: async () => {
          calls++;
          throw failure(code);
        },
      }),
    );
    await assert.rejects(db.all('user'), (error) => error.code === code);
    assert.equal(calls, expected);
  }
});

test('writes and reads inside a transaction are never replayed after a connection failure', async () => {
  let writes = 0,
    reads = 0;
  const db = createPrismaRepository(
    clientFor({
      create: async () => {
        writes++;
        throw failure('P1017');
      },
      findMany: async () => {
        reads++;
        throw failure('P1017');
      },
    }),
  );
  await assert.rejects(db.insert('user', { id: 'learner' }), (e) => e.code === 'P1017');
  await assert.rejects(
    db.atomic((tx) => tx.all('user')),
    (e) => e.code === 'P1017',
  );
  assert.equal(writes, 1);
  assert.equal(reads, 1);
});

test('a database outage returns 503 while preserving a valid session for the next request', async () => {
  let unavailable = true;
  const app = express();
  app.use(cookieParser());
  app.use(
    authenticate({
      get: async () => {
        if (unavailable) throw failure('P1001');
        return { id: 'learner', role: 'STUDENT' };
      },
    }),
  );
  app.get('/protected', auth, (req, res) => res.json({ id: req.user.id }));
  app.use(errorHandler);
  const token = jwt.sign({ sub: 'learner' }, config.secret, {
    expiresIn: '5m',
    algorithm: 'HS256',
  });
  const cookie = 'classorbit_session=' + token;
  const failed = await request(app).get('/protected').set('Cookie', cookie).expect(503);
  assert.equal(failed.body.code, 'DATABASE_UNAVAILABLE');
  assert.equal(failed.headers['retry-after'], '2');
  assert.equal(failed.headers['set-cookie'], undefined);
  unavailable = false;
  const recovered = await request(app).get('/protected').set('Cookie', cookie).expect(200);
  assert.equal(recovered.body.id, 'learner');
});

test('an invalid session still returns 401 without querying the database', async () => {
  let queries = 0;
  const app = express();
  app.use(cookieParser());
  app.use(
    authenticate({
      get: async () => {
        queries++;
        throw failure('P1001');
      },
    }),
  );
  app.get('/protected', auth, (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  await request(app).get('/protected').set('Cookie', 'classorbit_session=invalid').expect(401);
  assert.equal(queries, 0);
});
