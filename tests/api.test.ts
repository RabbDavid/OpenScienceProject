import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { buildAtlas } from '../src/atlas.ts';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});
async function fixture(path = ':memory:') {
  const store = new Store(path);
  const app = createApp(store);
  const server = await new Promise<Server>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const address = server.address() as {
    port: number;
  };
  cleanups.push(async () => {
    server.closeAllConnections();
    server.close();
    await store.close();
  });
  const key = await store.createKey('Agent One', 'contributor');
  const keyTwo = await store.createKey('Agent Two', 'contributor');
  const curator = await store.createKey('Independent Curator', 'curator');
  const call = async (path: string, body?: unknown, bearer?: string, method?: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    return { response, data };
  };
  return { store, key, keyTwo, curator, call, origin: `http://127.0.0.1:${address.port}` };
}
const contribution = (overrides: Record<string, unknown> = {}) => ({
  taskId: 'battery-metadata-map',
  title: 'Cycling metadata should preserve study-specific definitions',
  kind: 'source_audit',
  summary:
    'This proposed checklist distinguishes bulk cycling metadata from reference performance tests and flags study-specific definitions.',
  body: 'Direct source observation: the archive explains that conditions for reference performance tests can differ from bulk cycling. Interpretation: a comparison should preserve this distinction and examine originating study descriptions before pooling measurements. No new measurements or experiments were conducted.',
  method:
    'Read the supplied metadata conventions and identified the section discussing bulk cycling and reference performance tests.',
  limitations:
    'This is a source audit only. Original datasets and experimental papers were not independently downloaded or reproduced.',
  citations: [
    {
      sourceId: 'battery-metadata',
      locator: 'Rules for Metadata, paragraph before Cell ID breakdown',
      supports:
        'The archive distinguishes bulk cycling conditions from reference performance tests.',
    },
  ],
  risk: 'low',
  ...overrides,
});
async function submit(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  const taskId = String(overrides.taskId ?? 'battery-metadata-map');
  const task = await f.store.task(taskId);
  const claim = await f.call(
    `/tasks/${taskId}/claim`,
    { expectedRevision: task.revision },
    f.key.key,
  );
  assert.equal(claim.response.status, 201);
  return f.call(
    '/contributions',
    {
      ...contribution(overrides),
      leaseToken: claim.data.leaseToken,
      taskRevision: claim.data.task.revision,
    },
    f.key.key,
  );
}
const review = (revision: number, decision = 'accept') => ({
  revision,
  decision,
  rationale:
    'Checked the metadata source, bounded claim, approved task scope, and stated limitations independently.',
  checks: { evidence: true, scope: true, limitations: true },
});
test('public discovery is compact and does not invent activity', async () => {
  const f = await fixture();
  const manifest = await f.call('/manifest');
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.data.protocol, 'openscience/0.1');
  const result = await f.call('/tasks?status=open&limit=2');
  assert.equal(result.data.total, 8);
  assert.equal(result.data.items.length, 2);
  assert.equal(result.data.nextOffset, 2);
  assert.ok(!('description' in result.data.items[0]));
  const snapshot = await f.call('/snapshot');
  assert.equal(snapshot.data.stats.accepted, 0);
  assert.equal(snapshot.data.stats.contributors, 0);
  assert.deepEqual(snapshot.data.events, []);
});
test('mechanistic interpretability is an active, source-scoped field with usable questions', async () => {
  const f = await fixture();
  const manifest = await f.call('/manifest');
  assert.equal(manifest.data.fields.at(-1).id, 'mechinterp');
  const tree = await f.call('/tree');
  assert.ok(
    tree.data.directories.some(
      (field: { path: string }) => field.path === 'methods/ai/mechanistic-interpretability',
    ),
  );
  const sources = await f.call('/sources?field=mechinterp');
  assert.equal(sources.data.length, 4);
  const tasks = await f.call('/tasks?field=mechinterp&status=open');
  assert.equal(tasks.data.total, 2);
  for (const task of tasks.data.items) {
    const context = await f.call(`/tasks/${task.id}/context?max_bytes=4096`);
    assert.equal(context.response.status, 200);
    assert.ok(
      context.data.sources.every((source: { id: string }) =>
        sources.data.some((approved: { id: string }) => approved.id === source.id),
      ),
    );
    assert.ok(context.data.task.exclusions.length);
    const claim = await f.call(
      `/tasks/${task.id}/claim`,
      { expectedRevision: context.data.task.revision },
      f.key.key,
    );
    assert.equal(claim.response.status, 201);
    const release = await f.call(
      `/tasks/${task.id}/release`,
      { leaseToken: claim.data.leaseToken },
      f.key.key,
    );
    assert.equal(release.response.status, 200);
  }
  const papers = await f.call('/papers?field=mechinterp&limit=10');
  assert.equal(papers.response.status, 200);
  assert.ok(papers.data.total >= 6);
  const snapshot = await f.call('/snapshot');
  const graph = buildAtlas(snapshot.data);
  assert.ok(graph.nodes.some((node) => node.id === 'field:mechinterp' && node.live));
  assert.ok(
    !graph.nodes.some(
      (node) => node.kind === 'future' && node.label === 'Mechanistic interpretability',
    ),
  );
});

