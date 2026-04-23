# Generated Canvas client — prototype findings

This document summarizes the scoped prototype built for
[GitHub issue #78](https://github.com/bruchris/canvas-lms-mcp/issues/78)
(`feat: auto-generate the Canvas REST client from an OpenAPI spec`).

The prototype is intentionally narrow — one domain (`users`), one
generator (`openapi-typescript` + `openapi-fetch`), one overlay pattern —
so the real costs and constraints surface before any repo-wide migration
and before the licensing decision is made.

## What shipped

| Piece                               | Path                                            |
| ----------------------------------- | ----------------------------------------------- |
| Hand-authored source spec           | `spec/canvas/prototype.yaml`                    |
| Overlay demo                        | `spec/canvas/overrides/users.yaml`              |
| Generation pipeline                 | `scripts/canvas-spec/generate.ts`               |
| Generated types (checked in)        | `src/canvas/generated/types.ts`                 |
| Generated-client users module       | `src/canvas/generated/users-client.ts`          |
| Feature flag                        | `useGeneratedClient` on `CanvasClientConfig`    |
| Shared interface                    | `UsersModuleApi` in `src/canvas/users.ts`       |
| Parity tests                        | `tests/canvas/generated-users.test.ts`          |
| Facade swap tests                   | new cases in `tests/canvas/facade.test.ts`      |

All existing tests (604) still pass; both the hand-written `UsersModule`
and the new `GeneratedUsersModule` are exercised.

## Pipeline at a glance

```
spec/canvas/prototype.yaml       (hand-authored OpenAPI 3.1 — license-clean)
        +
spec/canvas/overrides/*.yaml     (overlay patches: enums, response shapes)
        │
        ▼
scripts/canvas-spec/generate.ts  (deep-merge + openapi-typescript + prettier)
        │
        ▼
src/canvas/generated/types.ts    (types only; no runtime)
        │
        ▼
src/canvas/generated/users-client.ts
        │ openapi-fetch for single requests
        │ manual Link-header loop for pagination
        │ Bearer + User-Agent via openapi-fetch middleware
        ▼
CanvasClient.users  ── feature flag selects hand-written or generated
```

Run end-to-end with `pnpm canvas:spec:generate`.

## What the prototype proves works

1. **`openapi-typescript` + `openapi-fetch` are a good match for this
   server.** Zero runtime deps (openapi-fetch ships 6 kB of wrapper over
   `fetch`), native `fetch`, first-class middleware for header injection,
   and strong discriminated-union typing on `oneOf` (we use it on
   `UpcomingEvent.id`, which is `integer | string`, and it survives
   through to `types.ts` correctly).
2. **Overlays do what issue #78 promised.** The overlay in
   `overrides/users.yaml` adds `primary_email` to the `User` schema and
   extends the account-users `include[]` enum with `uuid`. Both land
   in `src/canvas/generated/types.ts` after regeneration. This is the
   pattern that will paper over Canvas's known response-type bug
   ([instructure/canvas-lms#2583](https://github.com/instructure/canvas-lms/issues/2583))
   when the full spec source is wired in.
3. **The feature-flag swap is seamless for tool code.** `CanvasClient.users`
   is typed as `UsersModuleApi` (a shared interface). All 104 MCP tools
   and every tool-layer test keep working unchanged. The flag is a
   single config field (`useGeneratedClient`) that accepts `true`,
   `false`, or a domain allowlist like `['users']`.
4. **Parity is test-verifiable.** `tests/canvas/generated-users.test.ts`
   mocks `globalThis.fetch` and asserts the wire-level behavior that
   matters — Bearer header, `include[]` repeated-key serialization,
   Link-header pagination, `maxPaginationPages` cap, empty-array
   pruning, and `CanvasApiError` mapping. The hand-written module's
   existing tests remain unchanged and still pass.

## Real costs the prototype surfaced

### 1. OpenAPI can't express Canvas's pagination contract

Link-header pagination with `rel="next"` isn't in the spec and won't be.
Bookmark-cursor pagination for some endpoints is an additional twist.
Both stay hand-written — which means there's a persistent ~40-line
helper per client (one in `CanvasHttpClient`, one in
`GeneratedUsersModule`). **For a full migration, this belongs in a
shared `paginateViaLinkHeader(fetch, url, headers, max)` utility that
both worlds call into.** The prototype intentionally duplicates it to
keep the diff surface minimal.

### 2. Two separate type worlds

`components.schemas.User` from the generated spec is a different TS
type from `CanvasUser` in `src/canvas/types.ts`. Today the public
surface of `GeneratedUsersModule` returns the hand-written types, with
a `data as CanvasUser` cast at the boundary. Structurally they match,
so the cast is safe — but this is the exact point at which **the full
migration has to choose**: delete `src/canvas/types.ts` and consume
generated types everywhere, OR keep a thin hand-written layer that
converts. Each has costs:
- **Going fully generated** means every response-trimming tool
  (`students` normalization in `src/tools/users.ts`, etc.) has to be
  re-verified against the generated types.
- **Keeping hand-written types at the boundary** perpetuates the
  problem the migration is trying to solve.

### 3. openapi-fetch's path-template API doesn't fit Link-header URLs

The `next` URL returned by Canvas is an absolute URL with the full
query string embedded. openapi-fetch wants `(pathTemplate, { params })`.
The prototype sidesteps this by using raw `fetch` for subsequent pages
and reserving openapi-fetch for the first, typed page. The net effect
is that **we only get openapi-fetch's type-checking on the first call
of any paginated endpoint**. This is acceptable but worth calling out —
the typing benefit is less dense than the marketing suggests.

### 4. Generated file churn

`openapi-typescript` emits a stable format when fed a stable input, but
line-length and quote-style decisions can drift between releases. The
prototype runs prettier over the output inside the generation script so
the checked-in file is always lint-clean. If `openapi-typescript` is
upgraded and changes its emit style, the diff will still be noisy. For
a full migration, pin the version and treat `types.ts` diffs as
review-worthy rather than "generated, ignore."

## Generator size

- `openapi-fetch`: runtime dep, **6 kB min** — added to `dependencies`.
- `openapi-typescript`: dev-only, CLI-style, used by the generation script.
- `yaml`: dev-only, used for parsing spec + overlays.

Bundled `dist/` size with the feature flag off is unchanged
(both modules are dead-code-eliminated when `users` uses the
hand-written module). When the flag is on, `openapi-fetch` contributes
about 6 kB minified to the bundle. The generated types file adds
nothing to runtime (pure types).

## What is NOT in the prototype

- **No Canvas-sourced spec.** Canvas LMS is AGPL-3.0; its
  `rake doc:openapi` output is AGPL-derived (see issue #78,
  "License — this needs a decision, not a default"). Using that output
  as the spec source is blocked on the licensing decision. The prototype
  therefore hand-authors the source spec from public Canvas API
  documentation, which is license-clean and has the side benefit of
  removing any "needs a Canvas checkout with a DB" dependency from the
  prototype CI path.
- **No Redocly `bundle` step.** At one domain, a 60-line deep-merge in
  the generation script is simpler than `@redocly/cli`. When multiple
  domains land, switching to Redocly is a one-file change.
- **No GraphQL.** Issue #78 floated a complementary GraphQL layer; that
  is out of scope for this prototype.
- **No other domains.** Only `users`. The migration strategy in issue #78
  explicitly called for this.

## Recommendation for the next step

The pipeline works. The real decision is still upstream:

1. **Licensing.** Pick a path from issue #78 ("License — this needs a
   decision, not a default"). The prototype doesn't force that decision
   because its source spec is hand-authored, but every additional
   domain beyond `users` that uses the Canvas-emitted spec will. Don't
   fan out until this is decided.
2. **Pagination helper extraction.** Before adding a second domain,
   extract `paginateViaLinkHeader` into a shared utility. Right now
   there's one copy in `CanvasHttpClient` and one in
   `GeneratedUsersModule`. Two is tolerable; three is a bug.
3. **Type-world decision.** Before adding a second domain, decide
   whether to keep `src/canvas/types.ts` or delete it in favor of
   generated types. The answer affects the shape of every subsequent
   generated module.

Only after (1), (2), and (3) is the fan-out to additional domains a
mechanical task.

## How to try it locally

```sh
pnpm install
pnpm canvas:spec:generate   # regenerate types
pnpm test                   # full suite including parity tests
```

To use the generated client from application code:

```ts
import { CanvasClient } from 'canvas-lms-mcp/canvas'

const client = new CanvasClient({
  token: process.env.CANVAS_API_TOKEN!,
  baseUrl: process.env.CANVAS_BASE_URL!,
  useGeneratedClient: ['users'],   // opt in, one domain at a time
})

const students = await client.users.listStudents(1234)
```
