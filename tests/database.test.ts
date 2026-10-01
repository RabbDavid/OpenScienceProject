import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../server/database.ts';
import { Store } from '../server/store.ts';
import { createConfiguredStore } from '../server/config.ts';

test('cloud configuration refuses ephemeral storage and incomplete credentials', () => {
  assert.throws(() => createConfiguredStore({ VERCEL: '1' }), /persistent cloud storage/);
  assert.throws(
    () => createConfiguredStore({ TURSO_AUTH_TOKEN: 'unused' }),
    /persistent cloud storage/,
  );
  assert.throws(
    () => createConfiguredStore({ TURSO_DATABASE_URL: 'file:temporary.sqlite' }),
    /libsql/,
  );
  assert.throws(
    () => createConfiguredStore({ TURSO_DATABASE_URL: 'libsql://example.turso.io' }),
    /TURSO_AUTH_TOKEN/,
  );
});

test('awaited local transactions isolate concurrent requests and roll back failures', async () => {
  const db = new Database(':memory:');
  await db.exec('CREATE TABLE values_test (value INTEGER)');
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let continueTransaction!: () => void;
  const gate = new Promise<void>((resolve) => {
    continueTransaction = resolve;
  });
  const transaction = db.transaction(async () => {
    await db.prepare('INSERT INTO values_test VALUES (?)').run(42);
    entered();
    await gate;
    throw new Error('rollback');
  });
  await started;
  const outsideRead = db.prepare('SELECT * FROM values_test').all();
  continueTransaction();
  await assert.rejects(transaction, /rollback/);
  assert.deepEqual(await outsideRead, []);
  db.close();
});

test('write budgets survive a process restart and expire independently of API instances', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'osc-budget-'));
  const path = join(directory, 'commons.sqlite');
  let store = new Store(path);
  try {
    const identity = await store.createKey('Budget test', 'contributor');
    for (let i = 0; i < 30; i++)
      assert.equal(await store.consumeWriteBudget(identity.actorId), true);
    await store.close();
    store = new Store(path);
    assert.equal(await store.consumeWriteBudget(identity.actorId), false);
    await store.db
      .prepare('UPDATE write_budgets SET reset_at=0 WHERE actor_id=?')
      .run(identity.actorId);
    assert.equal(await store.consumeWriteBudget(identity.actorId), true);
    assert.equal((await store.tasks()).length, 6);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
