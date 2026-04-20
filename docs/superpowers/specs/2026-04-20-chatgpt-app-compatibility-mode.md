# ChatGPT App Compatibility Mode for Canvas MCP

**Date**: 2026-04-20  
**Issue**: `BRU-467`  
**Status**: Proposed design, not yet implemented

## Goal

Add a ChatGPT-compatible remote MCP profile for `canvas-lms-mcp` without degrading the existing local-agent and general MCP ergonomics.

This design targets two distinct OpenAI usage modes that now matter:

1. **ChatGPT search/deep research/company knowledge** style integrations, where OpenAI's current MCP guidance expects read-only `search` and `fetch` tools with a specific result shape.
2. **ChatGPT Developer Mode**, which supports full MCP connectors and does **not** require `search`/`fetch`, but does raise higher write-action risk.

## External Constraints

The current OpenAI guidance materially changes the design:

- OpenAI's MCP docs now say that ChatGPT deep research and company knowledge integrations should expose two read-only tools, `search` and `fetch`, using the compatibility schema.
- OpenAI's ChatGPT Developer Mode docs say full MCP connectors can expose arbitrary tools, including writes, and do not require `search`/`fetch`.
- OpenAI's ChatGPT apps docs say write actions are possible, but user confirmation and workspace-level action controls apply.
- OpenAI's MCP docs recommend OAuth, including dynamic client registration when appropriate, for custom remote MCP servers connected in ChatGPT.

Primary sources:

- https://developers.openai.com/api/docs/mcp
- https://developers.openai.com/api/docs/guides/developer-mode
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt

## Current Repo State

The repo already has the foundation needed for a compatibility layer:

- `src/http.ts` exposes a remote MCP endpoint over streaming HTTP.
- `src/server.ts` builds an `McpServer` from a `CanvasClient`.
- `src/tools/` already exposes the full 88-tool Canvas surface.
- `src/resources/` already exposes syllabus and assignment-description resources.
- `src/canvas/` is intentionally a pure Canvas REST client with no MCP- or product-specific behavior.

The missing pieces are:

- no generic `search` tool
- no generic `fetch` tool with the OpenAI compatibility result shape
- no ChatGPT-oriented auth strategy
- no compatibility profile that narrows the exposed tool surface for search/deep research usage

## Recommendation

### Decision

Ship this as a **thin compatibility adapter inside this repo**, not as a separate package and not as a forked server.

### Why

This feature is cross-cutting, but it is still fundamentally an alternative presentation of the same Canvas data and the same HTTP transport:

- It reuses the existing `CanvasClient`.
- It reuses the current remote MCP transport entry point.
- It should share the same release cadence and npm package.
- Splitting into a separate package would duplicate transport, auth integration points, and search/fetch content mapping logic.

At the same time, it should **not** be implemented directly in `src/canvas/`, because `search`/`fetch` compatibility is not a first-class Canvas REST API domain. It is a product-specific aggregation layer.

### Architectural shape

Add a new compatibility layer between the existing Canvas client and MCP registration:

```text
src/canvas/                 Pure Canvas REST modules
src/compatibility/chatgpt/  ChatGPT-specific content indexing, search/fetch adapters
src/tools/                  Existing full Canvas MCP tools
src/server.ts               Server factory that can register either standard tools or compatibility profile
src/http.ts                 Transport and auth policy selection
```

This keeps the current three-layer architecture intact while adding one product-specific composition layer.

## Proposed Profiles

Expose explicit server profiles instead of overloading one ambiguous mode.

### 1. `standard`

Existing behavior.

- Full current MCP server
- Existing tool names and resources
- Suitable for Codex, Claude Desktop, Cursor, VS Code, and general remote MCP consumers

### 2. `chatgpt_compat`

New compatibility profile for ChatGPT search/deep research/company knowledge style usage.

- Exposes `search`
- Exposes `fetch`
- Exposes `health_check`
- Defaults to read-only behavior
- Hides the 88 existing domain tools by default

### 3. `chatgpt_developer`

Optional follow-up profile, not required for the first compatibility milestone.

- Exposes the existing full tool registry
- Uses ChatGPT-appropriate auth metadata
- Can coexist with `chatgpt_compat`, but should remain an explicitly higher-risk mode

## Search and Fetch Mapping

## Content model

Do **not** map `search` directly to raw tools like `list_pages` or `search_course_content`. That would produce weak relevance, poor citations, and unstable fetch behavior.

Instead, introduce a normalized compatibility document shape:

```ts
interface CanvasSearchDocument {
  id: string
  kind:
    | 'course'
    | 'syllabus'
    | 'page'
    | 'assignment'
    | 'module'
    | 'module_item'
    | 'discussion'
    | 'announcement'
    | 'file'
  title: string
  url: string
  text: string
  metadata?: Record<string, string | number | boolean | null>
}
```

The important design point is that `id` is a **compatibility document id**, not a raw Canvas id. Example:

