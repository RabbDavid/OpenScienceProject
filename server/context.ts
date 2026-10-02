import { sources, skills, policy } from './catalog.ts';
import { projectForTask } from '../shared/projects.ts';
import type { ContextPacket } from '../shared/types.ts';
import { Store, ApiError } from './store.ts';
export async function contextPacket(
  store: Store,
  taskId: string,
  maxBytes: number,
): Promise<ContextPacket> {
  const task = await store.task(taskId);
  const packet: ContextPacket = {
    protocol: 'openscience/0.1',
    task: {
      id: task.id,
      title: task.title,
      question: task.question,
      acceptance: task.acceptance,
      exclusions: task.exclusions,
      revision: task.revision,
    },
    policy,
    skills: skills
      .filter((s) => task.skillIds.includes(s.id))
      .map(({ id, steps }) => ({ id, steps })),
    sources: sources
      .filter((s) => task.sourceIds.includes(s.id))
      .map(({ id, title, url, locator }) => ({ id, title, url, locator })),
    priorWork: (
      await store.contributions(undefined, 5, 0, taskId, { actorId: '', curator: false })
    ).map(({ id, title, status, revision }) => ({ id, title, status, revision })),
    next: {
      ...(projectForTask(taskId)
        ? { project: `/api/v1/projects/${projectForTask(taskId)!.id}?max_bytes=4096` }
        : {}),
      claim: `POST /api/v1/tasks/${taskId}/claim`,
      submit: 'POST /api/v1/contributions',
      expand: `/api/v1/tasks/${taskId}`,
      relatedWork: `/api/v1/contributions?task=${taskId}`,
      skills: `/api/v1/skills?ids=${task.skillIds.join(',')}`,
      literature: `/api/v1/papers?field=${task.fieldId}&limit=10`,
    },
    budget: {
      maxBytes,
      actualBytes: 0,
      estimatedTokens: 0,
      estimation: 'UTF-8 bytes / 4, heuristic only; actual tokenizer counts vary.',
      truncated: false,
    },
  };
  const measure = () => {
    for (let i = 0; i < 6; i++) {
      const actualBytes = Buffer.byteLength(JSON.stringify(packet));
      packet.budget.actualBytes = actualBytes;
      packet.budget.estimatedTokens = Math.ceil(actualBytes / 4);
    }
    return Buffer.byteLength(JSON.stringify(packet));
  };
  while (measure() > maxBytes && (packet.priorWork.length || packet.skills.length)) {
    if (packet.priorWork.length) packet.priorWork.pop();
    else packet.skills.pop();
    packet.budget.truncated = true;
  }
  if (measure() > maxBytes)
    throw new ApiError(
      413,
      'context_budget_too_small',
      `The essential task, source references, and policy need ${measure()} UTF-8 bytes. Increase max_bytes; safety instructions are never silently removed.`,
    );
  return packet;
}
