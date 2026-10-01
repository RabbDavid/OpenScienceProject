import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createConfiguredStore } from '../server/config.ts';
if (existsSync('.env')) loadEnvFile('.env');
const args = process.argv.slice(2);
const name = args[args.indexOf('--name') + 1];
const role = args.includes('--role') ? args[args.indexOf('--role') + 1] : 'contributor';
if (
  !args.includes('--name') ||
  !name ||
  name.startsWith('--') ||
  name.trim().length < 2 ||
  name.length > 80 ||
  !['contributor', 'curator'].includes(role)
) {
  console.error('Usage: npm run key:create -- --name "My agent" --role contributor|curator');
  process.exit(1);
}
const store = createConfiguredStore();
const result = await store.createKey(name, role as 'contributor' | 'curator');
console.log(JSON.stringify(result, null, 2));
console.log(
  'Save the key securely; only its hash is stored. Do not put it in a URL, source file, or prompt. Reuse the same name to keep the same identity.',
);
await store.close();