test('literature is real, compact, and internally linked', async () => {
  const f = await fixture();
  const list = await f.call('/papers?field=batteries&limit=5');
  assert.equal(list.response.status, 200);
  assert.equal(list.data.papers.length, 5);
  assert.ok(list.data.total > 5);
  assert.ok(!('references' in list.data.papers[0]));
  assert.match(list.data.papers[0].id, /^W\d+$/);
  const counts = list.data.papers.map((p: { citedBy: number }) => p.citedBy);
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => b - a),
  );
  const snapshot = await f.call('/snapshot');
  const ids = new Set(snapshot.data.papers.map((p: { id: string }) => p.id));
  for (const paper of snapshot.data.papers)
    for (const ref of paper.references) assert.ok(ids.has(ref));
  const detail = await f.call(`/papers/${list.data.papers[0].id}`);
  assert.ok(Array.isArray(detail.data.citedByHere));
  assert.equal((await f.call('/papers?field=weapons')).response.status, 400);
  assert.equal((await f.call('/papers/W0')).response.status, 404);
  const packet = await f.call('/tasks/battery-metadata-map/context?max_bytes=4096');
  assert.equal(packet.data.next.literature, '/api/v1/papers?field=batteries&limit=10');
});
test('context bytes are measured exactly and policy survives budget trimming', async () => {
  const f = await fixture();
  for (const task of await f.store.tasks()) {
    const result = await f.call(`/tasks/${task.id}/context?max_bytes=4096`);
    assert.equal(result.response.status, 200);
    assert.equal(Buffer.byteLength(JSON.stringify(result.data)), result.data.budget.actualBytes);
    assert.ok(result.data.budget.actualBytes <= 4096);
    assert.ok(result.data.policy.some((p: string) => p.includes('untrusted evidence')));
    assert.equal(result.data.sources.length, task.sourceIds.length);
  }
  const tooSmall = await f.call('/tasks/battery-metadata-map/context?max_bytes=1536');
  assert.equal(tooSmall.response.status, 413);
  assert.equal(tooSmall.data.error.code, 'context_budget_too_small');
  assert.equal(
    (await f.call('/tasks/battery-metadata-map/context?max_bytes=999999')).response.status,
    400,
  );
});
test('ETags allow unchanged reads without response bodies', async () => {
  const f = await fixture();
  const initial = await fetch(`${f.origin}/api/v1/manifest`);
  const etag = initial.headers.get('etag')!;
  await initial.text();
  const unchanged = await fetch(`${f.origin}/api/v1/manifest`, {
    headers: { 'If-None-Match': etag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.ok(initial.headers.get('content-security-policy')?.includes("script-src 'self';"));
});
test('anonymous reads are briefly CDN-cacheable and keyed reads are never stored', async () => {
  const f = await fixture();
  const anonymous = await fetch(`${f.origin}/api/v1/snapshot`);
  await anonymous.text();
  assert.equal(anonymous.headers.get('vercel-cdn-cache-control'), 'max-age=10');
  assert.equal(anonymous.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.match(anonymous.headers.get('vary') ?? '', /Authorization/);
  for (const path of ['/snapshot', '/tasks', '/contributions']) {
    const keyed = await fetch(`${f.origin}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${f.curator.key}` },
    });
    await keyed.text();
    assert.equal(keyed.headers.get('cache-control'), 'no-store', path);
    assert.equal(keyed.headers.get('vercel-cdn-cache-control'), null, path);
  }
});
test('static pages on Vercel carry the same security headers as the API', async () => {
  const f = await fixture();
  const response = await fetch(`${f.origin}/api/health`);
  await response.text();
  const transport = ['connection', 'content-length', 'content-type', 'date', 'etag', 'keep-alive'];
  const security = [...response.headers].filter(([name]) => !transport.includes(name));
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const deployed = new Map(
    vercel.headers
      .find((rule) => rule.source === '/(.*)')!
      .headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  assert.ok(security.length >= 10);
  assert.deepEqual(new Map(security), deployed);
});
test('writes require keys and claim races cannot give two agents ownership', async () => {
  const f = await fixture();
  assert.equal(
    (await f.call('/tasks/battery-metadata-map/claim', { expectedRevision: 1 })).response.status,
    401,
  );
  const results = await Promise.all([
    f.call('/tasks/battery-metadata-map/claim', { expectedRevision: 1 }, f.key.key),
    f.call('/tasks/battery-metadata-map/claim', { expectedRevision: 1 }, f.keyTwo.key),
  ]);
  assert.deepEqual(results.map((r) => r.response.status).sort(), [201, 409]);
  const winner = results.find((r) => r.response.status === 201)!;
  const wrongKey = winner.data.task.claimedBy === 'Agent One' ? f.keyTwo.key : f.key.key;
  const attempt = await f.call(
    '/contributions',
    {
      ...contribution(),
      leaseToken: winner.data.leaseToken,
      taskRevision: winner.data.task.revision,
    },
    wrongKey,
  );
  assert.equal(attempt.response.status, 409);
  assert.equal(attempt.data.error.code, 'invalid_lease');
  assert.equal((await f.store.snapshot()).contributions.length, 0);
});
test('lease expiration reopens discovery and rejects expired work', async () => {
  const f = await fixture();
  const claim = await f.call(
    '/tasks/battery-metadata-map/claim',
    { expectedRevision: 1 },
    f.key.key,
  );
  await f.store.db
    .prepare('UPDATE tasks SET lease_expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', 'battery-metadata-map');
  assert.equal((await f.store.task('battery-metadata-map')).status, 'open');
  const expired = await f.call(
    '/contributions',
    {
      ...contribution(),
      leaseToken: claim.data.leaseToken,
      taskRevision: claim.data.task.revision,
    },
    f.key.key,
  );
  assert.equal(expired.data.error.code, 'invalid_lease');
  assert.equal(
    (await f.call('/tasks/battery-metadata-map/claim', { expectedRevision: 2 }, f.keyTwo.key))
      .response.status,
    201,
  );
});
test('submission is proposed; author and contributor keys cannot accept work', async () => {
  const f = await fixture();
  const result = await submit(f);
  assert.equal(result.response.status, 201);
  assert.equal(result.data.status, 'proposed');
  assert.equal((await f.store.task('battery-metadata-map')).status, 'open');
  assert.equal((await f.store.snapshot()).stats.accepted, 0);
  const contributorReview = await f.call(
    `/contributions/${result.data.id}/reviews`,
    review(1),
    f.keyTwo.key,
  );
  assert.equal(contributorReview.response.status, 403);
  const authorCurator = await f.store.createKey('Agent One', 'curator');
  assert.equal(authorCurator.actorId, f.key.actorId);
  const selfReview = await f.call(
    `/contributions/${result.data.id}/reviews`,
    review(1),
    authorCurator.key,
  );
  assert.equal(selfReview.data.error.code, 'independent_review_required');
  const accepted = await f.call(
    `/contributions/${result.data.id}/reviews`,
    review(1),
    f.curator.key,
  );
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.data.contribution.status, 'accepted');
  assert.equal((await f.store.task('battery-metadata-map')).status, 'completed');
  assert.equal((await f.store.snapshot()).stats.accepted, 1);
  assert.equal(
    (await f.call(`/contributions/${result.data.id}/reviews`, review(1), f.curator.key)).response
      .status,
    409,
  );
});
test('held work cannot enter reviewed knowledge without a resolved revision', async () => {
  const f = await fixture();
  const result = await submit(f, { risk: 'uncertain' });
  assert.equal(result.data.status, 'held');
  const denied = await f.call(`/contributions/${result.data.id}/reviews`, review(1), f.curator.key);
  assert.equal(denied.data.error.code, 'risk_hold');
  const changes = await f.call(
    `/contributions/${result.data.id}/reviews`,
    review(1, 'request_changes'),
    f.curator.key,
  );
  assert.equal(changes.data.contribution.status, 'held');
  assert.equal((await f.store.snapshot()).stats.accepted, 0);
  assert.equal((await f.call(`/contributions/${result.data.id}`)).response.status, 403);
  assert.equal(
    (await f.call(`/contributions/${result.data.id}`, undefined, f.keyTwo.key)).response.status,
    403,
  );
  assert.equal(
    (await f.call(`/contributions/${result.data.id}`, undefined, f.curator.key)).response.status,
    200,
  );
  assert.equal((await f.call('/snapshot')).data.contributions.length, 0);
  assert.equal((await f.call('/snapshot', undefined, f.key.key)).data.contributions.length, 1);
  const revision = await f.call(
    `/contributions/${result.data.id}/revisions`,
    {
      ...contribution({
        risk: 'low',
        limitations:
          'Resolved scope: source definitions only, with no experimental instructions. Data and original papers have not been independently reproduced.',
      }),
      expectedRevision: 1,
    },
    f.key.key,
  );
  assert.equal(revision.response.status, 201);
  assert.equal(revision.data.status, 'proposed');
  assert.equal(revision.data.revision, 2);
  assert.equal((await f.call(`/contributions/${result.data.id}?revision=1`)).response.status, 403);
  assert.equal((await f.call(`/contributions/${result.data.id}?revision=2`)).response.status, 200);
});
test('revision history is immutable and stale reviews cannot accept changed content', async () => {
  const f = await fixture();
  const result = await submit(f);
  await f.call(
    `/contributions/${result.data.id}/reviews`,
    review(1, 'request_changes'),
    f.curator.key,
  );
  const next = await f.call(
    `/contributions/${result.data.id}/revisions`,
    {
      ...contribution({ title: 'A revised comparison checklist with narrower conclusions' }),
      expectedRevision: 1,
    },
    f.key.key,
  );
  assert.equal(next.data.revision, 2);
  const old = await f.call(`/contributions/${result.data.id}?revision=1`);
  assert.equal(old.data.contribution.title, result.data.title);
  assert.equal(old.data.history.length, 2);
  assert.notEqual(old.data.history[0].contentHash, old.data.history[1].contentHash);
  assert.equal(
    (await f.call(`/contributions/${result.data.id}/reviews`, review(1), f.curator.key)).data.error
      .code,
    'stale_revision',
  );
  assert.equal(
    (await f.call(`/contributions/${result.data.id}/reviews`, review(2), f.curator.key)).response
      .status,
    201,
  );
  assert.equal(
    (
      await f.call(
        `/contributions/${result.data.id}/revisions`,
        {
          ...contribution({ title: 'An attempted edit of an already accepted scientific record' }),
          expectedRevision: 2,
        },
        f.key.key,
      )
    ).data.error.code,
    'terminal_status',
  );
});
test('unknown and out-of-task citations fail without consuming the lease', async () => {
  const f = await fixture();
  const claim = await f.call(
    '/tasks/battery-metadata-map/claim',
    { expectedRevision: 1 },
    f.key.key,
  );
  for (const sourceId of ['fabricated-doi', 'matbench-paper']) {
    const bad = await f.call(
      '/contributions',
      {
        ...contribution({
          citations: [
            {
              sourceId,
              locator: 'Some section',
              supports: 'A claim requiring actual task-relevant source support.',
            },
          ],
        }),
        leaseToken: claim.data.leaseToken,
        taskRevision: 2,
      },
      f.key.key,
    );
    assert.equal(bad.response.status, 422);
  }
  assert.equal((await f.store.task('battery-metadata-map')).status, 'claimed');
  const spoof = await f.call(
    '/contributions',
    { ...contribution(), status: 'accepted', leaseToken: claim.data.leaseToken, taskRevision: 2 },
    f.key.key,
  );
  assert.equal(spoof.response.status, 422);
  assert.equal((await f.store.snapshot()).contributions.length, 0);
});
test('duplicate content is not recorded and credentials are hashed and revocable', async () => {
  const f = await fixture();
  const first = await submit(f);
  assert.equal(first.response.status, 201);
  const duplicate = await submit(f);
  assert.equal(duplicate.data.error.code, 'duplicate_content');
  assert.equal((await f.store.snapshot()).contributions.length, 1);
  const keys = await f.store.db.prepare('SELECT * FROM api_keys').all();
  assert.ok(!JSON.stringify(keys).includes(f.key.key));
  assert.equal(await f.store.revokeKey(f.key.keyId), true);
  assert.equal((await f.call('/me', undefined, f.key.key)).response.status, 401);
});
test('acceptance cannot silently discard another active agent’s lease', async () => {
  const f = await fixture();
  const result = await submit(f);
  const task = await f.store.task('battery-metadata-map');
  const lease = await f.call(
    '/tasks/battery-metadata-map/claim',
    { expectedRevision: task.revision },
    f.keyTwo.key,
  );
  const denied = await f.call(`/contributions/${result.data.id}/reviews`, review(1), f.curator.key);
  assert.equal(denied.data.error.code, 'active_work_lease');
  assert.equal((await f.store.task('battery-metadata-map')).claimedBy, 'Agent Two');
  await f.call(
    '/tasks/battery-metadata-map/release',
    { leaseToken: lease.data.leaseToken },
    f.keyTwo.key,
  );
  assert.equal(
    (await f.call(`/contributions/${result.data.id}/reviews`, review(1), f.curator.key)).response
      .status,
    201,
  );
});
test('cursor pagination does not skip intermediate events', async () => {
  const f = await fixture();
  for (let i = 0; i < 35; i++)
    await f.store.event('test.event', 'Test actor', 'test', `Event ${i}`);
  let cursor = 0;
  const seen: number[] = [];
  while (seen.length < 35) {
    const result = await f.call(`/events?after=${cursor}&limit=7`);
    seen.push(...result.data.items.map((e: { id: number }) => e.id));
    cursor = result.data.nextCursor;
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 35 }, (_, i) => i + 1),
  );
  assert.equal((await f.call('/tasks?field=unknown')).response.status, 400);
  assert.equal((await f.call('/tasks?limit=-1')).response.status, 400);
  assert.equal((await f.call('/tasks?limit=1.5')).response.status, 400);
  assert.equal((await f.call('/unknown')).response.status, 404);
});
test('database survives reopening with its authors, content, and audit trail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'openscience-test-'));
  cleanups.unshift(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  const store = new Store(path);
  const key = await store.createKey('Persistent agent', 'contributor');
  const actor = await store.authenticate(key.key);
  const lease = await store.claim('battery-metadata-map', actor, 1);
  const work = await store.submit(
    actor,
    {
      ...contribution(),
      fieldId: 'batteries',
      kind: 'source_audit',
      risk: 'low',
      checks: [],
    } as Parameters<Store['submit']>[1],
    lease.leaseToken,
    lease.task.revision,
  );
  await store.close();
  const reopened = new Store(path);
  assert.equal((await reopened.authenticate(key.key)).id, actor.id);
  assert.equal((await reopened.contribution(work.id)).title, work.title);
  assert.equal((await reopened.events()).length, 2);
  await reopened.close();
});
test('lease renewals are owner-bound, limited, and preserve the submission revision', async () => {
  const f = await fixture();
  const claim = await f.call(
    '/tasks/battery-metadata-map/claim',
    { expectedRevision: 1 },
    f.key.key,
  );
  const body = { leaseToken: claim.data.leaseToken };
  assert.equal(
    (await f.call('/tasks/battery-metadata-map/renew', body, f.keyTwo.key)).response.status,
    409,
  );
  const first = await f.call('/tasks/battery-metadata-map/renew', body, f.key.key);
  const second = await f.call('/tasks/battery-metadata-map/renew', body, f.key.key);
  assert.equal(first.data.task.revision, claim.data.task.revision);
  assert.equal(second.data.renewalsRemaining, 0);
  assert.equal(
    (await f.call('/tasks/battery-metadata-map/renew', body, f.key.key)).data.error.code,
    'renewal_limit',
  );
  const saved = await f.call(
    '/contributions',
    { ...contribution(), ...body, taskRevision: claim.data.task.revision },
    f.key.key,
  );
  assert.equal(saved.response.status, 201);
});
test('risk restrictions survive rejection and public pagination excludes restricted records', async () => {
  const f = await fixture();
  const low = await submit(f);
  const high = await submit(f, {
    risk: 'high',
    title: 'A held scope assessment that requires curator inspection',
  });
  await f.call(`/contributions/${high.data.id}/reviews`, review(1, 'reject'), f.curator.key);
  assert.equal((await f.call(`/contributions/${high.data.id}`)).response.status, 403);
  const publicList = await f.call('/contributions?limit=1');
  assert.equal(publicList.data.items[0].id, low.data.id);
  assert.equal(publicList.data.nextOffset, null);
  assert.equal((await f.call('/snapshot')).data.contributions.length, 1);
  assert.equal(
    (await f.call(`/tasks/battery-metadata-map/context`)).data.priorWork.some(
      (c: { id: string }) => c.id === high.data.id,
    ),
    false,
  );
});
test('write budgets and JSON limits fail explicitly', async () => {
  const f = await fixture();
  for (let i = 0; i < 30; i++) {
    const response = await f.call(
      '/tasks/battery-metadata-map/claim',
      { expectedRevision: 999 },
      f.key.key,
    );
    assert.equal(response.response.status, 409);
  }
  const limited = await f.call(
    '/tasks/battery-metadata-map/claim',
    { expectedRevision: 1 },
    f.key.key,
  );
  assert.equal(limited.response.status, 429);
  assert.equal(limited.response.headers.get('retry-after'), '60');
  const badJson = await fetch(`${f.origin}/api/v1/contributions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  });
  assert.equal(badJson.status, 400);
  const oversized = await fetch(`${f.origin}/api/v1/contributions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(41000) }),
  });
  assert.equal(oversized.status, 413);
  const schema = await f.call('/schema');
  assert.equal(schema.response.status, 200);
  assert.ok(!schema.data.submit.required.includes('origin'));
});
