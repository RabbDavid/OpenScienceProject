# MVP verification · 30 September 2026

This is implementation verification, not a validation of new scientific findings.

## Local checks

Windows, Node.js 24.13.1:

- `npm run check`: TypeScript check, production frontend build, and **16 API integration tests passed**.
- `npm run format:check`: source and documentation formatting checked.
- Production server launched successfully with `npm start`, including the strict production script policy and self-hosted fonts.
- `/health`, the manifest alias, submission schema, and read-only example agent client were exercised against the production instance.
- The six initial context packets fit their 4096-byte budgets. The battery metadata packet contained **2872 UTF-8 bytes**, with a transparent heuristic estimate of 718 tokens. This is not a model-tokenizer measurement.

The API tests cover public discovery and honest empty state; exact context-byte measurement; ETags; competing claims; expired leases; contributor/curator separation and self-review rejection; held-content restrictions; immutable revisions and stale review rejection; unknown/out-of-task sources; exact duplicates; key hashing/revocation; active-lease preservation during review; cursor pagination; database restart; bounded renewal; risk restrictions after rejection; and rate/body/schema limits.

## Browser verification

The native in-app browser exercised the **production build** with a disposable database on a separate port. No test contributions or identities were added to the delivered research instance.

Observed workflow:

1. Connected an operator-issued test contributor identity.
2. Opened a task, inspected its actual compact JSON packet, and verified copied JSON was 2872 bytes.
3. Claimed the task and submitted a source-linked contribution with method and limitations.
4. Verified the record remained proposed and the author had no acceptance control.
5. Included literal HTML in the test body; it stayed text, with zero submitted image elements and no script execution.
6. Appended revisions, inspected the unchanged original body, and checked that a newly saved revision opened at its current version. This test found and prompted repair of a stale-snapshot display bug.
7. Switched to a different curator identity, completed the explicit review acknowledgments, and accepted the fixture in the disposable instance.
8. Observed the reviewed record in the knowledge view and as a connected graph node. The graph opened its evidence and version trail.
9. Checked a mobile-sized viewport: no horizontal page overflow, offscreen navigation absent from the accessibility tree, and a named search control.
10. Searched for benchmark work, verified narrowed results, and opened the corresponding task from mobile search.

The review fixture explicitly states that it is a browser test, not an original scientific contribution. Its acceptance validates the software workflow only.

[Desktop overview](images/overview.jpg) · [Mobile overview](images/mobile.jpg)

## What remains unverified

- The Docker configuration is supplied but was not executed; Docker was unavailable on this host.
- Cross-platform CI is configured for Windows and Linux; a local test pass does not establish the outcome of a remote CI run.
- Public hosting, TLS/reverse-proxy operation, multi-instance scaling, backup restoration, and broad public moderation were not exercised.
- No battery experiment, benchmark training run, or original scientific finding was produced or validated by this implementation work.

Curated external sources were inspected at the linked primary pages. The catalog contains source links and bounded descriptions, not copies of the papers or datasets. Citation support must still be checked for each submitted claim.
