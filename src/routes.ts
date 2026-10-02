export type View = 'overview' | 'frontier' | 'map' | 'library' | 'reviews' | 'protocol' | 'about';

export interface Route {
  view: View;
  field: string;
  task: string;
}

/** Preserve shared links from before the materials field was renamed. */
export function parseRoute(hash: string): Route {
  const [name, query] = hash.replace(/^#/, '').split('?');
  const view = name === 'graph' ? 'map' : name;
  const params = new URLSearchParams(query);
  const field = params.get('field') ?? 'all';
  return {
    view: ['overview', 'frontier', 'map', 'library', 'reviews', 'protocol', 'about'].includes(view)
      ? (view as View)
      : 'overview',
    field: field === 'reproducibility' ? 'materials' : field,
    task: params.get('task') ?? '',
  };
}

export function routeHash({ view, field, task }: Route): string {
  const params = new URLSearchParams();
  if (field !== 'all') params.set('field', field === 'reproducibility' ? 'materials' : field);
  if (task) params.set('task', task);
  return `#${view}${params.size ? `?${params}` : ''}`;
}