- `course:42:syllabus`
- `course:42:page:intro-to-algebra`
- `course:42:assignment:301`
- `course:42:discussion:88`
- `course:42:file:551`

That gives `fetch` a stable target and avoids ambiguity across content types.

## Search scope

`search` should aggregate across the highest-value read surfaces first:

### Phase 1 corpus

- course syllabus
- course pages
- assignments
- modules and module items
- discussions and announcements
- files metadata and text when Canvas exposes previewable text/html content

### Phase 2 corpus

- quiz descriptions
- rubric descriptions
- calendar events
- inbox conversations only if explicitly enabled for the deployment

### Why this split

Phase 1 covers the main "company knowledge" style queries users are likely to ask about course content. Conversations and other personal data raise a bigger privacy and relevance burden and should not be part of the first release by default.

## Search behavior

The compatibility layer should not depend on one Canvas endpoint for search quality. Recommended order:

1. Prefer domain-native search when Canvas provides one with acceptable coverage.
2. Otherwise enumerate the relevant course entities and rank locally.
3. Return a small, high-confidence result set with stable citation URLs.

The local ranker can stay intentionally simple for v1:

- normalized term overlap on title and body text
- boosts for exact title hits
- boosts for syllabus, pages, and assignments over lower-signal records
- course-level scoping when the query clearly names a course

This does not need vector search for the first iteration.

## Fetch behavior

`fetch` resolves a compatibility document id to one canonical document and returns:

- `id`
- `title`
- `text`
- `url`
- `metadata`

The returned `url` should point to the corresponding Canvas page, assignment, discussion, file, or course page so citations remain meaningful.

## Why not reuse MCP resources as the compatibility contract

The current resources are useful, but insufficient as the primary contract:

- OpenAI compatibility is tool-based around `search` and `fetch`
- resources do not give us ranking behavior
- resources do not solve canonical cross-entity ids
- resources alone do not define the JSON-encoded result format OpenAI expects

Resources can still be reused internally as implementation helpers, but they should not be the public compatibility abstraction.

## Auth Recommendation

## Current auth is not sufficient for ChatGPT apps

The current remote transport model is:

- server base URL configured at startup
- Canvas token supplied per request via `X-Canvas-Token`

That is workable for self-hosted developer usage, but it is **not a viable primary model** for ChatGPT apps:

- ChatGPT app connections should use OAuth to the application
- ChatGPT users should not manually type Canvas tokens into connector requests
- multi-institution Canvas deployments need a controlled way to determine or select the Canvas base URL
- allowing arbitrary per-request base URLs in ChatGPT-facing mode would create SSRF and tenancy-control problems

## Recommended auth design

For `chatgpt_compat`, require an application-layer OAuth broker.

### Broker responsibilities

- authenticate the ChatGPT user to our app
- associate that user with a Canvas access token or delegated credential
- store the user's allowed Canvas base URL or institution binding
- provide the MCP server with resolved Canvas credentials server-side

### Base URL policy

For the first ChatGPT-compatible release, support only these deployment shapes:

1. **Single-institution deployment**
   - one Canvas base URL configured server-side
   - simplest and safest

2. **Approved multi-institution deployment**
   - Canvas base URL selected from an allowlist controlled by the app operator
   - chosen during OAuth/account linking, not per tool call

Do **not** accept arbitrary runtime base URL input from ChatGPT for compatibility mode.

### Mixed auth

If we later support ChatGPT Developer Mode directly from the same package, mixed auth is reasonable:

- unauthenticated initialize/tool discovery
- OAuth for protected tool calls

But that should be treated as a follow-up capability, not the first compatibility milestone.

## Write-Action Posture

## Recommendation

`chatgpt_compat` should be **read-only in v1**.

### Why

- The OpenAI compatibility requirement that motivated this issue is specifically about `search` and `fetch`.
- Read-only mode aligns with deep research and company knowledge usage.
- It reduces prompt-injection exposure.
- It avoids forcing premature decisions about destructive tool allowlists and workspace constraints.

This does **not** mean the repo should never support writes in ChatGPT contexts. It means the first shipped compatibility profile should not.

## Follow-up posture for `chatgpt_developer`

If a later profile exposes writes, it should:

- remain opt-in
- use the existing tool annotations as a baseline, but not as the only control
- support explicit per-tool allowlists
- support deployment-time parameter constraints for risky actions
- default destructive writes off

The most defensible first write candidates would be low-blast-radius actions such as:

- `send_conversation`
- `post_discussion_entry`
- maybe `comment_on_submission`

The least defensible early write candidates are grading and enrollment changes.

## Implementation Boundary Recommendation

## New code areas

Recommended eventual file additions:

```text
src/compatibility/chatgpt/types.ts
src/compatibility/chatgpt/content-id.ts
src/compatibility/chatgpt/url.ts
src/compatibility/chatgpt/catalog.ts
src/compatibility/chatgpt/search.ts
src/compatibility/chatgpt/fetch.ts
src/compatibility/chatgpt/tools.ts
src/auth/chatgpt.ts
tests/compatibility/chatgpt/search.test.ts
tests/compatibility/chatgpt/fetch.test.ts
tests/http.chatgpt.test.ts
```

