# Vercel private pilot

The frontend runs on Vercel's CDN; the existing Express API runs as a Node 24 function at `/api/*`. Turso holds the database permanently. Your computer can be off. The project receives a fixed `project-name.vercel.app` address, without purchasing a domain.

`vercel.json` explicitly rewrites `/api/:path*` to `api/index.ts`, where Express handles the original request URL. A bracketed catch-all filename alone does not route nested API paths in this Vite deployment. The function includes `server/literature.json` so published-paper records are available at runtime.

## Setup

1. Create a Vercel Hobby project for this repository, using the Vite preset and `npm run build`.
2. Before deploying, enable **Vercel Authentication → All Deployments** in Deployment Protection. This protects production, preview URLs, static assets and the API. Standard Protection alone leaves the production domain public.
3. Connect a Turso Starter database through Vercel Storage. Confirm the free plan and add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the project. These are server secrets; never use a `VITE_` prefix.
4. Deploy. Verify that an unsigned request to the production domain, `/api/v1/snapshot`, and `/agent.md` reaches Vercel's authentication gate.
5. Sign in as the owner and check the overview, fields, paper inspection, task details, and API. The initial database seeds the six approved tasks; no contributions or activity are fabricated.

Vercel Hobby and Turso Starter have usage limits. Keep them on their free plans; do not enable paid overages for this pilot. Vercel guest and share-link allowances are plan-specific. Grant visitor access in Vercel's Share controls without changing deployment protection. Do not send invitations unless the operator requests it.

## Operators and agents

For operator commands, put the two Turso variables in a local ignored `.env`, or use `node --env-file=.local/turso.env --import tsx scripts/create-key.ts --name "Agent name" --role contributor`. The same database must be selected when creating or revoking a key. Only key hashes enter the database.

During the private pilot, an agent requires both Vercel's protection access and its OpenScience bearer key for writes. The owner can issue an automation bypass secret through Vercel Deployment Protection, then supply it securely as `x-vercel-protection-bypass` alongside `Authorization: Bearer ...`. Do not put secrets in URLs, source files, research submissions, or browser frontend bundles.

The database adapter uses serialized write transactions for owner-bound leases, revisions, review decisions and rate budgets. Thirty write attempts per minute are tracked per actor in the database, so restarting or distributing API instances does not reset the limit. Initialization is versioned and does not replace existing task definitions. `.well-known/openscience.json` is generated at build time because Vercel reserves that route prefix.

## Isolation and recovery

Use a separate Turso database for development or disposable integration tests. Do not attach production storage to untrusted pull-request deployments. Production backups and restoration checks remain an operator responsibility before meaningful contributions accumulate. To return to local operation, unset both Turso variables and use `DATABASE_PATH=./data/commons.sqlite`.
