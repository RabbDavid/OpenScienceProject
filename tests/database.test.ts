import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../server/database.ts';
import { Store } from '../server/store.ts';
import { createConfiguredStore } from '../server/config.ts';
import { migration3TaskIds } from '../server/catalog.ts';

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
    assert.equal((await store.tasks()).length, 8);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 3 adds interpretability questions without changing existing definitions or leases', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'osc-migration-'));
  const path = join(directory, 'commons.sqlite');
  let store = new Store(path);
  try {
    await store.ready;
    // Construct the previous version's six-task instance, including a locally revised definition.
    for (const taskId of migration3TaskIds)
      await store.db.prepare('DELETE FROM tasks WHERE id=?').run(taskId);
    await store.db.prepare('UPDATE schema_metadata SET version=2 WHERE id=1').run();
    const task = await store.task('battery-metadata-map');
    await store.db
      .prepare('UPDATE tasks SET payload=?,revision=7 WHERE id=?')
      .run(JSON.stringify({ ...task, title: 'Operator-maintained question' }), task.id);
    const key = await store.createKey('Migration test agent', 'contributor');
    await store.claim(task.id, await store.authenticate(key.key), 7);
    const original = await store.db.prepare('SELECT * FROM tasks ORDER BY id').all();
    await store.close();
    store = new Store(path);
    await store.ready;
    const originalIds = new Set(original.map((row) => row.id));
    const migrated = await store.db.prepare('SELECT * FROM tasks ORDER BY id').all();
    assert.deepEqual(
      migrated.filter((row) => originalIds.has(row.id)),
      original,
    );
    assert.equal(migrated.length, 8);
    assert.equal(
      Number(
        (await store.db.prepare('SELECT version FROM schema_metadata WHERE id=1').get())?.version,
      ),
      5,
    );
    assert.equal((await store.tasks()).filter((task) => task.fieldId === 'mechinterp').length, 2);
    await store.close();
    store = new Store(path);
    await store.ready;
    assert.deepEqual(await store.db.prepare('SELECT * FROM tasks ORDER BY id').all(), migrated);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 4 moves materials questions to the materials field ID and changes nothing else', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'osc-migration-'));
  const path = join(directory, 'commons.sqlite');
  let store = new Store(path);
  try {
    await store.ready;
    // Construct the previous version, where these questions belonged to "reproducibility".
    const task = await store.task('matbench-split-audit');
    await store.db
      .prepare('UPDATE tasks SET payload=?,revision=5 WHERE id=?')
      .run(
        JSON.stringify({ ...task, fieldId: 'reproducibility', title: 'Operator-maintained title' }),
        task.id,
      );
    await store.db.prepare('UPDATE schema_metadata SET version=3 WHERE id=1').run();
    const key = await store.createKey('Migration test agent', 'contributor');
    await store.claim(task.id, await store.authenticate(key.key), 5);
    const before = await store.task(task.id);
    await store.close();
    store = new Store(path);
    await store.ready;
    const migrated = await store.task(task.id);
    assert.deepEqual(migrated, { ...before, fieldId: 'materials' });
    assert.equal(migrated.title, 'Operator-maintained title');
    assert.equal(migrated.status, 'claimed');
    assert.equal((await store.tasks()).filter((t) => t.fieldId === 'materials').length, 2);
    assert.equal(
      (await store.tasks()).filter((t) => (t.fieldId as string) === 'reproducibility').length,
      0,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
