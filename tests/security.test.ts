import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, resolveConfig } from 'vite';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(privateReads = false, requestLimit = 120) {
  const store = new Store(':memory:');
  await store.ready;
  const key = await store.createKey('Security fixture contributor', 'contributor');
  const app = createApp(store, { privateReads, requestLimit });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as { port: number };
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.close();
  });
  const base = `http://127.0.0.1:${address.port}`;
  return { store, key, request: (path: string, init?: RequestInit) => fetch(base + path, init) };
}

test('private reads enforce a key on every API discovery and content route, including HEAD', async () => {
  const f = await fixture(true);
  const paths = [
    '/api/v1/manifest',
    '/.well-known/openscience.json',
    '/api/v1/schema',
    '/api/v1/fields',
    '/api/v1/sources',
    '/api/v1/papers',
    '/api/v1/tasks',
    '/api/v1/tasks/battery-metadata-map/context',
    '/api/v1/snapshot',
    '/api/v1/contributions',
    '/api/v1/events',
    '/API/v1/SNAPSHOT',
    '/.WELL-KNOWN/openscience.json/',
  ];
  for (const path of paths) {
    const response = await f.request(path);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(response.headers.get('vercel-cdn-cache-control'), null, path);
    assert.equal((await response.json()).error.code, 'key_required', path);
  }
  const head = await f.request('/api/v1/snapshot', { method: 'HEAD' });
  assert.equal(head.status, 401);
  assert.equal(await head.text(), '');
  const health = await f.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', protocol: 'openscience/0.1' });
});

test('private-read keys authorize reads without making responses cacheable, and revocation applies', async () => {
  const f = await fixture(true);
  const headers = { Authorization: `Bearer ${f.key.key}` };
  const manifest = await f.request('/api/v1/manifest', { headers });
  assert.equal(manifest.status, 200);
  assert.match((await manifest.json()).readAccess, /bearer key required/);
  const snapshot = await f.request('/api/v1/snapshot', { headers });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.headers.get('cache-control'), 'no-store');
  assert.equal(snapshot.headers.get('vercel-cdn-cache-control'), null);
  await snapshot.text();
  await f.store.revokeKey(f.key.keyId);
  const revoked = await f.request('/api/v1/snapshot', { headers });
  assert.equal(revoked.status, 401);
  assert.equal((await revoked.json()).error.code, 'invalid_key');
});

test('public mode stays readable, but malformed keys never reach database authentication', async () => {
  const f = await fixture();
  let authenticationCalls = 0;
  const authenticate = f.store.authenticate.bind(f.store);
  f.store.authenticate = async (key) => {
    authenticationCalls++;
    return authenticate(key);
  };
  const publicRead = await f.request('/api/v1/snapshot');
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.headers.get('vercel-cdn-cache-control'), 'max-age=10');
  await publicRead.text();
  const malformed = await f.request('/api/v1/snapshot', {
    headers: { Authorization: `Bearer ${'arbitrary-text'.repeat(4)}` },
  });
  assert.equal(malformed.status, 401);
  assert.equal(authenticationCalls, 0);
  assert.equal(malformed.headers.get('cache-control'), 'no-store');
  await malformed.text();
});

test('validation, permission and parse failures are no-store even on anonymous requests', async () => {
  const f = await fixture();
  const requests: [string, RequestInit | undefined, number][] = [
    ['/api/v1/tasks?limit=-1', undefined, 400],
    ['/api/v1/unknown', undefined, 404],
    [
      '/api/v1/tasks/battery-metadata-map/claim',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"expectedRevision":1}',
      },
      401,
    ],
    [
      '/api/v1/contributions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid',
      },
      400,
    ],
    [
      '/api/v1/contributions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(41000) }),
      },
      413,
    ],
  ];
  for (const [path, init, status] of requests) {
    const response = await f.request(path, init);
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(response.headers.get('vercel-cdn-cache-control'), null, path);
    assert.match(response.headers.get('vary') ?? '', /Authorization/);
    await response.text();
  }
});

test('successful writes cannot cache owner-bound lease secrets', async () => {
  const f = await fixture();
  const headers = { Authorization: `Bearer ${f.key.key}`, 'Content-Type': 'application/json' };
  const claim = await f.request('/api/v1/tasks/battery-metadata-map/claim', {
    method: 'POST',
    headers,
    body: '{"expectedRevision":1}',
  });
  assert.equal(claim.status, 201);
  assert.equal(claim.headers.get('cache-control'), 'no-store');
  const lease = await claim.json();
  const release = await f.request('/api/v1/tasks/battery-metadata-map/release', {
    method: 'POST',
    headers,
    body: JSON.stringify({ leaseToken: lease.leaseToken }),
  });
  assert.equal(release.status, 200);
  assert.equal(release.headers.get('cache-control'), 'no-store');
  assert.equal(release.headers.get('vercel-cdn-cache-control'), null);
  await release.text();
});

