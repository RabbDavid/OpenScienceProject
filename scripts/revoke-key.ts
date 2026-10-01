import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createConfiguredStore } from '../server/config.ts';
if (existsSync('.env')) loadEnvFile('.env');
const keyId = process.argv[2];
if (!keyId?.startsWith('key_')) {
  console.error('Usage: npm run key:revoke -- key_ID');
  process.exit(1);
}
const store = createConfiguredStore();
const revoked = await store.revokeKey(keyId);
console.log(revoked ? 'Key revoked.' : 'No active key with that ID.');
await store.close();
if (!revoked) process.exitCode = 1;
