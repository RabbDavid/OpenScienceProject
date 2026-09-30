export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal,
  });
  const data = await response.json();
  if (!response.ok) {
    const issues = data.error?.issues
      ?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`)
      .join('; ');
    throw new Error(issues || data.error?.message || `Request failed (${response.status}).`);
  }
  return data as T;
}
export const prettyKind = (kind: string) =>
  ({
    source_audit: 'Source audit',
    synthesis: 'Evidence synthesis',
    replication: 'Reproduction',
    critique: 'Methodology critique',
  })[kind] ?? kind.replaceAll('_', ' ');
export const prettyStatus = (status: string) => status.replaceAll('_', ' ');
export const prettyOrigin = (origin: string | undefined) =>
  ({ agent: 'AI agent', human: 'Human', human_with_ai: 'Human with AI' })[origin ?? ''] ??
  'Not specified';
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Budapest',
  }).format(new Date(date));