test('unsupported encodings fail without disclosing parser internals', async () => {
  const f = await fixture();
  const cases: Record<string, string>[] = [
    { 'Content-Type': 'application/json; charset=iso-8859-1' },
    { 'Content-Type': 'application/json', 'Content-Encoding': 'unsupported-test-format' },
  ];
  for (const headers of cases) {
    const response = await f.request('/api/v1/contributions', {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'unsupported_encoding',
        message: 'Use UTF-8 JSON with a supported content encoding.',
      },
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('unexpected database errors disclose neither their detail to clients nor server logs', async () => {
  const f = await fixture();
  const canary = 'manufactured-secret-and-private-path-canary';
  f.store.task = async () => {
    throw new Error(canary);
  };
  const recorded: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => {
    recorded.push(args);
  };
  try {
    const response = await f.request('/api/v1/tasks/battery-metadata-map');
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body.includes(canary), false);
    assert.equal(JSON.stringify(recorded).includes(canary), false);
    assert.equal(recorded.length, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    console.error = original;
  }
});

test('cross-origin browsers receive no CORS permission to read the API or send bearer writes', async () => {
  const f = await fixture();
  const headers = { Origin: 'https://external-security-fixture.example' };
  const read = await f.request('/api/v1/snapshot', { headers });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('access-control-allow-origin'), null);
  await read.text();
  const preflight = await f.request('/api/v1/tasks/battery-metadata-map/claim', {
    method: 'OPTIONS',
    headers: {
      ...headers,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.equal(preflight.headers.get('access-control-allow-headers'), null);
  await preflight.text();
});

test('unique unknown queries, repeated parameters and overlong URLs fail before database work', async () => {
  const f = await fixture();
  let reads = 0;
  const snapshot = f.store.snapshot.bind(f.store);
  const tasks = f.store.tasks.bind(f.store);
  f.store.snapshot = async () => {
    reads++;
    return snapshot();
  };
  f.store.tasks = async () => {
    reads++;
    return tasks();
  };
  for (const path of [
    '/api/v1/snapshot?cache_nonce=unique',
    '/api/v1/tasks?field=batteries&field=solar',
    '/api/v1/tasks?q=' + 'x'.repeat(201),
    '/api/v1/tasks?field=' + 'x'.repeat(2100),
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, path.length > 2048 ? 414 : 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
  assert.equal(reads, 0);
  const valid = await f.request('/api/v1/tasks?field=batteries&status=open&limit=2');
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).total, 2);
  assert.equal(reads, 1);
});

test('instance admission sheds read and shaped-auth traffic before database authentication', async () => {
  const f = await fixture(false, 2);
  let authentications = 0;
  const authenticate = f.store.authenticate.bind(f.store);
  f.store.authenticate = async (key) => {
    authentications++;
    return authenticate(key);
  };
  for (const path of ['/api/v1/snapshot?nonce=1', '/API/v1/SNAPSHOT?nonce=2']) {
    const response = await f.request(path);
    assert.equal(response.status, 400);
    await response.text();
  }
  const headers = { Authorization: `Bearer ${f.key.key}` };
  const cases: RequestInit[] = [
    { headers },
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{"expectedRevision":1}',
    },
  ];
  for (const init of cases) {
    const response = await f.request('/api/v1/tasks/battery-metadata-map/claim', init);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'request_rate_limited');
  }
  assert.equal(authentications, 0);
  assert.equal((await f.store.task('battery-metadata-map')).status, 'open');
  const health = await f.request('/api/health');
  assert.equal(health.status, 200);
  await health.text();
});

test('development static middleware cannot publish ignored operator files or database artifacts', async () => {
  const fixtureRoot = fileURLToPath(new URL('../test-results/', import.meta.url));
  mkdirSync(fixtureRoot, { recursive: true });
  const directory = realpathSync(mkdtempSync(join(fixtureRoot, 'osc-security-static-')));
  const store = new Store(':memory:');
  await store.ready;
  mkdirSync(join(directory, '.local'));
  mkdirSync(join(directory, 'data'));
  const canary = 'manufactured-static-private-file-canary';
  writeFileSync(join(directory, '.local', 'invite.env'), canary);
  writeFileSync(join(directory, 'data', 'commons.sqlite'), canary);
  writeFileSync(join(directory, 'other.sqlite-wal'), canary);
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Security fixture</title>');
  const config = await resolveConfig({}, 'serve');
  const defaults = await resolveConfig({ configFile: false }, 'serve');
  for (const pattern of defaults.server.fs.deny) assert.ok(config.server.fs.deny.includes(pattern));
  assert.ok(config.server.fs.deny.includes('**/.local/**'));
  assert.ok(config.server.fs.deny.includes('**/data/**'));
  const vite = await createServer({
    root: directory,
    cacheDir: join(directory, '.vite-cache'),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false, fs: { deny: config.server.fs.deny } },
    appType: 'spa',
  });
  const app = createApp(store, { development: true });
  app.use(vite.middlewares);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as { port: number };
  try {
    const privateAbsolute = join(directory, '.local', 'invite.env').replaceAll('\\', '/');
    for (const path of [
      '/.local/invite.env',
      '/%2elocal/invite.env?raw',
      '/.local%2finvite.env',
      '/data/commons.sqlite',
      '/other.sqlite-wal',
      `/@fs/${privateAbsolute}`,
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 404, path);
      const body = await response.text();
      assert.equal(body.includes(canary), false, path);
      assert.equal(body.includes(directory), false, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const index = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Security fixture/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await vite.close();
    await store.close();
    // Only the explicitly created fixture directory is removed, with no computed parent paths.
    assert.ok(directory.startsWith(join(realpathSync(fixtureRoot), 'osc-security-static-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
