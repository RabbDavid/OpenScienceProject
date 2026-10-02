import { Database } from './database.ts';
import { projects } from '../shared/projects.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fields, papers, sources, tasks as seedTasks, migration3TaskIds } from './catalog.ts';
import type { Contribution, Event, Review, Role, Snapshot, Task } from '../shared/types.ts';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface Identity {
  id: string;
  name: string;
  role: Role;
  keyId: string;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
export class Store {
  db: Database;
  readonly ready: Promise<void>;
  constructor(path: string, authToken?: string) {
    this.db = new Database(path, authToken);
    this.ready = this.initialize();
  }
  private async initialize() {
    await this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_metadata (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)',
    );
    const version = await this.db.prepare('SELECT version FROM schema_metadata WHERE id=1').get();
    if (Number(version?.version) >= 5) return;
    await this.db.transaction(async () => {
      const current = await this.db.prepare('SELECT version FROM schema_metadata WHERE id=1').get();
      const currentVersion = Number(current?.version ?? 0);
      if (currentVersion >= 5) return;
      if (currentVersion < 2) {
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS write_budgets (actor_id TEXT PRIMARY KEY REFERENCES actors(id), count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), key_hash TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('contributor','curator')), revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', revision INTEGER NOT NULL DEFAULT 1, claimed_by TEXT REFERENCES actors(id), lease_hash TEXT, lease_expires_at TEXT);
      CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), author_id TEXT NOT NULL REFERENCES actors(id), status TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (contribution_id TEXT NOT NULL REFERENCES contributions(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(contribution_id,revision));
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL, revision INTEGER NOT NULL, reviewer_id TEXT NOT NULL REFERENCES actors(id), decision TEXT NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(contribution_id,revision) REFERENCES revisions(contribution_id,revision));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, actor_name TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revisions_hash ON revisions(content_hash);
      CREATE INDEX IF NOT EXISTS contribution_status ON contributions(status,updated_at);
    `);
        if (
          !(
            (await this.db.prepare('PRAGMA table_info(tasks)').all()) as {
              name: string;
            }[]
          ).some((column) => column.name === 'lease_renewals')
        )
          await this.db.exec(
            'ALTER TABLE tasks ADD COLUMN lease_renewals INTEGER NOT NULL DEFAULT 0',
          );
        const insert = this.db.prepare('INSERT OR IGNORE INTO tasks (id,payload) VALUES (?,?)');
        for (const task of seedTasks.filter((task) => !migration3TaskIds.includes(task.id)))
          await insert.run(task.id, JSON.stringify(task));
      }
      // Add only the two newly opened questions. Existing definitions, leases and work stay intact.
      if (currentVersion < 3) {
        const insert = this.db.prepare('INSERT OR IGNORE INTO tasks (id,payload) VALUES (?,?)');
        for (const taskId of migration3TaskIds) {
          const task = seedTasks.find((task) => task.id === taskId);
          if (!task) throw new Error(`Missing migration 3 task: ${taskId}`);
          await insert.run(task.id, JSON.stringify(task));
        }
      }
      // The materials science field was first published under the ID "reproducibility".
      // Only the field ID changes; each task's wording, revision and lease stay intact.
      if (currentVersion < 4) {
        const rows = (await this.db.prepare('SELECT id,payload FROM tasks').all()) as {
          id: string;
          payload: string;
        }[];
        const update = this.db.prepare('UPDATE tasks SET payload=? WHERE id=?');
        for (const row of rows) {
          const task = JSON.parse(row.payload) as { fieldId: string };
          if (task.fieldId === 'reproducibility')
            await update.run(JSON.stringify({ ...task, fieldId: 'materials' }), row.id);
        }
      }
      if (currentVersion < 5) {
        await this.db.exec(`
          CREATE TABLE IF NOT EXISTS research_notes (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
            author_id TEXT NOT NULL REFERENCES actors(id), payload TEXT NOT NULL,
            content_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
            idempotency_hash TEXT NOT NULL, risk TEXT NOT NULL CHECK(risk IN ('low','uncertain','high')),
            status TEXT NOT NULL CHECK(status IN ('unreviewed','retained','dismissed','held')),
            review_revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            UNIQUE(author_id,idempotency_hash)
          );
          CREATE INDEX IF NOT EXISTS research_notes_task ON research_notes(task_id,created_at,id);
          CREATE TABLE IF NOT EXISTS note_reviews (
            id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES research_notes(id),
            revision INTEGER NOT NULL, reviewer_id TEXT NOT NULL REFERENCES actors(id),
            decision TEXT NOT NULL CHECK(decision IN ('retain','dismiss','hold')),
            rationale TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(note_id,revision)
          );
        `);
      }
      await this.db
        .prepare(
          'INSERT INTO schema_metadata(id,version) VALUES (1,5) ON CONFLICT(id) DO UPDATE SET version=excluded.version',
        )
        .run();
    });
  }
  async close() {
    await this.ready;
    this.db.close();
  }
  async transaction<T>(action: () => T | Promise<T>): Promise<T> {
    await this.ready;
    return await this.db.transaction(action);
  }
  async event(type: string, actorName: string, entityId: string, detail: string) {
    await this.ready;
    await this.db
      .prepare('INSERT INTO events(type,actor_name,entity_id,detail,created_at) VALUES (?,?,?,?,?)')
      .run(type, actorName, entityId, detail, now());
  }
  async createKey(name: string, role: Role) {
    await this.ready;
    return await this.transaction(async () => {
      const normalized = name.trim().toLowerCase();
      let actor = (await this.db
        .prepare('SELECT id,name FROM actors WHERE normalized_name=?')
        .get(normalized)) as
        | {
            id: string;
            name: string;
          }
        | undefined;
      if (!actor) {
        actor = { id: id('actor'), name: name.trim() };
        await this.db
          .prepare('INSERT INTO actors(id,name,normalized_name) VALUES (?,?,?)')
          .run(actor.id, actor.name, normalized);
      }
      const key = `osc_${randomBytes(32).toString('base64url')}`;
      const keyId = id('key');
      await this.db
        .prepare('INSERT INTO api_keys(id,actor_id,key_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(keyId, actor.id, hash(key), role, now());
      return { key, keyId, actorId: actor.id, name: actor.name, role };
    });
  }
  async revokeKey(keyId: string) {
    await this.ready;
    const result = await this.db
      .prepare('UPDATE api_keys SET revoked=1 WHERE id=? AND revoked=0')
      .run(keyId);
    return Number(result.changes) > 0;
  }
  async authenticate(key: string): Promise<Identity> {
    await this.ready;
    const row = (await this.db
      .prepare(
        'SELECT a.id,a.name,k.role,k.id AS keyId FROM api_keys k JOIN actors a ON a.id=k.actor_id WHERE k.key_hash=? AND k.revoked=0',
      )
      .get(hash(key))) as unknown as Identity | undefined;
    if (!row)
      throw new ApiError(401, 'invalid_key', 'A valid operator-issued bearer key is required.');
    return row;
  }
  async consumeWriteBudget(actorId: string) {
    return this.transaction(async () => {
      const stamp = Date.now();
      const row = await this.db
        .prepare('SELECT count,reset_at FROM write_budgets WHERE actor_id=?')
        .get(actorId);
      if (!row || Number(row.reset_at) <= stamp) {
        await this.db
          .prepare(
            'INSERT INTO write_budgets(actor_id,count,reset_at) VALUES (?,1,?) ON CONFLICT(actor_id) DO UPDATE SET count=1,reset_at=excluded.reset_at',
          )
          .run(actorId, stamp + 60000);
        return true;
      }
      if (Number(row.count) >= 30) return false;
      await this.db.prepare('UPDATE write_budgets SET count=count+1 WHERE actor_id=?').run(actorId);
      return true;
    });
  }
  async task(taskId: string): Promise<Task> {
    await this.ready;
    const row = (await this.db
      .prepare(
        'SELECT t.*,a.name AS actor_name FROM tasks t LEFT JOIN actors a ON a.id=t.claimed_by WHERE t.id=?',
      )
      .get(taskId)) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, 'task_not_found', 'This task does not exist.');
    const leased = row.status === 'claimed' && String(row.lease_expires_at) > now();
    return {
      ...JSON.parse(String(row.payload)),
      status: row.status === 'completed' ? 'completed' : leased ? 'claimed' : 'open',
      revision: Number(row.revision),
      ...(leased
        ? { claimedBy: String(row.actor_name), leaseExpiresAt: String(row.lease_expires_at) }
        : {}),
    };
  }
  async tasks(): Promise<Task[]> {
    await this.ready;
    return (
      await Promise.all(
        (
          (await this.db.prepare('SELECT id FROM tasks').all()) as {
            id: string;
          }[]
        ).map((t) => this.task(t.id)),
      )
    ).sort((a, b) => b.priority - a.priority);
  }
  async claim(taskId: string, actor: Identity, expectedRevision: number) {
    await this.ready;
    return await this.transaction(async () => {
      const task = await this.task(taskId);
      if (task.revision !== expectedRevision)
        throw new ApiError(409, 'stale_revision', 'Refresh the task and use its current revision.');
      if (task.status !== 'open')
        throw new ApiError(409, 'task_unavailable', 'This task is already claimed or completed.');
      const leaseToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 45 * 60000).toISOString();
      await this.db
        .prepare(
          "UPDATE tasks SET status='claimed',revision=revision+1,claimed_by=?,lease_hash=?,lease_expires_at=?,lease_renewals=0 WHERE id=?",
        )
        .run(actor.id, hash(leaseToken), expiresAt, taskId);
      await this.event('task.claimed', actor.name, taskId, 'Claimed a 45-minute work lease.');
      return { task: await this.task(taskId), leaseToken, expiresAt };
    });
  }
  async release(taskId: string, actor: Identity, leaseToken: string) {
    await this.ready;
    return await this.transaction(async () => {
      await this.assertLease(taskId, actor, leaseToken);
      await this.clearLease(taskId);
      await this.event('task.released', actor.name, taskId, 'Released the work lease.');
      return await this.task(taskId);
    });
  }
  async renew(taskId: string, actor: Identity, leaseToken: string) {
    await this.ready;
    return await this.transaction(async () => {
      await this.assertLease(taskId, actor, leaseToken);
      const row = (await this.db
        .prepare('SELECT lease_renewals FROM tasks WHERE id=?')
        .get(taskId)) as {
        lease_renewals: number;
      };
      if (row.lease_renewals >= 2)
        throw new ApiError(
          409,
          'renewal_limit',
          'A lease may be renewed twice. Submit a bounded result or release it.',
        );
      const expiresAt = new Date(Date.now() + 45 * 60000).toISOString();
      await this.db
        .prepare('UPDATE tasks SET lease_expires_at=?,lease_renewals=lease_renewals+1 WHERE id=?')
        .run(expiresAt, taskId);
      await this.event('task.renewed', actor.name, taskId, 'Renewed a work lease for 45 minutes.');
      return {
        task: await this.task(taskId),
        expiresAt,
        renewalsRemaining: 1 - row.lease_renewals,
      };
    });
  }
  async assertLease(taskId: string, actor: Identity, token: string) {
    await this.ready;
    await this.task(taskId);
    const row = (await this.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId)) as Record<
      string,
      unknown
    >;
    if (
      row.status !== 'claimed' ||
      row.claimed_by !== actor.id ||
      row.lease_hash !== hash(token) ||
      String(row.lease_expires_at) <= now()
    )
      throw new ApiError(
        409,
        'invalid_lease',
        'A current lease belonging to your identity is required. Claim the task again if it expired.',
      );
  }
  async clearLease(taskId: string) {
    await this.ready;
    await this.db
      .prepare(
        "UPDATE tasks SET status='open',revision=revision+1,claimed_by=NULL,lease_hash=NULL,lease_expires_at=NULL WHERE id=?",
      )
      .run(taskId);
  }
  async contribution(contributionId: string, revision?: number): Promise<Contribution> {
    await this.ready;
    const row = (await this.db
      .prepare(
        'SELECT c.*,a.name AS author_name,r.payload,r.content_hash FROM contributions c JOIN actors a ON a.id=c.author_id JOIN revisions r ON r.contribution_id=c.id AND r.revision=COALESCE(?,c.revision) WHERE c.id=?',
      )
      .get(revision ?? null, contributionId)) as Record<string, unknown> | undefined;
    if (!row)
      throw new ApiError(
        404,
        'contribution_not_found',
        'This contribution or revision does not exist.',
      );
    return {
      ...JSON.parse(String(row.payload)),
      id: String(row.id),
      authorId: String(row.author_id),
      authorName: String(row.author_name),
      status: String(row.status),
      revision: revision ?? Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      contentHash: String(row.content_hash),
    };
  }
  async contributions(
    status?: string,
    limit = 30,
    offset = 0,
    taskId?: string,
    access?: {
      actorId: string;
      curator: boolean;
    },
  ): Promise<Contribution[]> {
    await this.ready;
    const rows = (await this.db
      .prepare(
        "SELECT c.id FROM contributions c JOIN revisions r ON r.contribution_id=c.id AND r.revision=c.revision WHERE (? IS NULL OR c.status=?) AND (? IS NULL OR c.task_id=?) AND (?=1 OR (c.status!='held' AND json_extract(r.payload,'$.risk')='low') OR c.author_id=?) ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?",
      )
      .all(
        status ?? null,
        status ?? null,
        taskId ?? null,
        taskId ?? null,
        !access || access.curator ? 1 : 0,
        access?.actorId ?? '',
        limit,
        offset,
      )) as {
      id: string;
    }[];
    return Promise.all(rows.map((row) => this.contribution(row.id)));
  }
  async submit(
    actor: Identity,
    payload: Omit<
      Contribution,
      | 'id'
      | 'authorId'
      | 'authorName'
      | 'status'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'contentHash'
    >,
    leaseToken: string,
    taskRevision: number,
  ) {
    await this.ready;
    return await this.transaction(async () => {
      await this.assertLease(payload.taskId, actor, leaseToken);
      if ((await this.task(payload.taskId)).revision !== taskRevision)
        throw new ApiError(
          409,
          'stale_revision',
          'The task revision changed. Refresh before submitting.',
        );
      const contentHash = hash(JSON.stringify(payload));
      if (await this.db.prepare('SELECT 1 FROM revisions WHERE content_hash=?').get(contentHash))
        throw new ApiError(
          409,
          'duplicate_content',
          'This exact contribution is already recorded.',
        );
      const contributionId = id('work');
      const status = payload.risk === 'low' ? 'proposed' : 'held';
      const createdAt = now();
      await this.db
        .prepare(
          'INSERT INTO contributions(id,task_id,author_id,status,revision,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
        )
        .run(contributionId, payload.taskId, actor.id, status, createdAt, createdAt);
      await this.db
        .prepare(
          'INSERT INTO revisions(contribution_id,revision,payload,content_hash,created_at) VALUES (?,1,?,?,?)',
        )
        .run(contributionId, JSON.stringify(payload), contentHash, createdAt);
      await this.clearLease(payload.taskId);
      await this.event(
        'contribution.proposed',
        actor.name,
        contributionId,
        status === 'held'
          ? 'Submitted work held for scope and risk review.'
          : 'Submitted cited work for independent review.',
      );
      return await this.contribution(contributionId);
    });
  }
  async revise(
    contributionId: string,
    actor: Identity,
    expectedRevision: number,
    payload: Omit<
      Contribution,
      | 'id'
      | 'authorId'
      | 'authorName'
      | 'status'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'contentHash'
    >,
  ) {
    await this.ready;
    return await this.transaction(async () => {
      const old = await this.contribution(contributionId);
      if (old.authorId !== actor.id)
        throw new ApiError(
          403,
          'author_required',
          'Only the original author can create a revision.',
        );
      if (old.revision !== expectedRevision)
        throw new ApiError(409, 'stale_revision', 'Refresh the contribution before revising.');
      if (['accepted', 'rejected'].includes(old.status))
        throw new ApiError(
          409,
          'terminal_status',
          'Accepted and rejected records are immutable. Submit new work on an open task.',
        );
      if (old.taskId !== payload.taskId)
        throw new ApiError(409, 'task_mismatch', 'A revision cannot change its task.');
      const contentHash = hash(JSON.stringify(payload));
      if (await this.db.prepare('SELECT 1 FROM revisions WHERE content_hash=?').get(contentHash))
        throw new ApiError(409, 'duplicate_content', 'This exact content is already recorded.');
      const nextRevision = old.revision + 1;
      const createdAt = now();
      await this.db
        .prepare(
          'INSERT INTO revisions(contribution_id,revision,payload,content_hash,created_at) VALUES (?,?,?,?,?)',
        )
        .run(contributionId, nextRevision, JSON.stringify(payload), contentHash, createdAt);
      await this.db
        .prepare('UPDATE contributions SET revision=?,status=?,updated_at=? WHERE id=?')
        .run(nextRevision, payload.risk === 'low' ? 'proposed' : 'held', createdAt, contributionId);
      await this.event(
        'contribution.revised',
        actor.name,
        contributionId,
        `Created immutable revision ${nextRevision}.`,
      );
      return await this.contribution(contributionId);
    });
  }
  async reviews(contributionId: string): Promise<Review[]> {
    await this.ready;
    await this.contribution(contributionId);
    return (
      (await this.db
        .prepare(
          'SELECT r.*,a.name AS reviewer_name FROM reviews r JOIN actors a ON a.id=r.reviewer_id WHERE contribution_id=? ORDER BY created_at,id',
        )
        .all(contributionId)) as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      contributionId,
      revision: Number(r.revision),
      reviewerId: String(r.reviewer_id),
      reviewerName: String(r.reviewer_name),
      decision: String(r.decision) as Review['decision'],
      rationale: String(r.rationale),
      createdAt: String(r.created_at),
    }));
  }
  async review(
    contributionId: string,
    actor: Identity,
    revision: number,
    decision: Review['decision'],
    rationale: string,
  ) {
    await this.ready;
    return await this.transaction(async () => {
      if (actor.role !== 'curator')
        throw new ApiError(
          403,
          'curator_required',
          'Only an operator-issued curator identity can review work.',
        );
      const contribution = await this.contribution(contributionId);
      if (actor.id === contribution.authorId)
        throw new ApiError(
          403,
          'independent_review_required',
          'Authors cannot review their own work.',
        );
      if (contribution.revision !== revision)
        throw new ApiError(
          409,
          'stale_revision',
          'The contribution changed; review its latest revision.',
        );
      if (['accepted', 'rejected'].includes(contribution.status))
        throw new ApiError(
          409,
          'terminal_status',
          'This contribution already has a final decision.',
        );
      if (decision === 'accept' && contribution.status === 'held')
        throw new ApiError(
          409,
          'risk_hold',
          'Held work cannot be accepted. Request a revision that resolves the scope and risk concerns, or reject it.',
        );
      if (decision === 'accept' && (await this.task(contribution.taskId)).status === 'claimed')
        throw new ApiError(
          409,
          'active_work_lease',
          'Another agent is working on this task. Review after its lease is released or expires.',
        );
      const reviewId = id('review');
      const createdAt = now();
      await this.db
        .prepare(
          'INSERT INTO reviews(id,contribution_id,revision,reviewer_id,decision,rationale,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(reviewId, contributionId, revision, actor.id, decision, rationale, createdAt);
      const status =
        decision === 'accept'
          ? 'accepted'
          : decision === 'reject'
            ? 'rejected'
            : 'changes_requested';
      // A held record stays held until its author explicitly resolves the risk in a new revision.
      const nextStatus =
        contribution.status === 'held' && decision === 'request_changes' ? 'held' : status;
      await this.db
        .prepare('UPDATE contributions SET status=?,updated_at=? WHERE id=?')
        .run(nextStatus, createdAt, contributionId);
      if (decision === 'accept')
        await this.db
          .prepare(
            "UPDATE tasks SET status='completed',revision=revision+1,claimed_by=NULL,lease_hash=NULL,lease_expires_at=NULL WHERE id=?",
          )
          .run(contribution.taskId);
      await this.event(
        `review.${decision}`,
        actor.name,
        contributionId,
        contribution.risk !== 'low'
          ? `Revision ${revision}: scope and risk review recorded; content restricted.`
          : `Revision ${revision}: ${rationale}`,
      );
      return {
        contribution: await this.contribution(contributionId),
        reviews: await this.reviews(contributionId),
      };
    });
  }
  async history(contributionId: string) {
    await this.ready;
    await this.contribution(contributionId);
    return (
      (await this.db
        .prepare(
          'SELECT revision,content_hash,created_at FROM revisions WHERE contribution_id=? ORDER BY revision',
        )
        .all(contributionId)) as Record<string, unknown>[]
    ).map((r) => ({
      revision: Number(r.revision),
      contentHash: String(r.content_hash),
      createdAt: String(r.created_at),
    }));
  }
  async events(after = 0, limit = 20): Promise<Event[]> {
    await this.ready;
    return (
      (await this.db
        .prepare('SELECT * FROM events WHERE id>? ORDER BY id DESC LIMIT ?')
        .all(after, limit)) as Record<string, unknown>[]
    )
      .map((r) => ({
        id: Number(r.id),
        type: String(r.type),
        actorName: String(r.actor_name),
        entityId: String(r.entity_id),
        detail: String(r.detail),
        createdAt: String(r.created_at),
      }))
      .reverse();
  }
  async snapshot(): Promise<Snapshot> {
    await this.ready;
    const allTasks = await this.tasks();
    const accepted = (await this.db
      .prepare("SELECT COUNT(*) AS count FROM contributions WHERE status='accepted'")
      .get()) as {
      count: number;
    };
    const contributors = (await this.db
      .prepare('SELECT COUNT(DISTINCT author_id) AS count FROM contributions')
      .get()) as {
      count: number;
    };
    return {
      fields,
      projects,
      sources,
      papers,
      tasks: allTasks,
      contributions: await this.contributions(undefined, 50),
      events: await this.events(),
      stats: {
        sources: sources.length,
        openTasks: allTasks.filter((t) => t.status === 'open').length,
        accepted: Number(accepted.count),
        contributors: Number(contributors.count),
      },
    };
  }
}
