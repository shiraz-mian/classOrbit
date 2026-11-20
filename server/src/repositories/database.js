import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { createPrismaRepository } from './prisma.js';
const models = [
  'user',
  'course',
  'lesson',
  'enrollment',
  'progress',
  'quiz',
  'attempt',
  'liveClass',
  'payment',
  'checkoutOrder',
  'certificate',
  'webhookEvent',
  'chatMessage',
];
export async function createDatabase({
  demo = config.demo,
  file = path.join(config.root, '.data/demo.json'),
} = {}) {
  if (!demo) {
    const { PrismaClient } = await import('@prisma/client');
    const client = new PrismaClient();
    return createPrismaRepository(client);
  }
  let state = Object.fromEntries(models.map((m) => [m, []]));
  if (file) {
    try {
      state = { ...state, ...JSON.parse(await readFile(file, 'utf8')) };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  // Accounts in older demo files were created before instructor self-registration.
  for (const user of state.user)
    if (user.instructorApproved === undefined) user.instructorApproved = user.role === 'INSTRUCTOR';
  let chain = Promise.resolve();
  const persist = async () => {
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + '.tmp', JSON.stringify(state, null, 2));
    await rename(file + '.tmp', file);
  };
  const uniqueFields = {
    user: ['email'],
    enrollment: ['userId', 'courseId'],
    progress: ['userId', 'lessonId'],
    certificate: ['userId', 'courseId'],
    lesson: ['courseId', 'position'],
    checkoutOrder: ['providerOrderId'],
    payment: ['checkoutId'],
  };
  const view = {
    all: async (m, where = {}) =>
      structuredClone(
        state[m].filter((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
      ),
    get: async (m, id) => structuredClone(state[m].find((r) => r.id === id) || null),
    insert: async (m, data) => {
      const keys = uniqueFields[m];
      if (
        state[m].some(
          (r) =>
            r.id === data.id || (keys && keys.every((k) => data[k] != null && r[k] === data[k])),
        )
      ) {
        const e = new Error('This record already exists');
        e.code = 'P2002';
        throw e;
      }
      state[m].push(structuredClone(data));
      return structuredClone(data);
    },
    patch: async (m, id, data) => {
      const row = state[m].find((r) => r.id === id);
      if (!row) throw new Error('Record not found');
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    },
  };
  const atomic = (fn) => {
    const operation = chain.then(async () => {
      const before = structuredClone(state);
      try {
        const result = await fn(view);
        await persist();
        return result;
      } catch (e) {
        state = before;
        throw e;
      }
    });
    chain = operation.catch(() => {});
    return operation;
  };
  return {
    ...view,
    insert: (m, d) => atomic((tx) => tx.insert(m, d)),
    patch: (m, id, d) => atomic((tx) => tx.patch(m, id, d)),
    atomic,
    close: async () => {
      await chain;
    },
  };
}
