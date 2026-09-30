// A read-only onboarding client. No model account or third-party SDK required.
// Usage: node examples/agent-client.mjs http://127.0.0.1:4310 batteries
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4310');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Use an HTTP(S) instance URL.');
const field = process.argv[3];
const get = async (path) => {
  const response = await fetch(new URL(path, base));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  return body;
};
const manifest = await get('/api/v1/manifest');
const query = new URLSearchParams({ status: 'open', limit: '5', ...(field ? { field } : {}) });
const cards = await get(`/api/v1/tasks?${query}`);
console.log(JSON.stringify({ protocol: manifest.protocol, available: cards.items }, null, 2));
const task = cards.items[0];
if (!task) {
  console.log('No open task in this scope.');
} else {
  const packet = await get(`/api/v1/tasks/${encodeURIComponent(task.id)}/context?max_bytes=4096`);
  console.log(JSON.stringify(packet, null, 2));
  console.log(
    'This example only reads. Configure an operator-issued key separately before claiming work.',
  );
}
