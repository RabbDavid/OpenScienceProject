import { discoveryManifest } from './manifest.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { fields, literature, papers, sources, skills, policy } from './catalog.ts';
import { ApiError, Store, hash, type Identity } from './store.ts';
import { contextPacket } from './context.ts';
import type { Contribution } from '../shared/types.ts';
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const contentSchema = z
  .object({
    taskId: text(1, 100),
    title: text(12, 180),
    kind: z.enum(['source_audit', 'synthesis', 'replication', 'critique']),
    summary: text(40, 800),
    body: text(80, 12000),
    method: text(25, 2000),
    limitations: text(25, 2000),
    citations: z
      .array(
        z
          .object({ sourceId: text(1, 100), locator: text(5, 300), supports: text(15, 600) })
          .strict(),
      )
      .min(1)
      .max(12),
    risk: z.enum(['low', 'uncertain', 'high']),
    origin: z.enum(['agent', 'human', 'human_with_ai', 'unspecified']).default('unspecified'),
    model: z.string().trim().max(80).optional(),
  })
  .strict();
const submitSchema = contentSchema.extend({
  leaseToken: text(20, 100),
  taskRevision: z.number().int().positive(),
});
const revisionSchema = contentSchema.extend({ expectedRevision: z.number().int().positive() });
const reviewSchema = z
  .object({
    revision: z.number().int().positive(),
    decision: z.enum(['accept', 'request_changes', 'reject']),
    rationale: text(30, 2000),
    checks: z
      .object({ evidence: z.literal(true), scope: z.literal(true), limitations: z.literal(true) })
      .strict(),
  })
  .strict();
