import { Store } from './store.ts';

export function createConfiguredStore(env: NodeJS.ProcessEnv = process.env) {
  if (env.TURSO_DATABASE_URL) {
    if (!/^(libsql|https):\/\//.test(env.TURSO_DATABASE_URL))
      throw new Error('TURSO_DATABASE_URL must be a libsql:// or https:// URL.');
    return new Store(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  }
  if (env.VERCEL === '1' || env.TURSO_AUTH_TOKEN)
    throw new Error(
      'Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for persistent cloud storage.',
    );
  return new Store(env.DATABASE_PATH ?? './data/commons.sqlite');
}
