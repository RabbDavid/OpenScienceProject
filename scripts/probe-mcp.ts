import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PUBLIC_SITE_ORIGIN } from '../shared/site.ts';
import type { ContextPacket } from '../shared/types.ts';

const origin = new URL(process.argv[2] ?? PUBLIC_SITE_ORIGIN);
assert.ok(['https:', 'http:'].includes(origin.protocol));
assert.ok(
  !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/',
  'Use an origin without paths or credentials.',
);
const checks: { path: string; status: number; bytes: number; kind: string }[] = [];
let requestCount = 0;
let kind = 'connect';
const checkedFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(url.origin, origin.origin, 'The probe must stay on the selected origin.');
  assert.ok(++requestCount <= 30, 'Stop before exceeding the read-only probe budget.');
  const response = await fetch(input, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(
    response.status < 300 || response.status >= 400,
    'Access redirect; endpoint is not anonymously reachable.',
  );
  checks.push({
    path: url.pathname,
    status: response.status,
    bytes: Buffer.byteLength(await response.clone().text()),
    kind,
  });
  return response;
};
const client = new Client({ name: 'openscience-public-probe', version: '1.0.0' });
async function call(name: string, args: Record<string, unknown> = {}) {
  kind = name;
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  assert.ok(!result.isError, 'Tool failed: ' + name);
  assert.equal(result.content.length, 1);
  const block = result.content[0];
  assert.equal(block.type, 'text');
  return JSON.parse((block as { text: string }).text);
}
try {
  kind = 'entry';
  const md = await checkedFetch(new URL('/agent.md', origin));
  const txt = await checkedFetch(new URL('/agent.txt', origin));
  for (const response of [md, txt]) {
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get('content-type')?.includes('text/plain'),
      'Expected reader-compatible plain text.',
    );
  }
  assert.equal(await md.text(), await txt.text(), 'Fallback must match agent instructions.');
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/api/mcp', origin), { fetch: checkedFetch }),
  );
  kind = 'tools/list';
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 8);
  assert.ok(
    tools.every(
      (tool) => tool.annotations?.readOnlyHint && tool.annotations?.destructiveHint === false,
    ),
  );
  const overview = await call('get_research_overview');
  assert.deepEqual(overview.fields.map((field: { id: string }) => field.id).sort(), [
    'batteries',
    'materials',
    'mechinterp',
    'solar',
  ]);
  const contexts: Record<string, unknown>[] = [];
  let first: ContextPacket | undefined;
  for (const field of overview.fields) {
    const cards = await call('list_questions', { field_id: field.id, limit: 1 });
    if (!cards.items.length) {
      contexts.push({ field: field.id, openQuestions: 0 });
      continue;
    }
    const packet: ContextPacket = await call('get_question_context', {
      task_id: cards.items[0].id,
      max_bytes: 4096,
    });
    const innerBytes = Buffer.byteLength(JSON.stringify(packet));
    assert.equal(innerBytes, packet.budget.actualBytes);
    assert.ok(innerBytes <= 4096);
    assert.deepEqual(packet.policy, overview.policy);
    assert.ok(
      packet.task.acceptance.length &&
        packet.task.exclusions.length &&
        packet.sources.length &&
        packet.next.expand,
    );
    contexts.push({
      field: field.id,
      task: packet.task.id,
      innerBytes,
      mcpResponseBytes: checks.at(-1)?.bytes,
    });
    first ??= packet;
  }
  if (first) {
    const source = await call('get_source', { source_id: first.sources[0].id });
    assert.equal(source.recordKind, 'external_source_catalog');
    kind = 'budget-refusal';
    const small = CallToolResultSchema.parse(
      await client.callTool({
        name: 'get_question_context',
        arguments: { task_id: first.task.id, max_bytes: 1536 },
      }),
    );
    assert.equal(small.isError, true);
    assert.equal(
      JSON.parse((small.content[0] as { text: string }).text).error.code,
      'context_budget_too_small',
    );
  }
  const literature = await call('search_literature', { field_id: 'mechinterp', limit: 1 });
  assert.equal(literature.recordKind, 'published_literature_metadata');
  const paper = await call('get_paper', { paper_id: literature.items[0].id });
  const fetched = await call('fetch', { id: `paper:${paper.id}` });
  assert.equal(JSON.parse(fetched.text).id, paper.id);
  assert.ok((await call('search', { query: 'battery' })).results.length);
  kind = 'skills/list';
  const skills = await client.request(
    { method: 'skills/list', params: {} },
    z.object({
      skills: z.array(
        z.object({ uri: z.string(), resources: z.array(z.object({ digest: z.string() })) }),
      ),
    }),
  );
  assert.equal(skills.skills.length, 1);
  kind = 'resources/read';
  const skill = await client.readResource({ uri: skills.skills[0].uri });
  const digest = createHash('sha256')
    .update((skill.contents[0] as { text: string }).text)
    .digest('hex');
  assert.equal(skills.skills[0].resources[0].digest, 'sha256:' + digest);
  console.log(
    JSON.stringify(
      {
        ok: true,
        origin: origin.origin,
        requests: requestCount,
        tools: tools.map((tool) => tool.name),
        contexts,
        skillDigest: 'sha256:' + digest,
        checks,
        limits:
          'Read-only protocol test; no original-source inspection, ChatGPT-session test, research writes or scientific validation.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Probe failed',
        requests: requestCount,
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
