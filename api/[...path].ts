import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app.ts';
import { createConfiguredStore } from '../server/config.ts';

let application: Promise<ReturnType<typeof createApp>> | undefined;
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    application ??= (async () => {
      const store = createConfiguredStore();
      try {
        await store.ready;
      } catch (error) {
        store.db.close();
        throw error;
      }
      return createApp(store);
    })();
    const app = await application;
    app(req, res);
  } catch {
    application = undefined;
    console.error('OpenScience API initialization failed. Check the database configuration.');
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        error: 'service_unavailable',
        message: 'The research database is temporarily unavailable.',
      }),
    );
  }
}