function integerParam(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new ApiError(400, 'invalid_query', 'Expected an integer query parameter.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new ApiError(400, 'invalid_query', `Value must be between ${min} and ${max}.`);
  return number;
}
export function createApp(
  store: Store,
  options: {
    development?: boolean;
  } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: options.development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: options.development
            ? ["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*']
            : ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  // No wildcard CORS. Bearer authentication permits agents; browsers stay same-origin.
  app.use('/api', express.json({ limit: '40kb', type: 'application/json' }));
  const authenticate = async (req: Request) => {
    const match = /^Bearer (\S{20,200})$/.exec(req.headers.authorization ?? '');
    if (!match)
      throw new ApiError(
        401,
        'key_required',
        'Use Authorization: Bearer <operator-issued-key>. Read access is public.',
      );
    return await store.authenticate(match[1]);
  };
  const actor = async (req: Request): Promise<Identity> => {
    const identity = await authenticate(req);
    if (!(await store.consumeWriteBudget(identity.id)))
      throw new ApiError(
        429,
        'write_rate_limited',
        'Write limit reached. Try again in one minute.',
      );
    return identity;
  };
  const reader = async (req: Request): Promise<Identity | undefined> =>
    req.headers.authorization ? await authenticate(req) : undefined;
  const canReadHeld = (identity: Identity | undefined, authorId: string) =>
    identity?.role === 'curator' || identity?.id === authorId;
  const visible = (work: Contribution, identity: Identity | undefined) =>
    (work.status !== 'held' && work.risk === 'low') || canReadHeld(identity, work.authorId);
  const cached = (req: Request, res: Response, value: unknown) => {
    const data = JSON.stringify(value);
    const etag = `"${hash(data)}"`;
    res.set({
      ETag: etag,
      'Cache-Control': req.headers.authorization ? 'no-store' : 'private, no-cache',
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type('application/json').send(data);
  };
  const checked = async (
    value: z.infer<typeof contentSchema>,
  ): Promise<
    Omit<
      Contribution,
      | 'id'
      | 'authorId'
      | 'authorName'
      | 'status'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'contentHash'
    >
  > => {
    const task = await store.task(value.taskId);
    for (const citation of value.citations) {
      if (!sources.some((s) => s.id === citation.sourceId))
        throw new ApiError(
          422,
          'unknown_source',
          `Unknown source ID: ${citation.sourceId}. Request curator catalog expansion outside this MVP.`,
        );
      if (!task.sourceIds.includes(citation.sourceId))
        throw new ApiError(
          422,
          'source_outside_task',
          'Citations must come from this task’s curated source set.',
        );
    }
    return {
      ...value,
      fieldId: task.fieldId,
      checks: [
        { id: 'sources', label: 'Source IDs belong to the task', passed: true },
        { id: 'locators', label: 'Citation locations supplied', passed: true },
        { id: 'limitations', label: 'Method and limitations supplied', passed: true },
        { id: 'scope', label: 'Contributor declared low risk', passed: value.risk === 'low' },
      ],
    };
  };
  app.get(['/health', '/api/health'], (_req, res) =>
    res.json({ status: 'ok', protocol: 'openscience/0.1' }),
  );
  app.get(['/api/v1/manifest', '/.well-known/openscience.json'], (req, res) =>
    cached(req, res, discoveryManifest(process.env.VERCEL === '1')),
  );
  app.get('/api/v1/me', async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await authenticate(req));
  });
  app.get('/api/v1/snapshot', async (req, res) => {
    const identity = await reader(req);
    const snapshot = await store.snapshot();
    snapshot.contributions = snapshot.contributions.filter((work) => visible(work, identity));
    res.vary('Authorization');
    if (identity) res.set('Cache-Control', 'no-store').json(snapshot);
    else cached(req, res, snapshot);
  });
  app.get('/api/v1/fields', (req, res) => cached(req, res, fields));
  app.get('/api/v1/policy', (req, res) =>
    cached(req, res, {
      version: 1,
      rules: policy,
      riskHandling:
        'Uncertain and high-risk submissions are held, cannot be accepted, and need a resolved revision or rejection.',
    }),
  );
  app.get('/api/v1/schema', (req, res) =>
    cached(req, res, {
      protocol: 'openscience/0.1',
      submit: z.toJSONSchema(submitSchema, { io: 'input' }),
      revise: z.toJSONSchema(revisionSchema, { io: 'input' }),
      review: z.toJSONSchema(reviewSchema, { io: 'input' }),
    }),
  );
  app.get('/api/v1/skills', (req, res) => {
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : undefined;
    if (req.query.ids !== undefined && (!ids || ids.some((id) => !skills.some((s) => s.id === id))))
      throw new ApiError(400, 'unknown_skill', 'Use known skill IDs separated by commas.');
    cached(
      req,
      res,
      skills.filter((s) => !ids || ids.includes(s.id)),
    );
  });
  app.get('/api/v1/skills/:id', (req, res) => {
    const skill = skills.find((s) => s.id === req.params.id);
    if (!skill) throw new ApiError(404, 'skill_not_found', 'Unknown skill.');
    cached(req, res, skill);
  });
  app.get('/api/v1/tree', (req, res) =>
    cached(req, res, {
      root: 'commons',
      directories: fields.map(({ id, path, scope }) => ({
        id,
        path,
        scope,
        tasks: `/api/v1/tasks?field=${id}`,
        sources: `/api/v1/sources?field=${id}`,
      })),
    }),
  );
  app.get('/api/v1/sources', (req, res) => {
    const field = req.query.field;
    if (field !== undefined && !fields.some((f) => f.id === field))
      throw new ApiError(400, 'invalid_field', 'Unknown field.');
    cached(
      req,
      res,
      sources.filter((s) => !field || s.fieldId === field),
    );
  });
  app.get('/api/v1/sources/:id', (req, res) => {
    const source = sources.find((s) => s.id === req.params.id);
    if (!source) throw new ApiError(404, 'source_not_found', 'Unknown source.');
    cached(req, res, source);
  });
  const paperCard = (p: (typeof papers)[number]) => ({
    id: p.id,
    title: p.title,
    authors: p.authors,
    year: p.year,
    venue: p.venue,
    citedBy: p.citedBy,
    url: p.url,
    seed: p.seed,
  });
  app.get('/api/v1/papers', (req, res) => {
    const { field, q } = req.query;
    if (field !== undefined && !fields.some((f) => f.id === field))
      throw new ApiError(400, 'invalid_field', 'Unknown field.');
    if (q !== undefined && (typeof q !== 'string' || q.length > 200))
      throw new ApiError(400, 'invalid_query', 'Search must be at most 200 characters.');
    const limit = integerParam(req.query.limit, 20, 1, 200);
    const offset = integerParam(req.query.offset, 0, 0, 100000);
    const needle = typeof q === 'string' ? q.toLowerCase().trim() : '';
    const matches = papers.filter(
      (p) => (!field || p.fieldId === field) && (!needle || p.title.toLowerCase().includes(needle)),
    );
    cached(req, res, {
      note: 'Published background literature. Known citation counts rank first; counts unavailable from the metadata source are null. Use it to orient; cite only your task’s approved sources in a contribution.',
      source:
        literature.fieldSources?.[field as keyof typeof literature.fieldSources] ??
        literature.source,
      collectedAt:
        literature.fieldCollectedAt?.[field as keyof typeof literature.fieldCollectedAt] ??
        literature.collectedAt,
      total: matches.length,
      papers: [...matches]
        .sort((a, b) => (b.citedBy ?? -1) - (a.citedBy ?? -1) || (b.year ?? 0) - (a.year ?? 0))
        .slice(offset, offset + limit)
        .map(paperCard),
    });
  });
  app.get('/api/v1/papers/:id', (req, res) => {
    const paper = papers.find((p) => p.id === req.params.id);
    if (!paper) throw new ApiError(404, 'paper_not_found', 'Unknown paper.');
    const brief = (id: string) => {
      const p = papers.find((x) => x.id === id)!;
      return { id: p.id, title: p.title, year: p.year };
    };
    cached(req, res, {
      ...paper,
      references: paper.references.map(brief),
      citedByHere: papers.filter((p) => p.references.includes(paper.id)).map((p) => brief(p.id)),
    });
  });
  app.get('/api/v1/tasks', async (req, res) => {
    const { field, status, q } = req.query;
    if (field !== undefined && !fields.some((f) => f.id === field))
      throw new ApiError(400, 'invalid_field', 'Unknown field.');
    if (status !== undefined && !['open', 'claimed', 'completed'].includes(String(status)))
      throw new ApiError(400, 'invalid_status', 'Unknown task status.');
    if (q !== undefined && (typeof q !== 'string' || q.length > 200))
      throw new ApiError(400, 'invalid_query', 'Search must be at most 200 characters.');
    const limit = integerParam(req.query.limit, 20, 1, 100);
    const offset = integerParam(req.query.offset, 0, 0, 100000);
    const matches = (await store.tasks()).filter(
      (t) =>
        (!field || t.fieldId === field) &&
        (!status || t.status === status) &&
        (!q || `${t.title} ${t.question}`.toLowerCase().includes(String(q).toLowerCase())),
    );
    // Discovery returns cards, never entire task bodies or every source.
    cached(req, res, {
      items: matches
        .slice(offset, offset + limit)
        .map(({ id, fieldId, title, kind, priority, effort, status, revision }) => ({
          id,
          fieldId,
          title,
          kind,
          priority,
          effort,
          status,
          revision,
        })),
      total: matches.length,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
    });
  });
  app.get('/api/v1/tasks/:id', async (req, res) =>
    cached(req, res, await store.task(String(req.params.id))),
  );
  app.get('/api/v1/tasks/:id/context', async (req, res) =>
    cached(
      req,
      res,
      await contextPacket(
        store,
        String(req.params.id),
        integerParam(req.query.max_bytes, 4096, 1536, 16000),
      ),
    ),
  );
  app.post('/api/v1/tasks/:id/claim', async (req, res) => {
    const identity = await actor(req);
    const body = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    res
      .set('Cache-Control', 'no-store')
      .status(201)
      .json(await store.claim(String(req.params.id), identity, body.expectedRevision));
  });
  app.post('/api/v1/tasks/:id/release', async (req, res) => {
    const identity = await actor(req);
    const body = z
      .object({ leaseToken: text(20, 100) })
      .strict()
      .parse(req.body);
    res.json(await store.release(String(req.params.id), identity, body.leaseToken));
  });
  app.post('/api/v1/tasks/:id/renew', async (req, res) => {
    const identity = await actor(req);
    const body = z
      .object({ leaseToken: text(20, 100) })
      .strict()
      .parse(req.body);
    res
      .set('Cache-Control', 'no-store')
      .json(await store.renew(String(req.params.id), identity, body.leaseToken));
  });
  app.get('/api/v1/contributions', async (req, res) => {
    const identity = await reader(req);
    const status = req.query.status;
    if (
      status !== undefined &&
      !['proposed', 'held', 'changes_requested', 'accepted', 'rejected'].includes(String(status))
    )
      throw new ApiError(400, 'invalid_status', 'Unknown contribution status.');
    const limit = integerParam(req.query.limit, 30, 1, 100);
    const offset = integerParam(req.query.offset, 0, 0, 100000);
    const taskId =
      req.query.task === undefined
        ? undefined
        : typeof req.query.task === 'string'
          ? req.query.task
          : '';
    if (taskId !== undefined) await store.task(taskId);
    const items = await store.contributions(
      status ? String(status) : undefined,
      limit + 1,
      offset,
      taskId,
      { actorId: identity?.id ?? '', curator: identity?.role === 'curator' },
    );
    res.vary('Authorization');
    cached(req, res, {
      items: items.slice(0, limit).map(({ body, method, citations, ...card }) => ({
        ...card,
        citationCount: citations.length,
      })),
      nextOffset: items.length > limit ? offset + limit : null,
    });
  });
  app.get('/api/v1/contributions/:id', async (req, res) => {
    const identity = await reader(req);
    const contributionId = String(req.params.id);
    const revision =
      req.query.revision === undefined ? undefined : integerParam(req.query.revision, 1, 1, 100000);
    const contribution = await store.contribution(contributionId, revision);
    if (
      (!visible(contribution, identity) || contribution.risk !== 'low') &&
      !canReadHeld(identity, contribution.authorId)
    )
      throw new ApiError(
        403,
        'held_content_restricted',
        'Held and risk-flagged historical content is available only to its author and curators.',
      );
    const reviews = await Promise.all(
      (await store.reviews(contributionId)).map(async (review) =>
        (await store.contribution(contributionId, review.revision)).risk === 'low' ||
        canReadHeld(identity, contribution.authorId)
          ? review
          : {
              ...review,
              rationale:
                'Scope and risk review recorded; details are restricted to the author and curators.',
            },
      ),
    );
    res.vary('Authorization');
    // Historical content is immutable. Status and updatedAt describe the current record, explicitly.
    if (identity)
      res.set('Cache-Control', 'no-store').json({
        contribution,
        reviews,
        history: await store.history(contributionId),
        statusAppliesTo: 'current record, not historical revision',
      });
    else
      cached(req, res, {
        contribution,
        reviews,
        history: await store.history(contributionId),
        statusAppliesTo: 'current record, not historical revision',
      });
  });
  app.post('/api/v1/contributions', async (req, res) => {
    const identity = await actor(req);
    const { leaseToken, taskRevision, ...content } = submitSchema.parse(req.body);
    res
      .status(201)
      .json(await store.submit(identity, await checked(content), leaseToken, taskRevision));
  });
  app.post('/api/v1/contributions/:id/revisions', async (req, res) => {
    const identity = await actor(req);
    const { expectedRevision, ...content } = revisionSchema.parse(req.body);
    res
      .status(201)
      .json(
        await store.revise(
          String(req.params.id),
          identity,
          expectedRevision,
          await checked(content),
        ),
      );
  });
  app.post('/api/v1/contributions/:id/reviews', async (req, res) => {
    const identity = await actor(req);
    const body = reviewSchema.parse(req.body);
    res
      .status(201)
      .json(
        await store.review(
          String(req.params.id),
          identity,
          body.revision,
          body.decision,
          body.rationale,
        ),
      );
  });
  app.get('/api/v1/events', async (req, res) => {
    const after = integerParam(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = integerParam(req.query.limit, 20, 1, 100);
    // Ascending cursor stream prevents skipping intermediate events when a page is full.
    const rows = (await store.db
      .prepare('SELECT * FROM events WHERE id>? ORDER BY id ASC LIMIT ?')
      .all(after, limit)) as Record<string, unknown>[];
    const items = rows.map((r) => ({
      id: Number(r.id),
      type: r.type,
      actorName: r.actor_name,
      entityId: r.entity_id,
      detail: r.detail,
      createdAt: r.created_at,
    }));
    cached(req, res, { items, nextCursor: items.at(-1)?.id ?? after });
  });
  app.use('/api', (_req, _res, next) =>
    next(
      new ApiError(404, 'endpoint_not_found', 'Unknown API endpoint. Start at /api/v1/manifest.'),
    ),
  );
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'The submission does not match the contract.',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (error instanceof ApiError) {
      if (error.status === 429) res.set('Retry-After', '60');
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const err = error as {
      type?: string;
      status?: number;
    };
    if (err.type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'body_too_large', message: 'Request body exceeds 40 KB.' } });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } });
      return;
    }
    console.error(
      'Unhandled service error:',
      error instanceof Error ? error.message : 'unknown error',
    );
    res.status(500).json({
      error: { code: 'internal_error', message: 'The service could not complete the request.' },
    });
  });
  return app;
}
