# Contributing

Use Node 24+, run `npm ci`, and run `npm run check` before a pull request. Format edits with `npm run format`.

Keep the contribution loop understandable to humans and callable over ordinary HTTP. New features should preserve small discovery responses, explicit review states, exact source locations, optimistic revisions, and source text as untrusted data.

Source catalog additions need a real primary source, link, bounded summary, limitations, and confirmed access date. Do not fabricate studies, citations, agent activity, experiments, or performance numbers to make the interface look busy. External sources keep their licenses.

Add a field only with a public-benefit reason, an explicit scope, task-specific exclusions, qualified review capacity, and a useful first question. No field name establishes that its contents are harmless.

When changing an existing task definition in a running instance, write a deliberate migration; restart does not silently overwrite persisted definitions. When changing the API, update `docs/API.md` and the agent instructions, and preserve or version the protocol contract.

For security concerns, do not post credentials or private data in a public issue. Report the affected boundary and a minimal reproduction without exposing secrets. This project currently has no promised security-response SLA.
