import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { Notebook, noteSchema } from '../server/notebook.ts';
import { contextPacket } from '../server/context.ts';
import { policy } from '../server/catalog.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const store = new Store(':memory:');
  await store.ready;
  const author = await store.createKey('Notebook fixture author', 'contributor');
  const curator = await store.createKey('Notebook fixture independent curator', 'curator');
  const outsider = await store.createKey('Notebook fixture other researcher', 'contributor');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
  });
  const request = (path: string, key?: string, body?: unknown) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { store, author, curator, outsider, base, request, notebook: new Notebook(store) };
}
const handoff = (key = 'handoff_retry_001') => ({
  kind: 'handoff',
  taskId: 'matbench-split-audit',
  expectedTaskRevision: 1,
  idempotencyKey: key,
  title: 'Fixture-only research handoff',
  summary: 'Test record for continuation, not a scientific finding.',
  observations: 'The test researcher inspected only the task context; no experiments were run.',
  negativeResults: [
    'Fixture metadata search returned zero matches on this date; not evidence of an absent literature.',
  ],
  unresolved: ['The implementation remains uninspected in this fixture.'],
  sourcesSeen: ['matbench-paper'],
  risk: 'low',
  origin: 'agent',
});
const source = () => ({
  kind: 'source_candidate',
  taskId: 'matbench-split-audit',
  expectedTaskRevision: 1,
  idempotencyKey: 'candidate_fixture_001',
  title: 'Fixture-only candidate source',
  summary: 'An untrusted candidate for a curator to inspect, not approved evidence.',
  url: 'https://www.nature.com/articles/s41524-024-01316-4',
  rationale:
    'Fixture rationale: check whether this later paper is relevant before any catalog change.',
  risk: 'low',
  origin: 'agent',
});

test('immutable handoffs preserve continuation and idempotency without consuming a task lease', async () => {
  const f = await fixture();
  const before = await f.store.task('matbench-split-audit');
  const denied = await f.request('/api/v1/tasks/matbench-split-audit/notes', undefined, handoff());
  assert.equal(denied.status, 401);
  const created = await f.request(
    '/api/v1/tasks/matbench-split-audit/notes',
    f.author.key,
    handoff(),
  );
  assert.equal(created.status, 201);
  const { note } = await created.json();
  const replay = await f.request(
    '/api/v1/tasks/matbench-split-audit/notes',
    f.author.key,
    handoff(),
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).note.id, note.id);
  assert.deepEqual(await f.store.task(before.id), before);
  const conflict = await f.request('/api/v1/tasks/matbench-split-audit/notes', f.author.key, {
    ...handoff(),
    summary: 'Different content under the same retry key is a conflict.',
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    (await f.store.db.prepare('SELECT COUNT(*) AS count FROM research_notes').get())?.count,
    1,
  );
  assert.equal(
    (
      await f.store.db
        .prepare('SELECT count FROM write_budgets WHERE actor_id=?')
        .get(f.author.actorId)
    )?.count,
    1,
  );
  const packet = await contextPacket(f.store, before.id, 4096);
  assert.equal(packet.researchState.visibleNotes, 1);
  assert.deepEqual(packet.policy, policy);
  assert.equal(Buffer.byteLength(JSON.stringify(packet)), packet.budget.actualBytes);
  const read = await f.request(`/api/v1/notes/${note.id}`);
  const record = await read.json();
  assert.equal(record.note.negativeResults.length, 1);
  assert.equal(record.approvedCitationSource, false);
  assert.equal(record.note.idempotencyKey, undefined);
  assert.equal(Buffer.byteLength(JSON.stringify(record)), record.budget.actualBytes);
});

