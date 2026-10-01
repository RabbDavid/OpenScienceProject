import { mkdir, writeFile } from 'node:fs/promises';
import { discoveryManifest } from '../server/manifest.ts';

// Vercel reserves /.well-known, so discovery is a static artifact of this build.
await mkdir('dist/.well-known', { recursive: true });
await writeFile(
  'dist/.well-known/openscience.json',
  JSON.stringify(discoveryManifest(process.env.VERCEL === '1'), null, 2) + '\n',
);
