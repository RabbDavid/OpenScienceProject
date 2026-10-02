import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { convertRewrites } from '@vercel/routing-utils';

test('emitted JavaScript API starts without a TypeScript loader and serves nested routes', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(join(root, '.local'), { recursive: true });
  const output = mkdtempSync(join(root, '.local', 'deployment-test-'));
  try {
    const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    for (const directory of ['api', 'server', 'shared']) {
      mkdirSync(join(output, directory), { recursive: true });
      for (const name of readdirSync(join(root, directory)).filter((name) =>
        name.endsWith('.ts'),
      )) {
        const fileName = join(root, directory, name);
        const result = ts.transpileModule(readFileSync(fileName, 'utf8'), {
          compilerOptions: options,
          fileName,
        });
        writeFileSync(join(output, directory, name.replace(/\.ts$/, '.js')), result.outputText);
      }
    }
    copyFileSync(join(root, 'server/literature.json'), join(output, 'server/literature.json'));
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    const deployment = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
    const edgeRoutes = convertRewrites(deployment.rewrites);
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      import { once } from 'node:events';
      import handler from './api/index.js';
      const edgeRoutes = ${JSON.stringify(edgeRoutes)};
      const server = createServer((req, res) => {
        const original = new URL(req.url, 'http://localhost');
        const route = edgeRoutes.find(route => new RegExp(route.src).test(original.pathname));
        assert.ok(route, 'The deployed rewrite must match this API request.');
        const match = new RegExp(route.src).exec(original.pathname);
        const target = new URL(route.dest.replace(/\\$(\\d+)/g, (_, index) =>
          encodeURIComponent(match[Number(index)] ?? '')), 'http://localhost');
        assert.equal(target.pathname, '/api/index');
        // Vercel retains the incoming pathname for Express, but adds any unused
        // named rewrite captures to its query. Use the real compiler's output.
        for (const [key, value] of target.searchParams) original.searchParams.append(key, value);
        req.url = original.pathname + original.search;
        return handler(req, res);
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      try {
        const health = await fetch(base + '/api/health');
        assert.equal(health.status, 200);
        assert.equal((await health.json()).status, 'ok');
        const response = await fetch(base + '/api/v1/snapshot');
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.fields.length, 4);
        assert.equal(data.tasks.length, 8);
        assert.equal(data.papers.filter(paper => paper.fieldId !== 'mechinterp').length, 128);
        assert.ok(data.papers.some(paper => paper.fieldId === 'mechinterp'));
        assert.equal(data.contributions.length, 0);
        const filtered = await fetch(base + '/api/v1/tasks?field=batteries');
        assert.equal(filtered.status, 200);
        assert.equal((await filtered.json()).total, 2);
        const context = await fetch(base + '/api/v1/tasks/battery-metadata-map/context?max_bytes=4096');
        assert.equal(context.status, 200);
        const packet = await context.json();
        assert.equal(packet.budget.maxBytes, 4096);
        const unique = await fetch(base + '/api/v1/snapshot?nonce=unique');
        assert.equal(unique.status, 400);
        assert.equal((await unique.json()).error.code, 'invalid_query');
        const unknown = await fetch(base + '/api/v1/unknown');
        assert.equal(unknown.status, 404);
        assert.equal((await unknown.json()).error.code, 'endpoint_not_found');
        console.log('compiled API verified');
      } finally {
        server.closeAllConnections();
        server.close();
      }
    `,
      ],
      {
        cwd: output,
        env: {
          ...process.env,
          VERCEL: '',
          TURSO_DATABASE_URL: '',
          TURSO_AUTH_TOKEN: '',
          DATABASE_PATH: ':memory:',
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(result.stdout, /compiled API verified/);
  } finally {
    assert.ok(output.startsWith(join(root, '.local', 'deployment-test-')));
    rmSync(output, { recursive: true, force: true });
  }
});
