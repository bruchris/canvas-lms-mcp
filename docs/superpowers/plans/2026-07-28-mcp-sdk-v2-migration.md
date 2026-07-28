# MCP SDK v2 + 2026-07-28 spec revision — migration design

**Status:** Design only — no implementation authorised by this document.
**Author:** Lead Developer · **Date:** 2026-07-28 · **Task:** [BRU-1922](https://paperclip.bruchris.me/BRU/issues/BRU-1922)
**Reviewer:** CTO (hand back before any implementation task is created)

---

## 0. Recommendation

**Migrate to SDK v2 — but not this sprint. Do it in three decoupled phases, and start Phase 0 now.**

| Phase                                              | When                            | Gate                                                       |
| -------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| **0 — Drop `ext-apps`, vendor the 3 symbols we use** | Now (next available slot)       | None. Pure v1 change, independently valuable.               |
| **1 — Codemod to v2 packages**                       | ~2026-09-08 (≥6 weeks of 2.0.x) | A 2.0.x patch exists; no open P0 upstream regressions.      |
| **2 — Adopt the 2026-07-28 revision**                | Demand-driven, not date-driven  | A client we actually support negotiates the 2026 era.       |

### Why not now

1. **We are not forced.** `@modelcontextprotocol/sdk` is **not deprecated** (`npm view @modelcontextprotocol/sdk@1.30.0 deprecated` → empty) and `latest` is `1.30.0`. Upstream published **v1 1.30.0 at 2026-07-27T17:54:36Z and v2 GA at 2026-07-27T23:55:41Z — six hours apart, the same day**. That is an actively maintained v1 line, not a sunset.
2. **Migrating buys zero user-visible benefit today.** v1 1.30.x and v2 2.0.0 serve the **same protocol revision** by default (2025-11-25). The upgrade guide states it plainly: *"the two sides negotiate a protocol version through the ordinary 2025-era `initialize` handshake and settle on the newest revision both packages support (currently 2025-11-25 — published v1 1.29.x and v2 ship the same supported-version list)"* (`upgrade-to-v2.md` §Migrating in stages). The 2026-07-28 revision is **opt-in** in v2, not automatic — see §5.
3. **2.0.0 is one day old.** Published 2026-07-27T23:55Z; this document is dated 2026-07-28. We ship a package that reads real teachers' Canvas gradebooks. Taking a <24h-old major of our core dependency, for zero wire-level gain, is not a trade worth making.

### Why migrate at all, then

The cost is **provably low and does not grow much if we wait** — I ran the whole migration end to end (§4, §7). And Phase 2 (the 2026-07-28 revision) is only reachable from v2. When a client we support starts negotiating the 2026 era, we want the v2 move already behind us rather than in the critical path.

### Why Phase 0 starts now

`@modelcontextprotocol/ext-apps` is **the only real blocker**, and it is **not coupled to the SDK decision**. Vendoring the three symbols we use is a ~35-line change that works identically on v1, removes the blocker permanently, and can ship this week independently of any v2 timeline. Doing it first converts Phase 1 from "blocked on a third party" into "run a codemod, fix one call site."

---

## 1. The ext-apps constraint — findings, with evidence

This is the top risk named in the task, so it is resolved first. **Every claim below was verified by running the actual packages, not by reading docs.** Reproduction commands in Appendix A.

### 1.1 There is no v2-compatible ext-apps, and none in flight

```
npm view @modelcontextprotocol/ext-apps dist-tags   →  { "latest": "1.7.5" }
```

One dist-tag. No `next`, no `beta`, no `alpha`. Latest is 1.7.5, and its peer range is explicit:

```json
"peerDependencies": { "@modelcontextprotocol/sdk": "^1.29.0", "zod": "^3.25.0 || ^4.0.0", ... }
```

`^1.29.0` matches only the **v1 monolith**. v2 does not publish `@modelcontextprotocol/sdk` at 2.x — it publishes differently-named packages — so this peer can never be satisfied by v2.

### 1.2 ext-apps hard-requires v1 on disk, forever

The `/server` bundle imports v1 deep paths at module scope and **subclasses `Protocol`**:

```js
// node_modules/@modelcontextprotocol/ext-apps/dist/src/server/index.js
import { mergeCapabilities as zQ } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { CallToolRequestSchema as OQ, ... } from "@modelcontextprotocol/sdk/types.js";
import { Protocol as i } from "@modelcontextprotocol/sdk/shared/protocol.js";
class F extends i { ... }        // ← evaluated at import time
```

It is a single bundled ESM module, so importing *any* export evaluates all of it. Removing the v1 package is a hard failure, verified:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
  imported from .../ext-apps/dist/src/server/index.js
```

**Consequence: keeping ext-apps means shipping the entire v1 monolith alongside v2 to every user, permanently** — the "each package bundles its own compiled copy of `Protocol`" hazard the release notes warn about, made unavoidable.

### 1.3 It *runs* against v2 — but does not *compile*

I built a probe replicating our exact usage against a real `@modelcontextprotocol/server@2.0.0` `McpServer`:

- **Runtime: works.** Both helpers registered successfully; `tools/list` and `resources/list` returned correct output over a live in-memory client↔server pair.
- **Typecheck: fails.** Two `TS2345` errors, one root cause:

    ```
    Type 'ServerContext' is missing the following properties from type
    'RequestHandlerExtra<ServerRequest, ServerNotification>':
      signal, requestId, sendNotification, sendRequest
    ```

    v1's handler context (`RequestHandlerExtra`) and v2's (`ServerContext`) are different types; ext-apps' `.d.ts` demands the v1 one.

Runtime works because — and this is the key structural finding — **ext-apps types its server parameter structurally, not nominally**:

```ts
export declare function registerAppTool<...>(server: Pick<McpServer, "registerTool">, ...)
export declare function registerAppResource(server: Pick<McpServer, "registerResource">, ...)
```

and both function bodies are **pure pass-through wrappers**. Transcribed from the minified bundle:

```js
function registerAppTool(server, name, config, handler) {
  let meta = config._meta, ui = meta.ui, flat = meta[RESOURCE_URI_META_KEY], out = meta
  if (ui?.resourceUri && !flat) out = { ...meta, [RESOURCE_URI_META_KEY]: ui.resourceUri }
  else if (flat && !ui?.resourceUri) out = { ...meta, ui: { ...ui, resourceUri: flat } }
  return server.registerTool(name, { ...config, _meta: out }, handler)
}
function registerAppResource(server, name, uri, config, cb) {
  return server.registerResource(name, uri, { mimeType: RESOURCE_MIME_TYPE, ...config }, cb)
}
```

No `Protocol`, no schemas, no `instanceof`, no v1 object ever crosses back into our code. v2's `McpServer` still exposes `registerTool(name, config, cb)` and `registerResource(name, uri, config, cb)`, so duck-typing succeeds.

**The "cast it and move on" option is rejected.** It would (a) keep the v1 monolith installed forever, and (b) plant `as unknown as` at the exact seam where v1/v2 context types genuinely differ — which the upgrade guide calls out directly: *"a surviving cast keeps suppressing type checking that would otherwise catch real errors."*

### 1.4 Our exposure is three symbols — and vendoring them is wire-identical

We import exactly `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`, across five files. We use **none** of the React/app/client half of ext-apps.

| Symbol                   | Verified value / behaviour                            |
| ------------------------ | ----------------------------------------------------- |
| `RESOURCE_MIME_TYPE`     | `"text/html;profile=mcp-app"`                         |
| `RESOURCE_URI_META_KEY`  | `"ui/resourceUri"`                                    |
| `registerAppTool`        | `_meta` normalisation + `server.registerTool` (above) |
| `registerAppResource`    | mime default + `server.registerResource` (above)      |

I wrote a ~35-line replacement (`src/mcp-apps.ts`), typed natively against v2, and diffed it against ext-apps on a live wire:

```
--- ext-apps@1.7.5 -> SDK v2 ---
tool _meta   : {"ui":{"resourceUri":"ui://…"},"ui/resourceUri":"ui://…"}
resource mime: text/html;profile=mcp-app
--- vendored shim -> SDK v2 ---
tool _meta   : {"ui":{"resourceUri":"ui://…"},"ui/resourceUri":"ui://…"}
resource mime: text/html;profile=mcp-app

WIRE-EQUIVALENT: true
```

Byte-identical, and it typechecks clean (`tsc` exit 0) with **zero** ext-apps and **zero** v1 SDK present.

> **Prior art:** this is the contingency the MCP Apps spike already recorded — *"If the API breaks before v1.0, we extract `registerAppTool` ourselves — it's just `server.tool()` with `_meta.ui.resourceUri` injected, ~10 LOC"* (`docs/superpowers/specs/2026-06-11-mcp-apps-spike-course-structure.md`, risk table). We are executing a documented plan, not inventing one.

**Tradeoff, stated honestly.** We stop receiving upstream ext-apps fixes for these helpers. Accepted, because: the surface is two constants and two one-line functions; `ui/resourceUri` is fixed by the MCP Apps spec (SEP-1865), not by ext-apps' whim; and we keep the option to adopt a v2-native ext-apps later by deleting the shim. **If ext-apps ships v2 support before Phase 1, re-evaluate** — but do not block Phase 1 on it.

### 1.5 Dependency weight

| Configuration                     | Packages                                       | Unpacked  |
| --------------------------------- | ---------------------------------------------- | --------- |
| Today (v1 + ext-apps)             | `sdk` 4.12 + `ext-apps` 1.30                   | 5.42 MB   |
| v2 **keeping** ext-apps           | `server`+`core`+`node`+`sdk`+`ext-apps`        | 12.81 MB  |
| v2 **with vendored shim**         | `server` 6.01 + `core` 1.25 + `node` 0.13      | 7.39 MB   |

Keeping ext-apps costs **+5.4 MB and a duplicated `Protocol`** for ~8 lines of logic.

---

## 2. Package mapping for our three entry points

Verified by resolving each symbol out of the installed v2 packages.

| File            | v1 import                                                              | v2 import                                                                  |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/server.ts` | `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`             | `McpServer` from `@modelcontextprotocol/server`                            |
| `src/stdio.ts`  | `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`| `StdioServerTransport` from `@modelcontextprotocol/server/stdio`           |
| `src/http.ts`   | `StreamableHTTPServerTransport` from `…/sdk/server/streamableHttp.js`  | `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`      |

Supporting modules: `ResourceTemplate` (in `src/resources/syllabus.ts`, `assignment-description.ts`) moves to `@modelcontextprotocol/server` and **keeps its name** — the upgrade guide notes only the *wire type* `ResourceTemplate` from `types.js` is renamed to `ResourceTemplateType`; the URI-template helper class is untouched. Confirmed: `'ResourceTemplate' in server === true`.

**`src/http.ts` decision — `@modelcontextprotocol/node`, not `@modelcontextprotocol/server`.** The guide's decision rule: *"if your handler receives a Node `IncomingMessage` / `ServerResponse`, use `@modelcontextprotocol/node`."* `createHttpHandler` is exactly that shape. The codemod picked this correctly on its own.

**New transitive dependency — checked, benign.** `@modelcontextprotocol/node@2.0.0` declares `@hono/node-server: ^1.19.9`, but our `package.json` has `pnpm.overrides["@hono/node-server"] = "^2.0.5"` (added for a hono advisory; see README §Security). The override forces the adapter off its declared major. **I tested this collision explicitly**: with `@hono/node-server@2.0.12` resolved, `@modelcontextprotocol/node` loads and `toNodeHandler()` returns a working function. Not a blocker — but it is an off-declared-range configuration, so Phase 1 must keep the override under review rather than assume it.

`@modelcontextprotocol/core` arrives as a **runtime dependency of `/server`**, not a peer — we do not declare it ourselves unless we import `*Schema` constants directly (we do not).

**Unaffected: the entire Canvas client layer.** `src/canvas/**` (40+ modules) has zero MCP imports and is untouched by every phase. The three-layer architecture is doing exactly what it was designed for.

---

## 3. The `serverInfo` / `clientInfo` wire changes — impact on us

**Impact: none on our code. Verified.**

The change is real and is as the task described. Confirmed against the packages:

- `SERVER_INFO_META_KEY` is exported from `@modelcontextprotocol/server` (**not** from `/core` — worth knowing) and its value is `"io.modelcontextprotocol/serverInfo"`.
- Per `support-2026-07-28.md` §"Server identity in result `_meta`": `DiscoverResult` has no `serverInfo` member and `RequestMetaEnvelope.clientInfo` is optional, per spec PR #3002.

Why it does not reach us:

1. **These are 2026-era semantics.** The same section: *"Every 2026-era response gets the `_meta` serverInfo stamp … 2025-era responses are untouched."* Phases 0–1 stay on the 2025 era, so the wire is unchanged.
2. **We never read either field.** `rg "McpError|ErrorCode|RequestHandlerExtra|IsomorphicHeaders|SSEServerTransport" src/ tests/` → **no matches**. We construct `new McpServer({ name, version })` and never inspect `serverInfo`/`clientInfo`.
3. **Our handlers never touch the context object.** `ToolDefinition.handler` is `(params: Record<string, unknown>) => Promise<unknown>`; the registration wrapper types the second parameter as `extra?: unknown` and **never reads it**. So the `RequestHandlerExtra` → `ServerContext` rename — the single largest source of breakage in the guide — costs us nothing. (It is precisely what breaks ext-apps' *types*, per §1.3.)

Verified end-to-end on the migrated server: `client.getServerVersion()` → `{"name":"canvas-lms-mcp","version":"1.23.0"}`. Identity survives the move intact.

**Two adjacent changes worth noting for Phase 1 test work:**

- **415 on non-JSON `Content-Type`.** v2 parses the media type instead of substring-matching: *"every POST whose media type is not `application/json` answers 415."* Our `src/http.ts` never inspects `Content-Type`, and SDK clients always send it correctly. Risk is confined to hand-rolled callers and to any test that POSTs without the header — Phase 1 should add an explicit 415 case rather than discover it in the field.
- **CJS ships alongside ESM.** Confirmed: v2 `exports` carry a `require` condition with `.cjs` files. Our `package.json` already advertises `require` entries for all four subpaths, so our dual-format build story is unaffected — arguably simplified.

---

## 4. Codemod evaluation — measured, not estimated

I ran `@modelcontextprotocol/codemod@2.0.0` against a **real copy of our `src/` + `tests/` + `package.json`** (204 TS files).

```
Changes: 24 across 19 file(s)
Warnings (1):
  src/tools/index.ts:93 - [WARNING] Could not automatically migrate .tool() call.
package.json: Removed @modelcontextprotocol/sdk; Added @modelcontextprotocol/node, @modelcontextprotocol/server
```

### What it got right

- All three entry-point transports, including the correct Node-vs-web-standard choice for `src/http.ts`.
- Every `McpServer` / `ResourceTemplate` import across `src/` and `tests/`.
- `vi.mock('@modelcontextprotocol/sdk/server/stdio.js')` → `vi.mock('@modelcontextprotocol/server/stdio')` and the `streamableHttp` mock → `@modelcontextprotocol/node`, including the mocked class name.
- `package.json` dependency swap.

### What it misses — the complete residual

Typechecking the codemod's output against real v2 packages **using our own `tsconfig.json`** yields exactly **4 errors in 3 files**:

| # | Location                                    | Error   | Cause                                     |
| - | ------------------------------------------- | ------- | ----------------------------------------- |
| 1 | `src/tools/index.ts:82`                     | TS2345  | `registerAppTool` — ext-apps (§1.3)       |
| 2 | `src/resources/ui-account-notifications.ts:9` | TS2345 | `registerAppResource` — ext-apps          |
| 3 | `src/resources/ui-course-structure.ts:9`    | TS2345  | `registerAppResource` — ext-apps          |
| 4 | `src/tools/index.ts:94`                     | TS2339  | `Property 'tool' does not exist`          |

Three of four are ext-apps — **which Phase 0 deletes in advance.** The fourth is our single `server.tool()` call.

> **We have exactly one `server.tool()` call site in the entire repository** (`src/tools/index.ts:93`), because all 148 tools funnel through one registration loop. The v2 registration-API break — normally the biggest line-count item in a migration — is a five-line change for us.

### The codemod's one dangerous behaviour

**It removed `@modelcontextprotocol/sdk` from `package.json` while leaving all five `@modelcontextprotocol/ext-apps/server` imports untouched.** It is import-driven and entirely ext-apps-blind. Taking its output as-is produces a tree that cannot resolve `@modelcontextprotocol/sdk` at runtime (§1.2).

Here we get lucky: the ext-apps type errors fail the build loudly, so this cannot ship silently. But the failure mode is only safe *because* we typecheck in CI. **Phase 0 removes the trap entirely** — after it, the codemod's `package.json` rewrite is correct as emitted.

Two smaller notes: it does not reformat (it prints the exact `prettier --write` command — ours is `pnpm lint:fix`), and it leaves the three ext-apps references in `tests/` for the same blindness reason.

---

## 5. The 2026-07-28 revision: adopt now, or run `server-legacy`?

**Neither. Adopting v2 does not adopt the new revision, and we should not opt in yet.**

This is the most commonly mis-read part of the release, so precisely:

- **v2 defaults to the 2025 era.** Client side: *"By default `Client.connect()` performs the same 2025 `initialize` handshake as v1.x, byte for byte"*; `versionNegotiation` absent = *"today's behavior, no probe."*
- **Server side it is a different entry point, not a flag.** *"A hand-constructed `Server`/`McpServer` connected directly to a `StdioServerTransport` serves only the 2025-era protocol — upgrading the SDK changes nothing about what it puts on the wire."* Serving 2026-07-28 requires `serveStdio(() => buildServer())` from `@modelcontextprotocol/server/stdio`, or `createMcpHandler(factory)` for HTTP.

So Phase 1 is genuinely wire-neutral. Phase 2 is a separate, later decision.

**We do not need `server-legacy`.** It exists as a frozen v1 copy for `SSEServerTransport` and the OAuth Authorization Server helpers. We use **neither** (`rg SSEServerTransport src/` → no matches; we have no auth server). Our stateless `StreamableHTTPServerTransport` usage (`sessionIdGenerator: undefined`, fresh transport per request) is exactly the shape the guide says *"maps directly onto the default entry."*

**Phase 2 gating — demand, not calendar.** The 2026 era removes the server→client JSON-RPC request channel and moves elicitation/sampling in-band via `inputRequired(...)`. We use none of those today, so adoption is cheap *when it matters* — but it is worth nothing until a client we support negotiates it. Claude Desktop, Cursor, VS Code and ChatGPT all speak the 2025 handshake today. **Trigger for Phase 2: the first support request or client release that negotiates 2026-07-28.** `createMcpHandler`'s default `legacy: 'stateless'` serves both eras from one factory, so Phase 2 will not require dropping 2025 clients.

---

## 6. Risks

| Risk                                                              | L | I | Mitigation                                                                                     |
| ----------------------------------------------------------------- | - | - | ---------------------------------------------------------------------------------------------- |
| ext-apps never ships v2 support                                   | H | M | Phase 0 makes us independent of it. Already the documented contingency.                        |
| We vendor the shim, then ext-apps ships v2 support                | M | L | Delete `src/mcp-apps.ts`, restore the dep. Wire-identical, so a pure swap.                     |
| 2.0.0 regressions (one day old)                                   | M | H | Phase 1 waits ≥6 weeks for a 2.0.x patch. This is the main reason for the delay.                |
| `@hono/node-server` override vs `/node`'s `^1.19.9`               | M | M | Verified working at 2.0.12. Re-verify at Phase 1; drop the override if the advisory is moot.    |
| `zod` — v2 requires `^4.2.0`, v1 allowed v3                       | L | H | We are already on `zod ^4.4.3`. Above the ≥4.2.0 `~standard.jsonSchema` threshold. No action.   |
| Silent 415 on a hand-rolled client                                | L | M | Add an explicit 415 test in Phase 1; document the header in the integration guide.              |
| Tool-count / manifest drift during the change                     | M | L | `pnpm generate:manifests` + hard-coded count assertions are already CI-gated.                   |

---

## 7. Staged implementation plan

Each phase is independently shippable, independently revertable, and ends green on `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

### Phase 0 — Remove the ext-apps dependency *(1 PR, ~half a day, do now)*

Stays on SDK v1 1.30.0 throughout. Nothing about the wire changes.

1. Add `src/mcp-apps.ts` exporting `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY`, typed against the **v1** `McpServer`.
2. Repoint the five import sites (`src/tools/index.ts`, `src/resources/ui-{account-notifications,course-structure}.ts`, and two test files).
3. Replace `vi.mock('@modelcontextprotocol/ext-apps/server')` in `tests/tools/index.test.ts` with a mock of `../mcp-apps`.
4. Add a characterisation test asserting the exact `_meta` shape both keys must carry — this is what protects wire-compatibility through Phase 1.
5. Drop `@modelcontextprotocol/ext-apps` from `package.json`.

**Acceptance:** `_meta` on both UI tools byte-identical to today; `text/html;profile=mcp-app` unchanged; full suite green.
**Rollback:** revert one PR; the dependency returns.

### Phase 1 — Codemod to v2 *(1 PR, ~1 day, gated on ≥6 weeks of 2.0.x)*

1. Pre-flight: confirm a 2.0.x patch exists; re-run the ext-apps check (§1.1) in case it went v2-native; re-verify the `@hono/node-server` override.
2. `pnpm add @modelcontextprotocol/server @modelcontextprotocol/node` **while keeping** v1 installed — the guide's safe staged order; the inverse strands imports at TS2307.
3. `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` at the package root.
4. `grep -rn '@mcp-codemod-error' .` — expect **exactly one**, at the `server.tool()` call. Replace with `server.registerTool(name, { description, inputSchema: z.object(tool.inputSchema), annotations }, handler)`.
5. Retype `src/mcp-apps.ts` against `@modelcontextprotocol/server`.
6. `pnpm remove @modelcontextprotocol/sdk` once `rg "@modelcontextprotocol/sdk" src/ tests/` is empty.
7. Grep outside `src/` for the literal v1 package name — README §Security, `docs/integration-guide.md:139`, and the spec/plan docs all name it. The guide flags exactly this: *"Repo-local tooling that encodes the literal v1 package name … is invisible to the codemod."*
8. `pnpm lint:fix`, then the full validation suite. Regenerate manifests.
9. Add the 415 test.

**Acceptance:** clean typecheck; suite green; a live in-memory `tools/list` returns 148 tools with both UI tools' `_meta` intact.
**Rollback:** revert the PR. Phase 0 is unaffected and stays.

> **Confidence note.** I executed steps 2–6 against a real copy of the repo during this design. Result: `tsc` exit 0, and a live smoke test reported **148 tools, 2 resources, 2 UI-bound tools, correct `getServerVersion()`** — on SDK v2.0.0 with zero v1 or ext-apps references. The plan above is a transcript, not a forecast.

### Phase 2 — 2026-07-28 revision *(deferred; demand-triggered)*

Only when a supported client negotiates the 2026 era. Sketch: `src/stdio.ts` moves to `serveStdio(() => buildServer())`; `src/http.ts` moves to `createMcpHandler(factory)` with the default `legacy: 'stateless'` so 2025 clients keep working; audit for `inputRequired(...)` needs (currently none). Re-design before executing — this document does not specify Phase 2 in implementable detail.

---

## 8. Open questions for the CTO

1. **Approve Phase 0 now, as its own task?** It is v1-only, low risk, and unblocks everything downstream. My recommendation: yes.
2. **Is ~2026-09-08 acceptable for Phase 1**, or does being on the current SDK line matter for the project's positioning sooner? This is a judgement call about ecosystem optics vs. bake time, and it is yours, not mine.
3. **Do we want a `docs/` note telling self-hosters the HTTP transport will require `Content-Type: application/json`** at Phase 1? Low cost, and cheaper than a bug report.

---

## Appendix A — Reproducing the evidence

Every finding above came from these steps; all are read-only against public registries.

```bash
# §1.1 — no v2-ready ext-apps
npm view @modelcontextprotocol/ext-apps dist-tags
npm view @modelcontextprotocol/ext-apps@1.7.5 peerDependencies

# §0 — v1 alive, v2 GA
npm view @modelcontextprotocol/sdk dist-tags          # latest = 1.30.0
npm view @modelcontextprotocol/sdk@1.30.0 deprecated  # empty
gh api repos/modelcontextprotocol/typescript-sdk/releases \
  --jq '.[] | "\(.tag_name) prerelease=\(.prerelease) published=\(.published_at)"' | head

# §1.2 — ext-apps needs v1 on disk
npm pack @modelcontextprotocol/ext-apps@1.7.5 && tar xzf modelcontextprotocol-ext-apps-1.7.5.tgz
grep -o "@modelcontextprotocol/sdk[^'\"]*" package/dist/src/server/index.js | sort | uniq -c
# then: install v2 + ext-apps, remove node_modules/@modelcontextprotocol/sdk, import it → ERR_MODULE_NOT_FOUND

# §1.3/§1.4 — compile fails, runtime works, shim is wire-identical
#   probe: registerAppTool/registerAppResource against @modelcontextprotocol/server@2.0.0
#   compare tools/list _meta over InMemoryTransport.createLinkedPair()

# §4 — codemod, measured
cp -r src tests package.json tsconfig.json /tmp/codemod-run && cd /tmp/codemod-run
npx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 . --dry-run
npx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 .
npx tsc --noEmit -p tsconfig.json        # → 4 errors / 3 files

# upstream sources
curl -sL https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/migration/upgrade-to-v2.md
curl -sL https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/migration/support-2026-07-28.md
```

## Appendix B — Citation index

| Claim                                                | Source                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| v2 packages all `2.0.0`, `latest`; core @ 2026-07-27T23:55Z | npm registry `dist-tags` + `time`                                |
| v2 releases are GA (`prerelease=false`)              | GitHub Releases API                                                    |
| v1 `latest` = 1.30.0, not deprecated, same-day       | npm registry                                                           |
| ext-apps peer = `@modelcontextprotocol/sdk ^1.29.0`  | `npm view @modelcontextprotocol/ext-apps@1.7.5 peerDependencies`        |
| ext-apps subclasses `Protocol`; pass-through wrappers | package tarball, `dist/src/server/index.js`                            |
| `Pick<McpServer, "registerTool">` structural typing  | package tarball, `dist/src/server/index.d.ts:215,356`                  |
| `SERVER_INFO_META_KEY` = `io.modelcontextprotocol/serverInfo`, in `/server` | runtime introspection of `@modelcontextprotocol/server@2.0.0` |
| `DiscoverResult` drops `serverInfo`; `clientInfo` optional; spec PR #3002 | `support-2026-07-28.md` §Server identity in result `_meta` |
| 2026-07-28 is opt-in (`versionNegotiation`, `serveStdio`, `createMcpHandler`) | `support-2026-07-28.md` §§Serving the revision, Server over stdio |
| Same supported-version list across v1 1.29.x / v2    | `upgrade-to-v2.md` §Migrating in stages                                |
| 415 on non-JSON media type                           | `upgrade-to-v2.md` §HTTP & headers                                     |
| CJS alongside ESM                                    | `upgrade-to-v2.md` §Packaging & runtime; v2 `exports` `require` condition |
| Node-vs-web-standard transport decision rule         | `upgrade-to-v2.md` §Imports & transports                               |
| `.tool()` removed; `registerResource` needs metadata | `upgrade-to-v2.md` §Server registration API                            |
| `SSEServerTransport` / AS auth → `server-legacy`     | `upgrade-to-v2.md` §Imports & transports                               |
| Codemod counts, warning, residual errors             | executed against a copy of this repo, 2026-07-28                       |
| Vendored-shim wire equivalence; 148-tool smoke test  | executed against `@modelcontextprotocol/server@2.0.0`, 2026-07-28      |