Recommended existing files to change:

```text
src/server.ts
src/http.ts
src/cli.ts
src/tools/index.ts
src/resources/index.ts
README.md
docs/integration-guide.md
```

## Specific boundaries

- `src/canvas/` should remain pure Canvas REST access.
- `src/compatibility/chatgpt/` should compose across existing Canvas modules.
- `src/server.ts` should accept a profile/config option and register the relevant tool set.
- `src/http.ts` should choose auth policy and profile exposure.
- `src/cli.ts` should expose flags for profile selection and allowed-origin/auth mode.

## Recommended Server Factory Changes

Extend server creation config so profile selection is explicit:

```ts
interface CanvasMCPServerConfig {
  token?: string
  baseUrl?: string
  profile?: 'standard' | 'chatgpt_compat' | 'chatgpt_developer'
  authMode?: 'static_canvas_token' | 'oauth_broker'
}
```

Then:

- `standard` registers current tools and current resources
- `chatgpt_compat` registers compatibility tools and optionally a reduced resource set
- `chatgpt_developer` registers the full tool set but with ChatGPT-facing auth expectations

## Validation Matrix

Minimum validation should cover both protocol correctness and product behavior.

### Unit tests

- `search` returns exactly one text content item containing JSON with `{ results: [...] }`
- each result contains `id`, `title`, and canonical `url`
- `fetch` returns exactly one text content item containing JSON with `id`, `title`, `text`, `url`, and optional `metadata`
- content ids round-trip between `search` and `fetch`
- unsupported ids return a deterministic error
- profile selection registers the expected tools only

### Transport tests

- `chatgpt_compat` profile only exposes `search`, `fetch`, and allowed health/read helpers
- compatibility mode rejects per-request base URL override
- OAuth-backed mode does not require client-supplied Canvas token headers
- CORS and MCP protocol behavior still pass

### Manual ChatGPT app tests

- connect app in ChatGPT workspace settings
- verify tool discovery succeeds
- verify `search` results appear in normal chat
- verify deep research can cite fetched Canvas content
- verify company knowledge compatibility check passes

### Manual Developer Mode tests

- connect the same server in Developer Mode
- verify full-tool profile lists the expected Canvas tools
- verify write tools are either absent or explicitly constrained, depending on profile

### API deep research tests

- use the Responses/deep-research MCP path with `allowed_tools: ["search", "fetch"]`
- verify no-approval configuration works for read-only research calls

## Rollout Plan

### Phase 0: Design only

- land this spec
- do not block current v1.0 work

### Phase 1: Minimal ChatGPT compatibility

- add `chatgpt_compat` profile
- add `search` and `fetch`
- support single-institution deployments first
- keep mode read-only

### Phase 2: Auth hardening

- add OAuth broker integration
- support institution allowlists and account linking

### Phase 3: Optional Developer Mode profile

- expose full Canvas tools behind an explicit `chatgpt_developer` profile
- add tool allowlists and parameter constraints

## Block v1.0 or Follow It

## Recommendation

This should **follow v1.0**, not block it.

### Reasoning

- The current v1.0 goal is a general-purpose Canvas MCP server shipped to npm.
- The repo already supports remote MCP over HTTP, which is enough for the stated v1.0 scope.
- ChatGPT compatibility introduces a new product surface with non-trivial auth and trust decisions.
- The `search`/`fetch` requirement is additive and can be layered on after the main package is stable.

The only v1.0 implication worth applying immediately is this:

- keep the existing HTTP transport profileable
- avoid hard-coding assumptions that make a reduced compatibility tool surface impossible later

## Tradeoffs Considered

## Separate package

Rejected for now.

Pros:

- cleaner marketing boundary
- independent release train

Cons:

- duplicates transport and auth plumbing
- duplicates content normalization logic
- splits a small project too early

## Separate server binary only

Not preferred as the primary abstraction.

Pros:

- easy operational story

Cons:

- hides the real architectural boundary
- still needs shared in-repo compatibility code
- encourages drift if the binary becomes the feature boundary

## Thin in-repo adapter

Chosen.

Pros:

- reuses current code cleanly
- keeps one package and one codebase
- preserves the pure Canvas client layer
- allows multiple server profiles without branching the repo

Cons:

- adds one more composition layer to the package
- requires discipline to keep ChatGPT-specific logic out of `src/canvas/`

## Final Recommendation

Implement ChatGPT compatibility as an **in-repo compatibility profile** with a dedicated `search`/`fetch` adapter layer, backed by OAuth-brokered server-side Canvas credentials, and ship it **after** the current v1.0 package release.

That gives the project the right long-term shape:

- existing local-agent ergonomics stay intact
- deep research and company knowledge compatibility get the required tool contract
- Developer Mode can be supported later without contaminating the core Canvas client layer
