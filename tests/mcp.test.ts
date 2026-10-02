import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { strFromU8, unzipSync } from 'fflate';
import { createApp } from '../server/app.ts';
import { Store, hash } from '../server/store.ts';
import { policy } from '../server/catalog.ts';
import { pluginArchive } from '../scripts/plugin-package.ts';
import { MCP_ENDPOINT } from '../shared/site.ts';
import type { ContextPacket } from '../shared/types.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(options: Parameters<typeof createApp>[1] = {}) {
  const store = new Store(':memory:');
  await store.ready;
  const server = createApp(store, options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.close();
  });
  const client = new Client({ name: 'openscience-test', version: '1.0.0' });
  cleanups.push(() => client.close());
  const connect = (key?: string) =>
    client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/api/mcp'), {
        requestInit: { headers: key ? { Authorization: `Bearer ${key}` } : {} },
      }),
    );
  const request = (body: unknown, extraHeaders: Record<string, string> = {}, path = '/api/mcp') =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.content.length, 1, 'No duplicated context representations');
    const block = result.content[0];
    assert.equal(block.type, 'text');
    return JSON.parse((block as { text: string }).text);
  };
  return { store, client, base, connect, request, rpc, call };
}

test('real MCP client discovers all fields and bounded context without modifying research', async () => {
  const f = await fixture();
  const before = await f.store.snapshot();
  await f.connect();
  const tools = (await f.client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'fetch',
    'get_paper',
    'get_question_context',
    'get_research_overview',
    'get_source',
    'list_questions',
    'search',
    'search_literature',
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const overview = await f.call('get_research_overview');
  assert.deepEqual(overview.fields.map((field: { id: string }) => field.id).sort(), [
    'batteries',
    'materials',
    'mechinterp',
    'solar',
  ]);
  assert.deepEqual(overview.policy, policy);
  for (const field of overview.fields) {
    const cards = await f.call('list_questions', { field_id: field.id, limit: 1 });
    assert.equal(cards.items.length, 1);
    assert.equal(cards.items[0].question, undefined);
    const packet: ContextPacket = await f.call('get_question_context', {
      task_id: cards.items[0].id,
      max_bytes: 4096,
    });
    assert.equal(Buffer.byteLength(JSON.stringify(packet)), packet.budget.actualBytes);
    assert.ok(packet.budget.actualBytes <= 4096);
    assert.deepEqual(packet.policy, policy);
    assert.ok(
      packet.task.acceptance.length &&
        packet.task.exclusions.length &&
        packet.sources.length &&
        packet.next.expand &&
        packet.next.skills,
    );
    const source = await f.call('get_source', { source_id: packet.sources[0].id });
    assert.equal(source.recordKind, 'external_source_catalog');
    assert.equal(source.url, packet.sources[0].url);
    const small = CallToolResultSchema.parse(
      await f.client.callTool({
        name: 'get_question_context',
        arguments: { task_id: cards.items[0].id, max_bytes: 1536 },
      }),
    );
    assert.equal(small.isError, true);
    assert.equal(
      JSON.parse((small.content[0] as { text: string }).text).error.code,
      'context_budget_too_small',
    );
  }
  const literature = await f.call('search_literature', { field_id: 'mechinterp', limit: 1 });
  assert.equal(literature.recordKind, 'published_literature_metadata');
  const paper = await f.call('get_paper', { paper_id: literature.items[0].id });
  assert.equal(paper.recordKind, 'published_literature_metadata');
  const fetchedPaper = await f.call('fetch', { id: `paper:${paper.id}` });
  assert.equal(JSON.parse(fetchedPaper.text).id, paper.id);
  const search = await f.call('search', { query: 'battery' });
  assert.ok(search.results.length > 0 && search.results.length <= 10);
  for (const result of search.results.slice(0, 2)) {
    const record = await f.call('fetch', { id: result.id });
    assert.equal(record.id, result.id);
    assert.ok(record.text && record.url.startsWith('https://'));
  }
  assert.deepEqual(await f.store.snapshot(), before);
});

test('portable plugin and MCP skill share verified content and correct discovery extension', async () => {
  const f = await fixture();
  await f.connect();
  assert.ok(f.client.getServerCapabilities()?.extensions?.['io.modelcontextprotocol/skills']);
  const list = await f.client.request(
    { method: 'skills/list', params: {} },
    z.object({
      skills: z.array(
        z.object({
          uri: z.string(),
          frontmatter: z.object({ name: z.string(), description: z.string() }),
          resources: z.array(z.object({ uri: z.string(), digest: z.string() })),
        }),
      ),
    }),
  );
  assert.equal(list.skills.length, 1);
  const skill = list.skills[0];
  const get = await f.client.request(
    { method: 'skills/get', params: { uri: skill.uri } },
    z.object({ skill: z.unknown() }),
  );
  assert.deepEqual(get.skill, skill);
  const resources = await f.client.readResource({ uri: skill.uri });
  assert.equal(resources.contents.length, 1);
  const text = (resources.contents[0] as { text: string }).text;
  assert.equal(skill.resources[0].digest, 'sha256:' + hash(text));
  const files = unzipSync(pluginArchive());
  assert.deepEqual(Object.keys(files).sort(), [
    'mcp.json',
    'plugin.json',
    'skills/research-exploration/SKILL.md',
  ]);
  assert.equal(strFromU8(files['skills/research-exploration/SKILL.md']), text);
  const manifest = JSON.parse(strFromU8(files['plugin.json']));
  assert.equal(manifest.name, 'openscience');
  assert.deepEqual(manifest.extensions['com.openai'].interface.capabilities, ['Read']);
  const mcp = JSON.parse(strFromU8(files['mcp.json']));
  assert.equal(mcp.mcpServers.openscience.type, 'streamable-http');
  assert.equal(mcp.mcpServers.openscience.url, MCP_ENDPOINT);
  await assert.rejects(
    f.client.request(
      { method: 'skills/get', params: { uri: 'file:///private/key' } },
      z.object({ skill: z.unknown() }),
    ),
    /Unknown skill/,
  );
});

test('held research, arbitrary URLs, writes and oversized inputs are unavailable to plugin tools', async () => {
  const f = await fixture();
  const key = await f.store.createKey('MCP fixture only', 'curator');
  const actor = await f.store.authenticate(key.key);
  const task = await f.store.task('battery-metadata-map');
  const lease = await f.store.claim(task.id, actor, task.revision);
  const held = await f.store.submit(
    actor,
    {
      taskId: task.id,
      fieldId: 'batteries',
      title: 'PRIVATE-CANARY-TITLE',
      kind: 'source_audit',
      summary: 'PRIVATE-CANARY-SUMMARY',
      body: 'PRIVATE-CANARY-BODY',
      method: 'Fixture only',
      limitations: 'Not scientific research',
      citations: [],
      risk: 'high',
      checks: [],
    },
    lease.leaseToken,
    lease.task.revision,
  );
  const before = await f.store.snapshot();
  await f.connect(key.key);
  const result = await f.call('get_question_context', { task_id: task.id, max_bytes: 4096 });
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CANARY'));
  assert.deepEqual((await f.call('search', { query: 'PRIVATE-CANARY' })).results, []);
  for (const [name, args] of [
    ['fetch', { id: `contribution:${held.id}` }],
    ['fetch', { id: 'https://localhost/private' }],
    ['get_source', { source_id: '../.local/operator-key' }],
    ['list_questions', { limit: 100000 }],
    ['list_questions', { query: 'x'.repeat(201) }],
    ['get_question_context', { task_id: task.id, max_bytes: 999999 }],
    ['get_question_context', { task_id: task.id, code: 'run me' }],
    ['submit_contribution', { body: 'run me' }],
  ] as [string, Record<string, unknown>][]) {
    const response = await f.request(f.rpc('tools/call', { name, arguments: args }));
    const data = await response.json();
    assert.ok(data.error || data.result?.isError, name);
    assert.ok(!JSON.stringify(data).includes('PRIVATE-CANARY'), name);
  }
  assert.deepEqual(await f.store.snapshot(), before);
});

test('private mode protects MCP POST, including tool and resource discovery, and revoked keys', async () => {
  const f = await fixture({ privateReads: true });
  for (const method of ['initialize', 'tools/list', 'resources/list', 'skills/list']) {
    const response = await f.request(f.rpc(method));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const key = await f.store.createKey('Private MCP fixture', 'contributor');
  await f.connect(key.key);
  assert.equal((await f.call('get_research_overview')).readOnly, true);
  await f.store.revokeKey(key.keyId);
  await assert.rejects(f.client.listTools(), /invalid_key/);
  assert.equal(
    (await f.request(f.rpc('tools/list'), { Authorization: `Bearer ${key.key}` })).status,
    401,
  );
});

test('MCP admission checks origin, sessions, methods, query and body limits before database work', async () => {
  const f = await fixture();
  assert.equal(
    (await f.request(f.rpc('tools/list'), { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await f.request(f.rpc('tools/list'), { Origin: 'https://chatgpt.com' })).status,
    200,
  );
  assert.equal(
    (await f.request(f.rpc('tools/list'), { 'mcp-session-id': 'untrusted-session' })).status,
    400,
  );
  assert.equal((await f.request(f.rpc('tools/list'), {}, '/api/mcp?nonce=cachebust')).status, 400);
  const oversized = await f.request(
    f.rpc('tools/call', { name: 'search', arguments: { query: 'x'.repeat(50000) } }),
  );
  assert.equal(oversized.status, 413);
  const get = await fetch(f.base + '/api/mcp');
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(get.headers.get('cache-control'), 'no-store');
  const limited = await fixture({ requestLimit: 1 });
  assert.equal((await limited.request(limited.rpc('tools/list'))).status, 200);
  const denied = await limited.request(limited.rpc('tools/list'));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '60');
});

test('unexpected database errors are sanitized rather than exposed by the MCP SDK', async () => {
  const f = await fixture();
  await f.connect();
  f.store.tasks = async () => {
    throw new Error('DATABASE-SECRET-CANARY');
  };
  const response = await f.request(f.rpc('tools/call', { name: 'list_questions', arguments: {} }));
  const text = await response.text();
  assert.ok(!text.includes('DATABASE-SECRET-CANARY'));
  assert.equal(JSON.parse(text).result.isError, true);
  assert.ok(text.includes('internal_error'));
});
