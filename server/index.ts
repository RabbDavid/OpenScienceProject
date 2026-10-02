import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import express from 'express';
import { createConfiguredStore } from './config.ts';
import { createApp } from './app.ts';

if (existsSync('.env')) loadEnvFile('.env');
const production = process.argv.includes('--production');
const store = createConfiguredStore();
await store.ready;
const app = createApp(store, { development: !production });
// Browser readers may reject text/markdown. Both entry points carry the same maintained text.
app.get(['/agent.md', '/agent.txt'], (_req, res) =>
  res.type('text/plain').sendFile(resolve('public/agent.md')),
);
if (production) {
  const dist = resolve('dist');
  if (!existsSync(resolve(dist, 'index.html')))
    throw new Error('Run npm run build before starting production.');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
} else {
  const { pluginArchive } = await import('../scripts/plugin-package.ts');
  const archive = Buffer.from(pluginArchive());
  app.get('/openscience-plugin.zip', (_req, res) =>
    res.type('application/zip').attachment('openscience-plugin.zip').send(archive),
  );
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(
    `OpenScience Commons → http://${host}:${port} (${production ? 'production' : 'development'})`,
  ),
);
const shutdown = () =>
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
