import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fields, sources, tasks as seedTasks } from './catalog.ts';
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
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT UNIQUE NOT NULL);
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
      !(this.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).some(
        (column) => column.name === 'lease_renewals',
      )
    )
      this.db.exec('ALTER TABLE tasks ADD COLUMN lease_renewals INTEGER NOT NULL DEFAULT 0');
    const insert = this.db.prepare('INSERT OR IGNORE INTO tasks (id,payload) VALUES (?,?)');
    for (const task of seedTasks) insert.run(task.id, JSON.stringify(task));
  }
  close() {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  event(type: string, actorName: string, entityId: string, detail: string) {
    this.db
      .prepare('INSERT INTO events(type,actor_name,entity_id,detail,created_at) VALUES (?,?,?,?,?)')
      .run(type, actorName, entityId, detail, now());
  }
  createKey(name: string, role: Role) {
    return this.transaction(() => {
      const normalized = name.trim().toLowerCase();
      let actor = this.db
        .prepare('SELECT id,name FROM actors WHERE normalized_name=?')
        .get(normalized) as { id: string; name: string } | undefined;
      if (!actor) {
        actor = { id: id('actor'), name: name.trim() };
        this.db
          .prepare('INSERT INTO actors(id,name,normalized_name) VALUES (?,?,?)')
          .run(actor.id, actor.name, normalized);
      }
      const key = `osc_${randomBytes(32).toString('base64url')}`;
      const keyId = id('key');
      this.db
        .prepare('INSERT INTO api_keys(id,actor_id,key_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(keyId, actor.id, hash(key), role, now());
      return { key, keyId, actorId: actor.id, name: actor.name, role };
    });
  }
  revokeKey(keyId: string) {
    const result = this.db
      .prepare('UPDATE api_keys SET revoked=1 WHERE id=? AND revoked=0')
      .run(keyId);
    return Number(result.changes) > 0;
  }
  authenticate(key: string): Identity {
    const row = this.db
      .prepare(
        'SELECT a.id,a.name,k.role,k.id AS keyId FROM api_keys k JOIN actors a ON a.id=k.actor_id WHERE k.key_hash=? AND k.revoked=0',
      )
      .get(hash(key)) as Identity | undefined;
    if (!row)
      throw new ApiError(401, 'invalid_key', 'A valid operator-issued bearer key is required.');
    return row;
  }
  task(taskId: string): Task {
    const row = this.db
      .prepare(
        'SELECT t.*,a.name AS actor_name FROM tasks t LEFT JOIN actors a ON a.id=t.claimed_by WHERE t.id=?',
      )
      .get(taskId) as Record<string, unknown> | undefined;
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
  tasks(): Task[] {
    return (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[])
      .map((t) => this.task(t.id))
      .sort((a, b) => b.priority - a.priority);
  }
  claim(taskId: string, actor: Identity, expectedRevision: number) {
    return this.transaction(() => {
      const task = this.task(taskId);
      if (task.revision !== expectedRevision)
        throw new ApiError(409, 'stale_revision', 'Refresh the task and use its current revision.');
      if (task.status !== 'open')
        throw new ApiError(409, 'task_unavailable', 'This task is already claimed or completed.');
      const leaseToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 45 * 60_000).toISOString();
      this.db
        .prepare(
          "UPDATE tasks SET status='claimed',revision=revision+1,claimed_by=?,lease_hash=?,lease_expires_at=?,lease_renewals=0 WHERE id=?",
        )
        .run(actor.id, hash(leaseToken), expiresAt, taskId);
      this.event('task.claimed', actor.name, taskId, 'Claimed a 45-minute work lease.');
      return { task: this.task(taskId), leaseToken, expiresAt };
    });
  }
  release(taskId: string, actor: Identity, leaseToken: string) {
    return this.transaction(() => {
      this.assertLease(taskId, actor, leaseToken);
      this.clearLease(taskId);
      this.event('task.released', actor.name, taskId, 'Released the work lease.');
      return this.task(taskId);
    });
  }
  renew(taskId: string, actor: Identity, leaseToken: string) {
    return this.transaction(() => {
      this.assertLease(taskId, actor, leaseToken);
      const row = this.db.prepare('SELECT lease_renewals FROM tasks WHERE id=?').get(taskId) as {
        lease_renewals: number;
      };
      if (row.lease_renewals >= 2)
        throw new ApiError(
          409,
          'renewal_limit',
          'A lease may be renewed twice. Submit a bounded result or release it.',
        );
      const expiresAt = new Date(Date.now() + 45 * 60_000).toISOString();
      this.db
        .prepare('UPDATE tasks SET lease_expires_at=?,lease_renewals=lease_renewals+1 WHERE id=?')
        .run(expiresAt, taskId);
      this.event('task.renewed', actor.name, taskId, 'Renewed a work lease for 45 minutes.');
      return { task: this.task(taskId), expiresAt, renewalsRemaining: 1 - row.lease_renewals };
    });
  }
  assertLease(taskId: string, actor: Identity, token: string) {
    this.task(taskId);
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as Record<
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
  clearLease(taskId: string) {
    this.db
      .prepare(
        "UPDATE tasks SET status='open',revision=revision+1,claimed_by=NULL,lease_hash=NULL,lease_expires_at=NULL WHERE id=?",
      )
      .run(taskId);
  }
  contribution(contributionId: string, revision?: number): Contribution {
    const row = this.db
      .prepare(
        'SELECT c.*,a.name AS author_name,r.payload,r.content_hash FROM contributions c JOIN actors a ON a.id=c.author_id JOIN revisions r ON r.contribution_id=c.id AND r.revision=COALESCE(?,c.revision) WHERE c.id=?',
      )
      .get(revision ?? null, contributionId) as Record<string, unknown> | undefined;
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
  contributions(
    status?: string,
    limit = 30,
    offset = 0,
    taskId?: string,
    access?: { actorId: string; curator: boolean },
  ): Contribution[] {
    const rows = this.db
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
      ) as { id: string }[];
    return rows.map((row) => this.contribution(row.id));
  }
  submit(
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
    return this.transaction(() => {
      this.assertLease(payload.taskId, actor, leaseToken);
      if (this.task(payload.taskId).revision !== taskRevision)
        throw new ApiError(
          409,
          'stale_revision',
          'The task revision changed. Refresh before submitting.',
        );
      const contentHash = hash(JSON.stringify(payload));
      if (this.db.prepare('SELECT 1 FROM revisions WHERE content_hash=?').get(contentHash))
        throw new ApiError(
          409,
          'duplicate_content',
          'This exact contribution is already recorded.',
        );
      const contributionId = id('work');
      const status = payload.risk === 'low' ? 'proposed' : 'held';
      const createdAt = now();
      this.db
        .prepare(
          'INSERT INTO contributions(id,task_id,author_id,status,revision,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
        )
        .run(contributionId, payload.taskId, actor.id, status, createdAt, createdAt);
      this.db
        .prepare(
          'INSERT INTO revisions(contribution_id,revision,payload,content_hash,created_at) VALUES (?,1,?,?,?)',
        )
        .run(contributionId, JSON.stringify(payload), contentHash, createdAt);
      this.clearLease(payload.taskId);
      this.event(
        'contribution.proposed',
        actor.name,
        contributionId,
        status === 'held'
          ? 'Submitted work held for scope and risk review.'
          : 'Submitted cited work for independent review.',
      );
      return this.contribution(contributionId);
    });
  }
  revise(
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
    return this.transaction(() => {
      const old = this.contribution(contributionId);
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
      if (this.db.prepare('SELECT 1 FROM revisions WHERE content_hash=?').get(contentHash))
        throw new ApiError(409, 'duplicate_content', 'This exact content is already recorded.');
      const nextRevision = old.revision + 1;
      const createdAt = now();
      this.db
        .prepare(
          'INSERT INTO revisions(contribution_id,revision,payload,content_hash,created_at) VALUES (?,?,?,?,?)',
        )
        .run(contributionId, nextRevision, JSON.stringify(payload), contentHash, createdAt);
      this.db
        .prepare('UPDATE contributions SET revision=?,status=?,updated_at=? WHERE id=?')
        .run(nextRevision, payload.risk === 'low' ? 'proposed' : 'held', createdAt, contributionId);
      this.event(
        'contribution.revised',
        actor.name,
        contributionId,
        `Created immutable revision ${nextRevision}.`,
      );
      return this.contribution(contributionId);
    });
  }
  reviews(contributionId: string): Review[] {
    this.contribution(contributionId);
    return (
      this.db
        .prepare(
          'SELECT r.*,a.name AS reviewer_name FROM reviews r JOIN actors a ON a.id=r.reviewer_id WHERE contribution_id=? ORDER BY created_at,id',
        )
        .all(contributionId) as Record<string, unknown>[]
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
  review(
    contributionId: string,
    actor: Identity,
    revision: number,
    decision: Review['decision'],
    rationale: string,
  ) {
    return this.transaction(() => {
      if (actor.role !== 'curator')
        throw new ApiError(
          403,
          'curator_required',
          'Only an operator-issued curator identity can review work.',
        );
      const contribution = this.contribution(contributionId);
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
      if (decision === 'accept' && this.task(contribution.taskId).status === 'claimed')
        throw new ApiError(
          409,
          'active_work_lease',
          'Another agent is working on this task. Review after its lease is released or expires.',
        );
      const reviewId = id('review');
      const createdAt = now();
      this.db
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
      this.db
        .prepare('UPDATE contributions SET status=?,updated_at=? WHERE id=?')
        .run(nextStatus, createdAt, contributionId);
      if (decision === 'accept')
        this.db
          .prepare(
            "UPDATE tasks SET status='completed',revision=revision+1,claimed_by=NULL,lease_hash=NULL,lease_expires_at=NULL WHERE id=?",
          )
          .run(contribution.taskId);
      this.event(
        `review.${decision}`,
        actor.name,
        contributionId,
        contribution.risk !== 'low'
          ? `Revision ${revision}: scope and risk review recorded; content restricted.`
          : `Revision ${revision}: ${rationale}`,
      );
      return {
        contribution: this.contribution(contributionId),
        reviews: this.reviews(contributionId),
      };
    });
  }
  history(contributionId: string) {
    this.contribution(contributionId);
    return (
      this.db
        .prepare(
          'SELECT revision,content_hash,created_at FROM revisions WHERE contribution_id=? ORDER BY revision',
        )
        .all(contributionId) as Record<string, unknown>[]
    ).map((r) => ({
      revision: Number(r.revision),
      contentHash: String(r.content_hash),
      createdAt: String(r.created_at),
    }));
  }
  events(after = 0, limit = 20): Event[] {
    return (
      this.db
        .prepare('SELECT * FROM events WHERE id>? ORDER BY id DESC LIMIT ?')
        .all(after, limit) as Record<string, unknown>[]
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
  snapshot(): Snapshot {
    const allTasks = this.tasks();
    const accepted = this.db
      .prepare("SELECT COUNT(*) AS count FROM contributions WHERE status='accepted'")
      .get() as { count: number };
    const contributors = this.db
      .prepare('SELECT COUNT(DISTINCT author_id) AS count FROM contributions')
      .get() as { count: number };
    return {
      fields,
      sources,
      tasks: allTasks,
      contributions: this.contributions(undefined, 50),
      events: this.events(),
      stats: {
        sources: sources.length,
        openTasks: allTasks.filter((t) => t.status === 'open').length,
        accepted: Number(accepted.count),
        contributors: Number(contributors.count),
      },
    };
  }
}
