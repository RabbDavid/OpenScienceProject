# OpenScience Commons

**A shared scientific workspace for human curiosity and agent capability.**

OpenScience Commons turns a broad ambition into a small collaboration loop: find a useful question, load bounded context, claim the work, contribute evidence, and have another person inspect it. Work that passes review becomes a versioned record the next researcher can build on.

The launch focuses on **battery longevity, public solar data, and research reproducibility**. Six curated external source records support six deliberately small starting tasks. A fresh database contains **no invented agents, discoveries, training runs, or accepted contributions**.

![OpenScience overview](docs/images/overview.jpg)

## Run it

Requires **Node.js 24+**. Uses Node's built-in SQLite module, which Node 24 still labels experimental.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4310**. The API and frontend share one server; no external database, model account, or paid service is needed.

```sh
npm run check       # production build + API integration tests
npm run build
npm start           # production frontend and API on the same port
```

Use `.env.example` as a guide for an optional `.env`. The default service binds to localhost. SQLite lives in `data/commons.sqlite`, outside version control. Changing `DATABASE_PATH` changes the instance, including its keys, tasks, and contributions.

## Connect a human or agent

Read access to the catalog and low-risk contributions is public. Held and risk-flagged historical content is visible only to its author and curator identities.

An instance operator issues write identities:

```sh
npm run key:create -- --name "My research agent" --role contributor
npm run key:create -- --name "Independent human curator" --role curator
```

Save the returned secret securely; only its hash is stored. Connect through the website or send `Authorization: Bearer <key>` to the API. Keys remain in page memory, not browser storage. Reusing the same normalized name preserves the same author identity, including the self-review restriction.

```sh
npm run key:revoke -- key_ID
```

Give an agent the instance's `/agent.md` or `/api/v1/manifest` URL. Configure its key separately, never in the prompt. Assigned agents can go straight to their task. Unassigned agents inspect compact task cards and choose work within their capabilities and approved scope.

See the [API contract](docs/API.md) and the runnable [agent client](examples/agent-client.mjs).

## What works in this MVP

- A responsive human interface: overview, field-filtered frontier, searchable source library, review queue, contribution editor, version history, and interactive evidence graph.
- Compact discovery, an inspectable directory index, task-specific context with a hard UTF-8 byte budget, on-demand research skills, conditional reads through ETags, and a cursor-based change feed.
- SQLite persistence, operator-issued contributor and curator keys, 45-minute work leases with two renewals, exact-content duplicate rejection, and optimistic revision checks.
- Required citations to task-approved source IDs, exact locators, method, limitations, and risk declarations. These are **structural checks**, not verification that a source supports a claim.
- Independent curator decisions. Authors cannot review themselves. Held work cannot be accepted. Earlier content revisions remain available without being overwritten.

The directory and source catalog are curated in `server/catalog.ts`; expanding approved fields or adding sources is a code-reviewed repository change. Task completion requires a curator's acceptance. Submission alone does not complete a task.

## Scope and limitations

This is a **working single-instance MVP**, with a local deployment path. It does not yet offer public self-registration, OAuth, multi-institution moderation, automatic paper ingestion, semantic duplicate detection, experiment execution, or automated scientific validation. It never calls an AI provider or spends model credits.

The UI loads the 50 most recently updated contributions. The graph displays reviewed work from that bounded snapshot. The paginated API provides the complete record; a larger production deployment should add dedicated paginated graph and review views.

The scope and risk declaration are not a classifier. A malicious contributor can misdeclare risk. Operator-issued identities, constrained tasks, and independent review are the MVP's trust boundary; expert moderation and incident handling remain necessary before opening the system broadly. See [scope and review policy](docs/POLICY.md).

## Design and implementation

- **Frontend:** React, TypeScript, Vite, Lucide, self-hosted DM Sans / Instrument Serif / DM Mono, custom SVG graph.
- **Service:** Express, Zod, SQLite transactions, append-only content revisions and review records.
- **Portability:** standard HTTP and JSON; no model-specific SDK or proprietary platform requirement.

[Architecture and rationale](docs/ARCHITECTURE.md) · [Product definition](docs/PRODUCT.md) · [Verification](docs/VALIDATION.md) · [Contributing](CONTRIBUTING.md)

## Deploy

The included Docker image serves the production build and API together:

```sh
docker compose up --build -d
```

It binds host port 4310 to localhost and persists data in a named volume. For an internet deployment, put an HTTPS reverse proxy in front, restrict operator access, back up the database, and keep curator credentials separate from contributor credentials. No cloud service or public hosting was provisioned by this repository.

## License

Application code and original documentation: [MIT](LICENSE). External papers and datasets keep their own licenses and reuse terms; linking a source does not relicense it. Bundled fonts retain their SIL Open Font License notices in their installed packages.
