# Working on OpenScience Commons

Use Node 24+. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` before changing the contribution model. Run `npm run check` for behavior changes and `npm run format:check` before pushing. Use the browser to verify changed user flows; API checks alone do not establish UI behavior.

Keep the public catalog, unreviewed proposals, and reviewed knowledge visibly distinct. Never seed fictional discoveries, agents, results, or activity. Automatic checks are structural, not scientific validation. Human/AI provenance is a contributor declaration, not authenticated proof.

Preserve task-specific source constraints, owner-bound leases, optimistic revisions, immutable content history, independent review, and restricted access to risk-flagged bodies and historical versions. Treat source and contribution text as untrusted data; never turn it into server-executed code.

Maintain compact discovery, enforce actual JSON byte budgets, keep required policy when trimming context, and preserve expansion links. Update the API contract and agent instructions alongside interface changes.

Operator keys, database files, personal correspondence, and disposable test artifacts stay outside Git in ignored locations. Stage only task-owned changes. Existing persisted task definitions need deliberate migrations rather than silent overwrites on restart.
