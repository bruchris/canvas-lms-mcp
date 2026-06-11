# MCP Apps Spike: Interactive Course Structure UI

**Date**: 2026-06-11
**Issue**: BRU-1573 (spike) — depends on shipped BRU-1265 (`get_course_structure` tool)
**Related research**: BRU-1571 (product research surfacing MCP Apps as a v1.x headline feature)
**Status**: Design proposal, awaiting CTO decision

## TL;DR — Recommendation

**Ship.** Build a single interactive MCP App for course structure as a v1.x headline feature, behind a separate tool name (`view_course_structure`) so the existing `get_course_structure` stays untouched for clients that don't support MCP Apps.

- SDK: add `@modelcontextprotocol/ext-apps` (v1.7.4) as a runtime dep, used alongside our current `@modelcontextprotocol/sdk` 1.29.x. No replacement, no fork.
- Pseudonymizer: payload is content metadata only (no user names, IDs, or participants). No wrapping needed; no entry in `PSEUDONYMIZER_WRAPPED_TOOLS`. Document the boundary so a future `include_progress` flag triggers the wrap.
- Bundling: inline a small vanilla-JS + CSS string literal (option c). Tree explorer fits in ~10–15 KB. No tsup changes for v1.
- Graceful degradation: clients without MCP Apps support still get the full JSON payload as `content[0].text`, identical to today.
- Rationale: leapfrogs vishalsachdev (PR #117 is design-only, no code) before they ship. Reuses the already-shipped backend and is the smallest possible footprint for a meaningful "wow" demo.

## Three unknowns, retired

### 1. SDK fit

**Decision**: use `@modelcontextprotocol/ext-apps/server` alongside `@modelcontextprotocol/sdk`.

The ext-apps SDK exposes `registerAppTool` and `registerAppResource` helpers that delegate to the same `McpServer` instance we already construct in `src/server.ts`. From the quickstart:

```ts
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from '@modelcontextprotocol/ext-apps/server'
```

These helpers wrap `server.tool()` and `server.resource()` and inject the `_meta.ui.resourceUri` link. We already register tools through a manual loop in `src/tools/index.ts` (`server.tool(name, description, schema, annotations, handler)`); ext-apps is additive.

Our existing `ToolDefinition` shape does not carry a `_meta` field. We extend it once:

```ts
// src/tools/types.ts
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  annotations: ToolAnnotations
  handler: (params: Record<string, unknown>) => Promise<unknown>
  ui?: {
    resourceUri: string
    csp?: {
      connectDomains?: string[]
      resourceDomains?: string[]
      frameDomains?: string[]
    }
  }
}
```

`registerAllTools` then branches: if `tool.ui` is set, call `registerAppTool` (which produces the same content envelope but adds `_meta.ui.resourceUri` automatically); else fall back to today's path. The pseudonymized `_meta.pseudonymized` envelope merges cleanly because `_meta` is a flat object — `ui` and `pseudonymized` are independent keys.

**Tool naming**: introduce a new tool `view_course_structure` rather than overload `get_course_structure`.

Why a new tool, not a flag:
- Tool annotations and `_meta` are fixed at registration time, not per-call. We can't conditionally emit `_meta.ui.resourceUri` based on a runtime param.
- Hosts that don't support MCP Apps would still see the extra tool but use it identically to the existing one — the model can pick either. The duplication is small (the wrapper is ~10 LOC) and the naming signals intent ("view" implies UI; "get" implies JSON).
- Keeps backward compat 100% intact for existing skills, prompts, and the published manifest.

`view_course_structure` calls the same `canvas.modules.getCourseStructure()` method internally, returns the same payload, and additionally links to the UI resource via `_meta.ui.resourceUri`.

### 2. Pseudonymizer interaction

**Decision**: no wrapping. Do not add `view_course_structure` (or `get_course_structure`) to `PSEUDONYMIZER_WRAPPED_TOOLS`.

Audit of the `CanvasCourseStructure` payload (`src/canvas/types.ts:533–562`):

| Field | Contains user PII? |
| --- | --- |
| `modules[].id`, `name`, `position`, `state`, `unlock_at` | No (module metadata) |
| `modules[].items[].id`, `title`, `type`, `position`, `published` | No (item metadata) |
| `modules[].items[].html_url`, `page_url`, `content_id` | No (URLs and content IDs) |
| `modules[].items[].content_details` | No (Canvas content metadata — due dates, point values, lock info) |
| `summary.total_modules`, `total_items`, `items_by_type` | No (counts) |

This payload does not carry `CanvasUser`, `user_name`, `participants`, or any field the existing pseudonymizer methods (`anonymizeUser`, `anonymizeUsers`, `anonymizeEnrollment`, `anonymizeSubmission`, `anonymizeConversation`, `anonymizeOutcomeResults`) operate on. CI's `tests/pseudonym/coverage.test.ts` enforces that PII-bearing tools are wrapped; nothing in the structure payload triggers that bar.

**Forward-looking guard**: if a future revision adds completion percentages per student, a `user_id`-keyed map of progress, or an `instructors[]` array, the tool MUST be added to `PSEUDONYMIZER_WRAPPED_TOOLS` and wrapped at the handler. Document this constraint as a comment on the new tool's handler and on the `view_course_structure` spec section so the next person adding `include_progress` doesn't miss it.

**The widget**: the iframe receives the same JSON payload via the MCP host's standard postMessage data path (`window.openai.toolResult` in current host implementations, or the equivalent injected variable per host). Since the server response is the source of truth, the iframe only ever sees what we already approved for emission. No separate widget-side filter is needed.

### 3. Bundling

**Decision**: option (c) — inline a vanilla-JS + CSS string literal.

Build a single-file widget at `src/ui/course-structure.html.ts` that exports a string constant. The resource handler returns it directly:

```ts
// src/ui/course-structure.html.ts
export const COURSE_STRUCTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>/* ~2 KB tree styles */</style>
</head><body>
<div id="root"></div>
<script>
  // ~8–10 KB vanilla JS: collapsible tree, type-filter chips, search box
  const data = window.openai?.toolResult ?? window.__MCP_TOOL_RESULT__
  // render data.modules into the tree
</script></body></html>`
```

Why (c) over (a) "pre-built bundle" and (b) "Vite/esbuild step":
- **No new build tooling**: tsup currently does Node ESM/CJS bundling only. Adding a Vite step doubles CI time and produces a second artifact format we'd have to ship in the npm tarball.
- **Easy to review**: the HTML is in version control as readable source. PRs diff cleanly. No `dist/` blob committed.
- **Constrained complexity**: the v1 widget is a tree view + filters. No React, no router, no async data fetching from inside the iframe. Vanilla DOM stays under ~12 KB minified-ish (we don't even need to minify because of compression on the resource read path).
- **Migration path is real**: when the widget grows past, say, 30 KB or needs shared components with a future second widget, we promote to option (a) with a tiny esbuild step that emits `dist/ui/*.html` and gets bundled into the npm tarball via `files`. The string-literal source becomes the dev entry point.

What's in the v1 widget:
- Collapsible per-module tree
- Item-type filter chips (Assignment, Page, Quiz, File, Discussion, ExternalUrl, ExternalTool, SubHeader)
- Type-ahead title search
- Published/unpublished badges
- Links open in a new tab pointing at the item's `html_url`
- Summary header with `total_modules`, `total_items`, and per-type counts

What's out of v1:
- No tool callbacks from the iframe (no `tools/call` from the widget). v2 territory.
- No drag-and-drop reordering.
- No mutation of any kind. `view_course_structure` is `readOnlyHint: true`.
- No analytics or telemetry beacons. CSP `connectDomains` left empty.

CSP: keep it tight. `resourceDomains: []`, `connectDomains: []`, `frameDomains: []`. The widget renders only what the server passed in via the tool result; it makes no outbound requests.

## Exact tool contract

```ts
{
  name: 'view_course_structure',
  description:
    'Interactive tree view of a course\'s modules and items. Returns the same payload as `get_course_structure` and additionally links to an MCP Apps UI resource that renders an explorable tree with type filters and search. Hosts that do not support MCP Apps fall back to the JSON payload (same as `get_course_structure`).',
  inputSchema: {
    course_id: z.number().describe('The Canvas course ID'),
    include_published_only: z.boolean().optional()
      .describe('When true, exclude unpublished items (default: false)'),
    include_content_details: z.boolean().optional()
      .describe('When true, fetch content_details for each item (default: false)'),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  ui: {
    resourceUri: 'ui://canvas-lms-mcp/course-structure.html',
    // CSP intentionally empty: widget is self-contained.
  },
  handler: async (params) => {
    return canvas.modules.getCourseStructure(params.course_id as number, {
      includePublishedOnly: params.include_published_only as boolean | undefined,
      includeContentDetails: params.include_content_details as boolean | undefined,
    })
  },
}
```

Resource registration in `src/resources/ui-course-structure.ts`:

```ts
import { registerAppResource, RESOURCE_MIME_TYPE }
  from '@modelcontextprotocol/ext-apps/server'
import { COURSE_STRUCTURE_HTML } from '../ui/course-structure.html'

export function registerCourseStructureUI(server: McpServer): void {
  registerAppResource(
    server,
    'Course Structure',
    'ui://canvas-lms-mcp/course-structure.html',
    { mimeType: RESOURCE_MIME_TYPE, description: 'Interactive course structure tree' },
    async () => ({
      contents: [{
        uri: 'ui://canvas-lms-mcp/course-structure.html',
        mimeType: RESOURCE_MIME_TYPE,
        text: COURSE_STRUCTURE_HTML,
      }],
    }),
  )
}
```

Wire it into `src/resources/index.ts` alongside the existing syllabus and assignment-description resources.

## URI scheme

`ui://canvas-lms-mcp/<widget-name>.html`

- `ui://` is the MCP Apps reserved scheme.
- `canvas-lms-mcp` segment scopes to our server so multi-server hosts don't collide.
- `.html` suffix is conventional (matches the SDK quickstart and shop example).

Future widgets follow the same pattern (`ui://canvas-lms-mcp/assignment-rubric.html`, `ui://canvas-lms-mcp/gradebook.html`, ...).

## Graceful degradation

MCP hosts that pre-date the apps spec or have it disabled fall back transparently:

1. They call `view_course_structure` and receive a `CallToolResult` whose `content[0].text` is the same JSON the existing `get_course_structure` returns.
2. They ignore the unknown `_meta.ui.resourceUri` field (MCP spec: unknown `_meta` keys MUST be ignored).
3. They never issue a `resources/read` for the `ui://` URI.

So clients that don't support MCP Apps see no error, no warning, just text. The widget is purely additive. There is no need for a "compat mode" flag.

If a future host quirks need explicit feature detection, we can read it from initialization (`InitializeResult.capabilities.experimental?.apps`) and conditionally register `view_course_structure` only when supported. **Not in v1.**

## Build / test / release impact

| Surface | v1 impact |
| --- | --- |
| `package.json` deps | +1 runtime dep: `@modelcontextprotocol/ext-apps` |
| `tsup.config.ts` | no change (no new entry point; HTML is a string literal in TS source) |
| Tarball size | +~12 KB for the inlined HTML, +~80 KB for ext-apps SDK (one-time) |
| `src/tools/types.ts` | add optional `ui?: { resourceUri; csp? }` to `ToolDefinition` |
| `src/tools/index.ts` | branch in registration loop: `registerAppTool` if `tool.ui` else `server.tool` |
| `src/tools/modules.ts` | add `view_course_structure` tool definition (~25 LOC) |
| `src/resources/index.ts` | call `registerCourseStructureUI(server)` |
| `src/resources/ui-course-structure.ts` | new file, ~20 LOC |
| `src/ui/course-structure.html.ts` | new file, inlined HTML+JS+CSS string literal |
| `tests/tools/modules.test.ts` | extend to assert `view_course_structure` is registered, has the right annotations, calls through to `getCourseStructure`, and emits `_meta.ui.resourceUri` |
| `tests/resources/` | new test: the `ui://canvas-lms-mcp/course-structure.html` resource resolves to HTML with `data` injection sink intact |
| `tests/pseudonym/coverage.test.ts` | no change (the new tool is not PII-bearing) |
| `docs/generated/tool-manifest.json` | regenerates to include `view_course_structure` |
| CHANGELOG | `feat(ui): add view_course_structure interactive MCP Apps widget` — minor bump (no breaking changes) |

## Phasing

### v1 (this design, ~3–5 days of work)
- Read-only tree explorer.
- Single tool: `view_course_structure`.
- Single resource: `ui://canvas-lms-mcp/course-structure.html`.
- No callbacks from iframe; no mutation.

### v2 candidates (separate spec, not in scope here)
- Interactive callback: click an item → fire `get_assignment` or `get_page` to drill down. Requires host support for `window.openai.callTool()` (or the spec equivalent) and a designed CSP for connectDomains pointing at the same MCP transport.
- Bulk publish/unpublish from the tree. Pulls in `update_module_item` writes and the destructive-hint UX. Requires user confirmation flows the host owns.
- Drag-and-drop reorder. Same write path.

### Future widget candidates (not designed here, mentioned for awareness)
- **Assignment rubric grader** — already-shipped rubric and submission tools; a grading UI is a natural fit.
- **Gradebook heat map** — overview of assignment scores; needs pseudonymizer (student PII).
- **Calendar view** — combines `list_calendar_events` and assignment due dates.

The gradebook candidate is the first one that requires non-trivial pseudonymizer integration into a widget. That work informs the widget infrastructure we'd want in place before piloting it, but `get_course_structure` is correctly the first pilot because it has zero PII.

## Risk note

| Risk | Mitigation |
| --- | --- |
| `@modelcontextprotocol/ext-apps` is at 1.7.x, recent (2026-06-05). API may still shift. | Pin to caret-minor (`^1.7.4`). If the API breaks before v1.0, we extract `registerAppTool` ourselves — it's just `server.tool()` with `_meta.ui.resourceUri` injected, ~10 LOC. |
| Host divergence: ChatGPT, Claude Desktop, Goose, VSCode each implement MCP Apps independently. Data-injection sink (`window.openai.toolResult` vs other names) may differ. | The widget probes multiple known sinks (`window.openai`, `window.__MCP_TOOL_RESULT__`) and falls back to a static "Open this tool in a host that supports MCP Apps" message. Document tested hosts in README. |
| Sandboxed iframe limits: no localStorage, no third-party fonts unless CSP allows. | v1 ships system-font stack and no persistence. Sufficient for a tree view. |
| Widget breaks silently if `data` shape changes server-side. | Type-check the inlined HTML's contract against `CanvasCourseStructure` via a runtime guard in the widget that renders a friendly "unexpected payload shape" message. Snapshot test in `tests/resources/`. |
| Competitor (vishalsachdev) catches up. | They have a design-only PR (#117) and no implementation as of 2026-06-07. Even a 1–2 week lead matters for the "first canvas-lms MCP App" narrative. |
| Pseudonymizer drift: someone adds `include_progress` to the tool and forgets the wrap. | Comment block on the handler citing this spec. CI does not catch it because the existing `coverage.test.ts` operates on registered tool names, not payload shape. Acceptable — same exposure as every other content tool. |

## Open questions

- **Do we want `view_course_structure` in the default tool set, or only when a `--enable-ui-widgets` flag is set?** Recommendation: default-on. Hosts ignore unknown `_meta` keys; there's no harm. Flag adds a config surface for no gain.
- **Should the widget include a "Copy as Markdown" button that produces a textual outline of the course?** Trivial to add and useful for copy-paste into other LLM contexts. Probably yes, but holds for v1.1.
- **Telemetry?** The widget could beacon usage data (which type filter was used, whether the tree was expanded). Not in v1 — adds CSP complexity and a privacy story we don't currently have.
- **Localization?** v1 ships English-only. Canvas content is already in the source language; the chrome ("Modules", "Items", "Published") is the only translatable surface.

## Acceptance for the implementation subtasks (when the time comes)

- `pnpm build && pnpm typecheck && pnpm test && pnpm lint` all pass.
- `view_course_structure` shows up in `docs/generated/tool-manifest.json`.
- Manual verification: connect a v1.x build to Claude Desktop, call `view_course_structure` with a real course, see the interactive tree.
- Fallback verification: connect to Codex (no MCP Apps support) and confirm the same call still returns valid JSON.
- README updated with a "Interactive widgets" section and a screenshot.
