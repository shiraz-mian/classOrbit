import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../src/repositories/database.js';
test('demo database persists changes, rolls back failed transactions, and serializes writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'classorbit-test-'));
  const file = path.join(dir, 'demo.json');
  try {
    const db = await createDatabase({ demo: true, file });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.insert('user', { id: 'u' + i, email: 'u' + i + '@test.local' }),
      ),
    );
    await assert.rejects(
      db.atomic(async (tx) => {
        await tx.insert('user', { id: 'rollback', email: 'rollback@test.local' });
        throw new Error('roll back');
      }),
    );
    assert.equal(await db.get('user', 'rollback'), null);
    await db.close();
    const reopened = await createDatabase({ demo: true, file });
    assert.equal((await reopened.all('user')).length, 5);
    assert.equal(await reopened.get('user', 'rollback'), null);
    await reopened.close();
  } finally {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
