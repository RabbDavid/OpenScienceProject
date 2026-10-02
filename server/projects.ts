import { projects } from '../shared/projects.ts';
import { fields } from './catalog.ts';
import { ApiError, type Store } from './store.ts';

export function requireProject(id: string) {
  const project = projects.find((item) => item.id === id);
  if (!project) throw new ApiError(404, 'project_not_found', 'Unknown research project.');
  return project;
}

/** Never silently omit essential content to satisfy a requested budget. */
export function boundedRecord<T extends object>(value: T, maxBytes: number) {
  const packet = { ...value, budget: { maxBytes, actualBytes: 0 } };
  for (let i = 0; i < 6; i++) packet.budget.actualBytes = Buffer.byteLength(JSON.stringify(packet));
  const actual = Buffer.byteLength(JSON.stringify(packet));
  if (actual > maxBytes)
    throw new ApiError(
      413,
      'context_budget_too_small',
      `This complete record needs ${actual} UTF-8 bytes. Increase max_bytes; content is not silently truncated.`,
    );
  return packet;
}

export async function projectCards(store: Store, fieldId?: string) {
  const tasks = await store.tasks();
  return projects
    .filter((project) => !fieldId || project.fieldIds.some((id) => id === fieldId))
    .map((project) => {
      const questions = tasks.filter((task) =>
        project.steps.some((step) => step.taskId === task.id),
      );
      return {
        id: project.id,
        revision: project.revision,
        title: project.title,
        fieldIds: project.fieldIds,
        goal: project.goal,
        questions: questions.length,
        open: questions.filter((task) => task.status === 'open').length,
        claimed: questions.filter((task) => task.status === 'claimed').length,
        completed: questions.filter((task) => task.status === 'completed').length,
        context: `/api/v1/projects/${project.id}?max_bytes=4096`,
      };
    });
}

export async function projectContext(store: Store, id: string, maxBytes = 4096) {
  const project = requireProject(id);
  const { steps, ...brief } = project;
  const tasks = await store.tasks();
  return boundedRecord(
    {
      ...brief,
      recordKind: 'curated_research_direction',
      scope: fields
        .filter((field) => project.fieldIds.includes(field.id))
        .map(({ id, scope }) => ({ fieldId: id, scope })),
      questions: steps.map(({ taskId, purpose }) => {
        const task = tasks.find((item) => item.id === taskId);
        if (!task)
          throw new ApiError(503, 'project_task_unavailable', 'A project question is unavailable.');
        return {
          id: task.id,
          title: task.title,
          purpose,
          status: task.status,
          revision: task.revision,
          context: `/api/v1/tasks/${task.id}/context?max_bytes=4096`,
          priorWork: `/api/v1/contributions?task=${task.id}&limit=5`,
        };
      }),
      note: 'These are objectives and suggested work, not findings. Steps are not enforced dependencies. Load the task context for required policy and approved sources; completing a task does not resolve the entire project.',
      next: {
        projects: '/api/v1/projects',
        questions: `/api/v1/tasks?project=${project.id}&limit=5`,
        journey: '/#journey',
      },
    },
    maxBytes,
  );
}