test('source proposals require independent review and never mutate approved sources', async () => {
  const f = await fixture();
  const before = await f.store.task('matbench-split-audit');
  const created = await f.request(`/api/v1/tasks/${before.id}/notes`, f.author.key, source());
  const { note } = await created.json();
  const selfCurator = await f.store.createKey('Notebook fixture author', 'curator');
  const review = {
    expectedReviewRevision: 0,
    decision: 'retain',
    rationale: 'Fixture: worth inspecting as a follow-up, with no approval of scientific claims.',
  };
  assert.equal(
    (await f.request(`/api/v1/notes/${note.id}/review`, selfCurator.key, review)).status,
    403,
  );
  assert.equal(
    (await f.request(`/api/v1/notes/${note.id}/review`, f.outsider.key, review)).status,
    403,
  );
  const reviewed = await f.request(`/api/v1/notes/${note.id}/review`, f.curator.key, review);
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).note.status, 'retained');
  assert.equal(
    (await f.request(`/api/v1/notes/${note.id}/review`, f.curator.key, review)).status,
    409,
  );
  assert.deepEqual(await f.store.task(before.id), before);
  const read = await (await f.request(`/api/v1/notes/${note.id}`)).json();
  assert.equal(read.approvedCitationSource, false);
  assert.equal(read.reviews.length, 1);
});

test('held note bodies, cards and moderation rationales remain restricted', async () => {
  const f = await fixture();
  const actor = await f.store.authenticate(f.author.key);
  const curator = await f.store.authenticate(f.curator.key);
  const held = await f.notebook.append(
    noteSchema.parse({
      ...handoff('held_note_fixture_001'),
      risk: 'high',
      observations: 'PRIVATE_NOTE_CANARY hidden content for privacy tests.',
    }),
    actor,
  );
  assert.equal((await f.request(`/api/v1/notes/${held.note.id}`)).status, 403);
  assert.equal((await f.request(`/api/v1/notes/${held.note.id}`, f.outsider.key)).status, 403);
  assert.equal((await f.request(`/api/v1/notes/${held.note.id}`, f.author.key)).status, 200);
  const listed = await (await f.request('/api/v1/tasks/matbench-split-audit/notes')).json();
  assert.equal(listed.total, 0);
  assert.doesNotMatch(JSON.stringify(listed), /PRIVATE_NOTE_CANARY/);
  await assert.rejects(
    f.notebook.review(held.note.id, curator, {
      expectedReviewRevision: 0,
      decision: 'retain',
      rationale: 'Risk cannot be resolved by changing review status.',
    }),
    /Risk-flagged/,
  );
  await f.notebook.review(held.note.id, curator, {
    expectedReviewRevision: 0,
    decision: 'dismiss',
    rationale: 'The high-risk fixture remains restricted after dismissal.',
  });
  assert.equal((await f.request(`/api/v1/notes/${held.note.id}`)).status, 403);
  const low = await f.notebook.append(noteSchema.parse(handoff('low_note_fixture_002')), actor);
  await f.notebook.review(low.note.id, curator, {
    expectedReviewRevision: 0,
    decision: 'hold',
    rationale: 'PRIVATE_MODERATION_CANARY only for curators and author.',
  });
  await f.notebook.review(low.note.id, curator, {
    expectedReviewRevision: 1,
    decision: 'retain',
    rationale: 'The fixture can be kept for follow-up after inspection.',
  });
  const publicRecord = await f.notebook.read(low.note.id, undefined, 16000, true);
  assert.doesNotMatch(JSON.stringify(publicRecord), /PRIVATE_MODERATION_CANARY/);
  const packet = await contextPacket(f.store, 'matbench-split-audit', 4096);
  assert.equal(packet.researchState.visibleNotes, 1);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE_NOTE_CANARY/);
});

test('notes enforce byte limits, source constraints, revisions, URL rules and shared persistent write quotas', async () => {
  const f = await fixture();
  const actor = await f.store.authenticate(f.author.key);
  for (const url of [
    'http://www.nature.com/paper',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://user:secret@www.nature.com/x',
    'https://machine.local/x',
    'javascript:alert(1)',
    'https://www.nature.com:444/x',
  ])
    assert.equal(noteSchema.safeParse({ ...source(), url }).success, false, url);
  const tooLarge = noteSchema.parse({ ...handoff(), observations: '科'.repeat(1499) });
  await assert.rejects(f.notebook.append(tooLarge, actor), /4096 UTF-8/);
  await assert.rejects(
    f.notebook.append(noteSchema.parse({ ...handoff(), expectedTaskRevision: 99 }), actor),
    /latest task/,
  );
  await assert.rejects(
    f.notebook.append(
      noteSchema.parse({ ...handoff(), sourcesSeen: ['sae-features-paper'] }),
      actor,
    ),
    /task-approved/,
  );
  for (let i = 0; i < 30; i++) await f.store.consumeWriteBudget(actor.id);
  await assert.rejects(f.notebook.append(noteSchema.parse(handoff()), actor), /Write limit/);
  assert.equal(
    (await f.store.db.prepare('SELECT COUNT(*) AS count FROM research_notes').get())?.count,
    0,
  );
});

