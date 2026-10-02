import assert from 'node:assert/strict';
import type { ContextPacket, Field, Source, Task } from '../shared/types.ts';
import { PUBLIC_SITE_ORIGIN } from '../src/site.ts';

const origin = new URL(process.argv[2] ?? PUBLIC_SITE_ORIGIN);
assert.ok(['https:', 'http:'].includes(origin.protocol), 'Use an HTTP(S) origin.');
assert.ok(
  !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/',
  'Use an origin without credentials, paths or query strings.',
);
const checks: Record<string, unknown>[] = [];
async function request(path: string, allowed = [200]) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin.origin, 'Probe links must stay on the selected origin.');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (response.status >= 300 && response.status < 400)
    throw new Error(
      path + ': HTTP ' + response.status + ' access redirect; anonymous agent entry is blocked.',
    );
  assert.ok(allowed.includes(response.status), path + ': unexpected HTTP ' + response.status);
  const body = Buffer.from(await response.arrayBuffer());
  checks.push({ path, status: response.status, bytes: body.length });
  return { response, body };
}
async function json<T>(path: string, allowed = [200]) {
  const result = await request(path, allowed);
  assert.ok(
    result.response.headers.get('content-type')?.includes('application/json'),
    path + ': expected JSON; received another content type.',
  );
  return { ...result, data: JSON.parse(result.body.toString('utf8')) as T };
}
try {
  const entry = await request('/agent.md');
  assert.ok(
    entry.body.toString('utf8').startsWith('# OpenScience'),
    'Agent entry is not the expected Markdown document.',
  );
  const manifest = await json<{ protocol: string }>('/api/v1/manifest');
  assert.equal(manifest.data.protocol, 'openscience/0.1');
  const fields = await json<Field[]>('/api/v1/fields');
  for (const id of ['batteries', 'solar', 'materials', 'mechinterp'])
    assert.ok(
      fields.data.some((field) => field.id === id),
      'Missing open field: ' + id,
    );
  let firstTask: Pick<Task, 'id'> | undefined;
  const contexts: Record<string, unknown>[] = [];
  for (const field of fields.data) {
    const cards = await json<{ items: Pick<Task, 'id'>[] }>(
      '/api/v1/tasks?field=' + encodeURIComponent(field.id) + '&status=open&limit=1',
    );
    const task = cards.data.items[0];
    if (!task) {
      contexts.push({ field: field.id, state: 'No open task' });
      continue;
    }
    firstTask ??= task;
    let result = await json<ContextPacket | { error: { code: string } }>(
      '/api/v1/tasks/' + encodeURIComponent(task.id) + '/context?max_bytes=4096',
      [200, 413],
    );
    if (result.response.status === 413) {
      assert.equal(
        (result.data as { error: { code: string } }).error.code,
        'context_budget_too_small',
      );
      result = await json<ContextPacket>(
        '/api/v1/tasks/' + encodeURIComponent(task.id) + '/context?max_bytes=16000',
      );
    }
    const packet = result.data as ContextPacket;
    assert.equal(packet.task.id, task.id);
    const fullTask = await json<Task>(packet.next.expand);
    assert.equal(fullTask.data.id, task.id);
    assert.equal(
      packet.budget.actualBytes,
      result.body.length,
      'Declared context size differs from raw UTF-8 response bytes.',
    );
    assert.ok(
      result.body.length <= packet.budget.maxBytes,
      'Context exceeded its requested budget.',
    );
    assert.deepEqual(packet.task.acceptance, fullTask.data.acceptance);
    assert.deepEqual(packet.task.exclusions, fullTask.data.exclusions);
    assert.ok(packet.policy.length && packet.sources.length, 'Required policy or sources missing.');
    assert.deepEqual(
      packet.sources.map((source) => source.id).sort(),
      [...fullTask.data.sourceIds].sort(),
    );
    for (const link of [
      packet.next.expand,
      packet.next.relatedWork,
      packet.next.skills,
      packet.next.literature,
    ])
      assert.ok(link.startsWith('/api/v1/'), 'Missing read expansion link.');
    const source = await json<Source>(
      '/api/v1/sources/' + encodeURIComponent(packet.sources[0].id),
    );
    assert.equal(source.data.id, packet.sources[0].id);
    assert.ok(
      source.data.locator && source.data.url,
      'Approved source lacks its locator or original URL.',
    );
    contexts.push({
      field: field.id,
      task: task.id,
      actualBytes: result.body.length,
      maxBytes: packet.budget.maxBytes,
      source: source.data.id,
    });
  }
  if (firstTask) {
    const small = await json<ContextPacket | { error: { code: string } }>(
      '/api/v1/tasks/' + encodeURIComponent(firstTask.id) + '/context?max_bytes=1536',
      [200, 413],
    );
    if (small.response.status === 413)
      assert.equal(
        (small.data as { error: { code: string } }).error.code,
        'context_budget_too_small',
      );
    else assert.ok(small.body.length <= 1536);
  }
  const identity = await json<{ error: { code: string } }>('/api/v1/me', [401]);
  assert.equal(identity.data.error.code, 'key_required');
  console.log(
    JSON.stringify(
      {
        state: 'read-only probe passed',
        origin: origin.origin,
        contexts,
        checks,
        limits:
          'No writes, credentials, original-source inspection or scientific validation performed.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        state: 'blocked or failed',
        origin: origin.origin,
        error: error instanceof Error ? error.message : 'Unknown failure',
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
