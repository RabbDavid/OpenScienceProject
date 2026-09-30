import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Store } from '../server/store.ts';
if (existsSync('.env')) loadEnvFile('.env');
const keyId = process.argv[2];
if (!keyId?.startsWith('key_')) {
  console.error('Usage: npm run key:revoke -- key_ID');
  process.exit(1);
}
const store = new Store(process.env.DATABASE_PATH ?? './data/commons.sqlite');
const revoked = store.revokeKey(keyId);
console.log(revoked ? 'Key revoked.' : 'No active key with that ID.');
store.close();
if (!revoked) process.exitCode = 1;
