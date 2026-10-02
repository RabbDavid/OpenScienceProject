export type View =
  | 'overview'
  | 'projects'
  | 'journey'
  | 'frontier'
  | 'map'
  | 'library'
  | 'reviews'
  | 'protocol'
  | 'about';

export interface Route {
  view: View;
  field: string;
  task: string;
  project?: string;
}

/** Preserve shared links from before the materials field was renamed. */
export function parseRoute(hash: string): Route {
  const [name, query] = hash.replace(/^#/, '').split('?');
  const view = name === 'graph' ? 'map' : name;
  const params = new URLSearchParams(query);
  const field = params.get('field') ?? 'all';
  return {
    view: [
      'overview',
      'projects',
      'journey',
      'frontier',
      'map',
      'library',
      'reviews',
      'protocol',
      'about',
    ].includes(view)
      ? (view as View)
      : 'overview',
    field: field === 'reproducibility' ? 'materials' : field,
    task: params.get('task') ?? '',
    project: params.get('project') ?? '',
  };
}

export function routeHash({ view, field, task, project }: Route): string {
  const params = new URLSearchParams();
  if (field !== 'all') params.set('field', field === 'reproducibility' ? 'materials' : field);
  if (task) params.set('task', task);
  if (project) params.set('project', project);
  return `#${view}${params.size ? `?${params}` : ''}`;
}
