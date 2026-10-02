# OpenScience plugin

Public MCP endpoint: **https://openscienceplatform.vercel.app/api/mcp**. This is a stateless Streamable HTTP server. It connects an agent to existing research records without running a model on the server or using an OpenAI API key.

## Connect in ChatGPT

1. Enable developer mode in ChatGPT on the web: **Settings → Security and login → Developer mode**. Availability depends on the account and workspace's policy.
2. Open ChatGPT Plugins, use the create/add control, and name the connection **OpenScience**.
3. Enter `https://openscienceplatform.vercel.app/api/mcp` and choose **No Authentication** for this public read-only deployment.
4. Select OpenScience in a new chat and try: “Use OpenScience to find an open mechanistic interpretability question. Load its context at 4096 bytes and inspect its approved sources. Report what you actually inspected and what remains unverified. Do not submit anything.”

The server's protocol tests establish MCP compatibility, not that a particular ChatGPT account has installed the connection. Actual account connection and a tool call in ChatGPT are separate checks. This is a custom integration, not a claim of approval or publication in OpenAI's directory. See the [current OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [developer-mode guide](https://developers.openai.com/api/docs/guides/developer-mode).

## Tools

| Tool                    | Purpose                                                           | Bounds                                                          |
| ----------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `get_research_overview` | Fields and required policy                                        | No arguments; no corpus dump                                    |
| `list_questions`        | Compact question cards                                            | Optional field, status and query; limit 1–20, offset 0–100000   |
| `get_question_context`  | Existing task context with source constraints and expansion links | Known task ID; 1536–16000 UTF-8 bytes, default 4096             |
| `get_source`            | Curated metadata and original source locator                      | One known catalog ID; no external fetch                         |
| `search_literature`     | Background paper metadata                                         | Query ≤200 characters; optional field; limit 1–20               |
| `get_paper`             | Paper provenance, metadata and recorded references                | One known paper ID                                              |
| `search`                | Compact combined catalog results                                  | Query 1–200 characters; at most 10 results                      |
| `fetch`                 | Record returned by search                                         | Typed `task:`, `source:` or `paper:` ID, never an arbitrary URL |

Every tool declares read-only, non-destructive and idempotent behavior. No tool claims a lease, creates a contribution, reviews work, executes code or calls another integration. The original authenticated contribution API remains separate. Original-source inspection needs a separately available reading tool: returning a catalog record cannot establish that a paper was read.

The context budget measures the serialized **inner JSON packet**. Escaping and the MCP response envelope make its HTTP response larger. Report these quantities separately; neither is an actual tokenizer count. The same context builder preserves essential policy, acceptance criteria, exclusions, approved sources and expansion links. A `context_budget_too_small` tool error is a legitimate refusal with status 413 in its error data; the MCP transport can still return HTTP 200.

Tool replies carry one JSON text block, avoiding a duplicate `structuredContent` copy. Catalog metadata, public prior-work cards and accepted work keep their distinct meanings. The plugin does not expose contribution bodies or historical revisions. Context prior-work cards use the existing public-access filter, even if a curator key is supplied.

## Portable package and research skill

`npm run build` creates `/openscience-plugin.zip` with exactly:

```text
plugin.json
mcp.json
skills/research-exploration/SKILL.md
```

The root manifest uses the portable Agent Plugins format and OpenAI interface metadata. The MCP configuration names only the public endpoint. The skill covers progressive discovery, source inspection, context budgets, scope, untrusted evidence and honest reporting. Clients with portable-plugin support can import the package; import availability and installation steps depend on the client. Do not confuse this ZIP with directory approval.

The server advertises `capabilities.extensions["io.modelcontextprotocol/skills"]`, supports `skills/list` and `skills/get`, and serves the same UTF-8 skill via `resources/read`. Discovery includes a SHA-256 digest. The package and server resource share one source of truth in `server/plugin.ts`. No operator files, credentials, database contents, hooks or executable scripts enter the archive.

## Access and operational limits

The current public connection uses no authentication and exposes public research only. `PRIVATE_READS=1` guards MCP initialization, discovery, tool calls and resource reads over POST with the existing operator-issued bearer authentication. A public no-auth ChatGPT configuration cannot access a private instance; OAuth onboarding is not implemented. Do not paste operator keys into chat or URLs to bypass this boundary.

Requests retain the API's 40 KB input limit, strict query admission, per-instance budget and published Vercel API edge rule. Responses are `no-store`; supplied invalid/revoked bearer keys are rejected. Unexpected driver exceptions are sanitized. Untrusted origins are rejected; no wildcard CORS is added. This service performs no arbitrary external URL fetch and executes no submitted research text. These controls reduce abuse; they do not guarantee unlimited free traffic or immunity to distributed scraping. Keep clients below 30 API requests/minute and honor HTTP 429 / `Retry-After`.

For ordinary URL readers, `/agent.md` is served with `text/plain; charset=utf-8`, and `/agent.txt` contains identical text. A tool's DNS restriction, rejected MIME type or unavailable connector is a tool limitation, not evidence of an application failure.

## Verification

`npm run check` includes a real SDK client connecting over HTTP, all field contexts, byte measurements and refusal, paper IDs, search/fetch, skill discovery/digest and package contents. Security tests cover private POST access, revoked keys, held-body exclusion, unsupported write tools, arbitrary URL rejection, bounded inputs, origin/session/method rejection, request admission and driver-error sanitization. The deployment test also sends MCP calls through Vercel's compiled rewrite into emitted JavaScript.

`npm run probe:mcp` runs a small, anonymous read-only smoke test against production, without claims, submissions or reviews. It checks the compatibility entry documents and records inner packet size separately from transport bytes. A successful probe is not scientific validation, original-source inspection, a write pilot or proof that ChatGPT used the connection.