test('public MCP stays read-only while invited MCP can leave memory for another researcher', async () => {
  const f = await fixture();
  const publicClient = new Client({ name: 'public-memory-fixture', version: '1' });
  const invited = new Client({ name: 'invited-memory-fixture', version: '1' });
  cleanups.push(
    () => publicClient.close(),
    () => invited.close(),
  );
  await publicClient.connect(new StreamableHTTPClientTransport(new URL(f.base + '/api/mcp')));
  const publicTools = (await publicClient.listTools()).tools;
  assert.equal(publicTools.length, 14);
  assert.ok(publicTools.every((tool) => tool.annotations?.readOnlyHint));
  assert.ok(!publicTools.some((tool) => tool.name === 'append_task_note'));
  const denied = await f.request('/api/mcp/contribute', undefined, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(denied.status, 401);
  await invited.connect(
    new StreamableHTTPClientTransport(new URL(f.base + '/api/mcp/contribute'), {
      requestInit: { headers: { Authorization: `Bearer ${f.author.key}` } },
    }),
  );
  const tools = (await invited.listTools()).tools;
  assert.equal(tools.length, 16);
  assert.equal(
    tools.find((tool) => tool.name === 'append_task_note')?.annotations?.readOnlyHint,
    false,
  );
  const { kind: _, ...input } = handoff();
  const write = await invited.callTool({ name: 'append_task_note', arguments: input });
  assert.ok(!write.isError);
  const record = JSON.parse((write.content as { type: string; text: string }[])[0].text);
  const read = await publicClient.callTool({
    name: 'get_task_note',
    arguments: { note_id: record.note.id, max_bytes: 16000 },
  });
  assert.ok(!read.isError);
  assert.match(JSON.stringify(read), /implementation remains uninspected/);
  const sourceWrite = await invited.callTool({
    name: 'propose_source',
    arguments: (({ kind: _, ...rest }) => rest)(source()),
  });
  assert.ok(!sourceWrite.isError);
  const context = await publicClient.callTool({
    name: 'get_question_context',
    arguments: { task_id: 'matbench-split-audit', max_bytes: 4096 },
  });
  assert.ok(!context.isError);
  const packet = JSON.parse((context.content as { type: string; text: string }[])[0].text);
  assert.equal(packet.researchState.visibleNotes, 2);
  assert.equal(packet.researchState.notes.length + packet.researchState.notesOmitted, 2);
  assert.ok(packet.budget.actualBytes <= 4096);
  await f.store.revokeKey(f.author.keyId);
  await assert.rejects(invited.listTools());
});

test('migration 5 preserves existing tasks and immutable notebook history across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'osc-notebook-'));
  const path = join(directory, 'research.sqlite');
  let store = new Store(path);
  try {
    await store.ready;
    await store.db.exec(
      'DROP TABLE note_reviews; DROP TABLE research_notes; UPDATE schema_metadata SET version=4',
    );
    const key = await store.createKey('Persistent notebook fixture', 'contributor');
    const actor = await store.authenticate(key.key);
    const before = await store.db.prepare('SELECT * FROM tasks ORDER BY id').all();
    await store.close();
    store = new Store(path);
    await store.ready;
    assert.deepEqual(await store.db.prepare('SELECT * FROM tasks ORDER BY id').all(), before);
    const notebook = new Notebook(store);
    const record = await notebook.append(noteSchema.parse(handoff()), actor);
    const original = await notebook.read(record.note.id, actor);
    await store.close();
    store = new Store(path);
    await store.ready;
    assert.deepEqual(await new Notebook(store).read(record.note.id, actor), original);
    assert.equal(
      (await store.db.prepare('SELECT version FROM schema_metadata WHERE id=1').get())?.version,
      5,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
