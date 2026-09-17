---
issue: 355
---

# Advertise Agent Skills as MCP Prompts — Design

**Date**: 2026-09-18
**Issue**: [bruchris/canvas-lms-mcp#355](https://github.com/bruchris/canvas-lms-mcp/issues/355)
**Base**: `origin/main` @ `db2c5e2` (v1.29.3), 165 tools, `@modelcontextprotocol/sdk` 1.30.0
**Status**: Design — implementation follows on this branch

---

## Purpose

The 16 Agent Skills under `skills/` are the most valuable part of this project for a host that is
not a coding agent, and they are the one part such a host cannot see. They are discovered by the
*client's* skill-file loader, which Claude Desktop, ChatGPT, and any in-process embedder do not
have. MCP already has the right primitive — `prompts` — and this server registers none.

This design registers each skill as an MCP prompt, generated from the existing markdown at build
time so `skills/` stays the single source of truth, and ships `skills/` to npm consumers as a
fallback for server versions that predate the prompt surface.

Prompts are the right primitive precisely because they are **inert templates the user chooses**.
Registering them grants a host no new tool authority: the user picks a workflow, the server returns
text, and the existing tool allowlist still governs everything the model can do afterwards.

---

## 0. Live-state gate

Required before design work. Result: **nothing has shipped, and no equivalent design exists.**

| Check                                | Command                                                  | Result                                             |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| Prompt registration in runtime source | `git grep -ln "registerPrompt\|ListPromptsRequestSchema" -- src/` | **0 files**                                 |
| Existing prompt design in specs        | `grep -ril "mcp prompt" docs/superpowers/specs/`        | **0 files**                                        |
| `skills/` referenced from `src/`       | `grep -rn -i "skills" src/`                             | **0 matches**                                      |
| `skills/` in the npm package           | `package.json#files`                                    | `["bin/", "dist/"]` — **not shipped**              |
| Skills on disk                         | dirs under `skills/` with a `SKILL.md`                  | **16**                                             |

Every measurement in this document was taken against this base commit with the SDK at 1.30.0, which
is the latest published version (`npm view @modelcontextprotocol/sdk version` → `1.30.0`). There is
no newer release to wait for.

---

## 1. Three findings that shape the design

The issue's four proposals are all adopted. Three measurements change *how*.

### 1.1 A declared `argsSchema` makes a spec-legal `prompts/get` call fail

This is the load-bearing finding. The MCP schema makes `arguments` **optional** on a
`GetPromptRequest`. The SDK does not.

`McpServer`'s `prompts/get` handler runs `safeParseAsync(normalizeObjectSchema(prompt.argsSchema),
request.params.arguments)`. When the client omits `arguments` entirely, that parses `undefined`
against an object schema and fails — **even when every declared argument is optional**:

```
getPrompt({ name: 'canvas-at-risk-students' })
→ MCP error -32602: Invalid arguments for prompt canvas-at-risk-students:
  Invalid input: expected object, received undefined
```

The official SDK *client* omits `arguments` when you pass none, so the failure reproduces
client-and-server on the same SDK version. The downstream Next.js consumer named in the issue is
the exact caller that would hit it.

Six candidate `argsSchema` forms were measured. Only a raw Zod shape works at all — every schema
instance is misdetected by the SDK's shape extraction, which walks the ZodObject's own properties
and advertises `def`, `type`, and `unwrap` as the prompt's arguments:

| `argsSchema` form                | Advertised arguments        | `getPrompt` with no `arguments` key |
| -------------------------------- | --------------------------- | ----------------------------------- |
| raw shape `{ course_id: z.string().optional() }` | correct     | **fails** (-32602)                  |
| `z.object(shape)`                | `def`, `type` — wrong       | fails                               |
| `z.object(shape).default({})`    | `def`, `type`, … — wrong    | fails                               |
| `z.object(shape).optional()`     | `def`, `type`, … — wrong    | fails                               |
| `z.object(shape).catch({})`      | `def`, `type`, … — wrong    | fails                               |
| `z.looseObject(shape).default({})` | `def`, `type`, … — wrong  | fails                               |

So within `registerPrompt` the choice is: declare arguments and break a spec-legal call, or declare
no arguments and lose the issue's item 2. Neither is acceptable.

**Resolution: this server owns the two prompt request handlers directly.** `prompts/list` and
`prompts/get` are registered on the underlying `Server` with an explicit
`registerCapabilities({ prompts: { listChanged: false } })`. Measured against the same in-memory
transport, this serves the correct argument list *and* accepts all three call shapes:

| Call                                    | Result                                             |
| --------------------------------------- | -------------------------------------------------- |
| `getPrompt({ name })`                   | OK — argument block omitted                         |
| `getPrompt({ name, arguments: {} })`    | OK — argument block omitted                         |
| `getPrompt({ name, arguments: { course_id: '42' } })` | OK — argument block prepended        |
| unknown argument name                   | `-32602 Unknown argument(s): …`                     |
| unknown prompt name                     | `-32602 Prompt … not found`                         |

Capability merging was measured in both registration orders (tools → prompts and prompts → tools)
and is order-independent; `tools` and `resources` keep their own `listChanged: true`.

The rejected alternative was a hybrid: keep `registerPrompt` for the listing and override only
`prompts/get`. It works, but it leaves 16 registered callbacks that can never run — dead code whose
deadness depends on undocumented SDK handler-ordering. If a future SDK stops letting a later
`setRequestHandler` win, the server silently reverts to the broken behaviour with no test failing.

`listChanged` is `false` because it is true: the prompt list is fixed when the server is
constructed, and nothing mutates it at runtime.

### 1.2 Skill bodies name tools that deliberately do not exist

The issue's item 4 — mark the skills that reach write tools — is derivable rather than hand-listed:
intersect the backticked identifiers in each body with the live tool registry and keep those with
`destructiveHint: true`. Measured, that yields **8 of 16 skills** reaching between one and three
write tools, matching a manual read.

What it also surfaces is that **10 backticked identifiers are references to tools that do not
exist, and are meant not to**. They are warnings to the model:

> There is no separate `list_discussion_entries` tool — all thread content comes through
> `get_discussion`. If you search for `list_discussion_entries` you will not find it.

> …this MCP server exposes no `start_report`, no `get_report_status`, and no `download_report`.

All 10 are in this shape across three skills. The consequence is specific: the extractor must
**silently ignore** identifiers it cannot resolve, and this design must **not** add a CI gate
asserting that every backticked identifier resolves to a registered tool. Such a gate would fail
today on correct content. Detecting genuine skill-to-tool drift is a real but separate problem, and
is listed in §9 as out of scope.

Derivation runs against the **complete** registry — the 165 tools including the two behind
`CANVAS_ENABLE_ASSIGNMENT_SUBMISSION` (`submit_assignment`, `upload_submission_file`) — so a
skill's write marking never depends on a deployer's feature flags. `getAllTools` with no flags
returns 163.

### 1.3 `_meta` survives the round trip, so item 4 can be served twice

A reverse-DNS-keyed `_meta` block was measured to survive intact on both a `prompts/list` entry and
a `prompts/get` result. So the write-tool marking is published two ways, and neither is guesswork
for a host:

- **Prose**, appended to the description, for a host that shows the picker to a human.
- **Structured**, under `_meta["io.github.bruchris/canvas-lms-mcp"]`, for a host that wants to
  decide whether to offer the workflow at all before a human sees it.

The `_meta` key matches `package.json#mcpName`, so it is namespaced to this server and cannot
collide with another server's metadata in an aggregating host.

---

## 2. Architecture

```
skills/<name>/SKILL.md          source of truth (unchanged content; frontmatter gains metadata)
  │
  │  pnpm generate:prompts   (scripts/generate-prompts.ts)
  ▼
src/prompts/skills.generated.ts  committed, typed, bundler-safe
  │
  ├── src/prompts/catalog.ts     shapes entries into prompt definitions
  ├── src/prompts/arguments.ts   the argument vocabulary
  └── src/prompts/index.ts       registerAllPrompts(server, role)
         │
         ▼
     src/server.ts               createCanvasMCPServer → stdio, http, in-process embedder
```

### 2.1 Why a generated module, not runtime file reads

Three candidates were considered.

**A generated TypeScript module (chosen).** A script parses `skills/*/SKILL.md` into a committed
`src/prompts/skills.generated.ts`, exactly as `docs/generated/*.json` is generated from the tool
registry and `src/ui/*.html.ts` holds inlined widget HTML today. It works under tsup, under `tsc`
declaration emit, under vitest, and inside a downstream bundler, in both ESM and CJS output. A test
regenerates in memory and fails if the committed file is stale, so `skills/` cannot drift from the
shipped prompts.

**Reading `skills/` from disk at runtime (rejected).** Needs path resolution from `dist/` that
works in ESM and CJS, needs `skills/` present on disk, and **fails for the in-process embedder that
raised the issue** — a Next.js bundle does not carry a sibling markdown directory. It would fix the
weakest case and break the motivating one.

**Bundler raw-import of `.md` (rejected).** tsup can inline markdown, but `tsc -p
tsconfig.build.json` (declaration emit, `rootDir: src`) and vitest each need their own loader
configuration. Three toolchains to keep in sync for no gain over a generated module.

Shipping `skills/` in `package.json#files` (issue item 3) is adopted regardless. It is useful on its
own, and it is the fallback for a consumer pinned to a version older than this one.

### 2.2 Generated module shape

```ts
// src/prompts/skills.generated.ts — GENERATED by `pnpm generate:prompts`. Do not edit.
export interface GeneratedSkill {
  /** Frontmatter `name`; also the prompt name and the directory name. */
  name: string
  /** The body's first H1, used as the prompt title. */
  title: string
  /** Frontmatter `description`, verbatim. Carries the trigger phrases. */
  description: string
  /** Declared argument names, in display order. Each must exist in ARGUMENT_VOCABULARY. */
  argumentNames: readonly string[]
  /** Audience tag driving role filtering. */
  audience: 'student' | 'educator' | 'admin' | 'shared'
  /** Registered tools with destructiveHint, resolved from the body. Sorted, deduped. */
  writeTools: readonly string[]
  /** The markdown body with frontmatter removed, verbatim. */
  body: string
}

export const GENERATED_SKILLS: readonly GeneratedSkill[] = [ /* 16 entries */ ]
```

`body` is the markdown after the closing `---`, with leading blank lines trimmed and nothing else
changed. Skill text is authored in this repository, not fetched from Canvas, so provenance fencing
(`src/provenance/`) does not apply — that mechanism exists to mark *Canvas-authored* content that a
model might mistake for instructions. Fencing our own workflow instructions would be wrong.

Total body size across all 16 skills is ~100 KB. A `prompts/get` returns one body, never all 16.

---

## 3. Skill frontmatter contract

Per-skill audience and arguments live in `SKILL.md` frontmatter, under the Agent Skills
specification's optional `metadata` field. That field is defined as *a map from string keys to
string values*, with a recommendation that key names be unique enough to avoid collisions, so both
keys are reverse-DNS-prefixed and both values are strings:

```yaml
---
name: canvas-grading-pass
description: Educator grading workflow for Canvas. …
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
---
```

`-arguments` is a space-separated list, mirroring the spec's own `allowed-tools` convention. Both
keys are optional: a skill with no `-arguments` declares no arguments, and a missing `-audience`
is an error at generation time rather than a silent default, because a wrong audience silently
hides a workflow from the role that needs it.

This keeps `skills/` as the single source of truth and avoids the parallel-table pattern that
PR #340 removed from the tool manifest. Third-party skill loaders are unaffected: `metadata` is a
spec-defined optional field, and a loader that ignores it sees today's file.

### 3.1 The 16 skills

Arguments are assigned only where the body genuinely scopes on that ID.

| Skill                        | Audience | Arguments                              | Write tools |
| ---------------------------- | -------- | -------------------------------------- | ----------- |
| canvas-accessibility-sweep   | educator | course_id                              | —           |
| canvas-admin-roster          | admin    | account_id, course_id                  | 2           |
| canvas-at-risk-students      | educator | course_id                              | 1           |
| canvas-course-pulse          | educator | course_id                              | —           |
| canvas-course-qc             | educator | course_id                              | —           |
| canvas-discussion-facilitator| educator | course_id                              | 3           |
| canvas-gradebook-audit       | educator | course_id, assignment_id, student_id   | —           |
| canvas-grading-pass          | educator | course_id, assignment_id               | 3           |
| canvas-morning-check         | educator | —                                      | —           |
| canvas-office-hours          | educator | course_id                              | 3           |
| canvas-outcome-tracker       | educator | course_id, student_id                  | —           |
| canvas-peer-review-tracker   | educator | course_id, assignment_id               | 3           |
| canvas-quiz-review           | educator | course_id, quiz_id, student_id         | 1           |
| canvas-student-todo          | student  | —                                      | —           |
| canvas-syllabus-coach        | educator | course_id                              | 3           |
| canvas-week-plan             | student  | —                                      | —           |

Write-tool counts are shown for review only. They are **derived at generation time**, never written
into frontmatter, so they cannot drift from the registry.

### 3.2 Argument vocabulary

MCP prompt arguments are strings on the wire, so every argument is an optional string. The
vocabulary is closed and lives in `src/prompts/arguments.ts`:

| Name            | Description shown to the host                                            |
| --------------- | ------------------------------------------------------------------------ |
| `course_id`     | Canvas course ID to run this workflow against. Omit to be asked.          |
| `assignment_id` | Canvas assignment ID to scope to. Omit to be asked.                      |
| `quiz_id`       | Canvas quiz ID to scope to. Omit to be asked.                            |
| `account_id`    | Canvas account ID to scope to. Omit to start from the root account.      |
| `student_id`    | Canvas user ID of a single student to scope to. Omit for the whole class. |

Generation fails if a skill declares a name outside this table, so a typo in frontmatter is caught
in CI rather than surfacing as an undocumented argument.

Every argument is optional because every skill already knows how to ask. A host that has a course
in hand can prefill; one that does not still gets a working workflow.

---

## 4. The prompt surface

For `canvas-grading-pass` with `course_id` supplied:

**`prompts/list` entry**

```json
{
  "name": "canvas-grading-pass",
  "title": "Canvas Grading Pass",
  "description": "Educator grading workflow for Canvas. … Trigger phrases include \"grade submissions\", … Uses write tools: comment_on_submission, grade_submission, submit_rubric_assessment. The workflow asks you to confirm before each write.",
  "arguments": [
    { "name": "course_id", "description": "Canvas course ID to run this workflow against. Omit to be asked.", "required": false },
    { "name": "assignment_id", "description": "Canvas assignment ID to scope to. Omit to be asked.", "required": false }
  ],
  "_meta": {
    "io.github.bruchris/canvas-lms-mcp": {
      "audience": "educator",
      "writeTools": ["comment_on_submission", "grade_submission", "submit_rubric_assessment"]
    }
  }
}
```

**`prompts/get` result** — one user-role text message:

```
Context supplied by the user:
- course_id: 42

# Canvas Grading Pass

…the unmodified skill body…
```

The context block is omitted entirely when no argument is supplied, so the body is byte-identical to
the file on disk. Only declared, non-empty arguments appear in it. The block says "supplied by the
user" rather than asserting the value is correct, and the workflow's own steps still validate.

Descriptions of skills that reach no write tools get no appended sentence. The appended sentence can
push a description past the 1024-character ceiling the Agent Skills specification puts on
frontmatter `description`; that ceiling binds the file, not the MCP prompt, and the file is
unchanged. Generation asserts the *frontmatter* description stays within 1024.

---

## 5. Role filtering

Prompts are filtered by the configured role using the existing `ROLE_VISIBILITY` map in
`src/tools/roles.ts` — the same table that filters tools — so a host cannot be shown a student
planner under `CANVAS_ROLE=teacher` while its tools say otherwise.

| Role      | Prompts registered | Which                                             |
| --------- | ------------------ | ------------------------------------------------- |
| unset     | 16                 | all                                               |
| `student` | 2                  | canvas-student-todo, canvas-week-plan             |
| `teacher` | 13                 | the educator skills                               |
| `admin`   | 14                 | the educator skills + canvas-admin-roster         |

This reuses `isVisibleForRole`, which reads `tool.audience`; the prompt catalog exposes `audience`
under the same name, so the predicate is shared rather than reimplemented.

Filtering is a UX and context-reduction measure, exactly as it is for tools. It is not a security
boundary: Canvas enforces permissions server-side, and a prompt is inert text either way.

**If a filter ever leaves no prompts, the `prompts` capability is not declared at all.** No role
does that today — the smallest set is 2 — but the guard is what keeps capability negotiation
honest, as the issue asks. Measured: a server with zero prompts advertises no `prompts` capability
and answers `prompts/list` with `-32601 Method not found`.

On the HTTP transport, `X-Canvas-Role` already selects the role per request and a fresh server is
built per request, so prompt filtering follows the header with no extra work.

---

## 6. Packaging

- `package.json#files` becomes `["bin/", "dist/", "skills/"]`. Issue item 3; ~103 KB of markdown.
- The `.mcpb` bundle is unaffected. `scripts/pack-mcpb.mjs` stages `dist/` only, and the generated
  module is inside `dist/`, so Claude Desktop gets the prompts without the markdown.
- No change to `server.json` or `manifest.json`. Both carry the tool count and the version, neither
  describes prompts, and both are version-sync surfaces watched by the release assertions
  (BRU-2431). Adding a prompt count to them would create a fifth count-drift surface for no
  consumer that exists today.

---

## 7. Test plan

New file `tests/prompts/skills.test.ts` unless noted.

**Generation**

1. The committed `src/prompts/skills.generated.ts` equals a fresh in-memory generation — the
   staleness gate, mirroring `tests/discovery/manifests.test.ts`.
2. One generated entry per directory under `skills/` containing a `SKILL.md`, and every `name`
   matches its directory name.
3. Frontmatter parsing: `name`, `description`, and both metadata keys are extracted; body excludes
   frontmatter; the frontmatter description stays within 1024 characters.
4. An unknown argument name in frontmatter fails generation with a message naming the skill and the
   argument.
5. A missing audience fails generation with a message naming the skill.
6. Write-tool derivation resolves only registered tools, keeps only `destructiveHint: true`, and
   **ignores unresolvable identifiers** — asserted against a fixture containing a "there is no
   `get_account_tree` tool" line, so §1.2 stays true if a skill adds another such warning.

**Wire behaviour** (in-memory client and server, as `tests/mcp-apps-wire.test.ts` does)

7. `prompts/list` returns 16 entries with title, description, arguments, and `_meta`.
8. `getPrompt` with no `arguments` key succeeds — the §1.1 regression gate. This test fails against
   a `registerPrompt`-based implementation, which is the point.
9. `getPrompt` with `arguments: {}` succeeds and returns a body with no context block.
10. `getPrompt` with a supplied argument prepends exactly one context block naming it.
11. An unknown argument name and an unknown prompt name each raise `-32602`.
12. The returned body for a prompt with no arguments supplied is byte-identical to the file's body.
13. `_meta.writeTools` on a listing entry matches the derived set for that skill.

**Integration and parity**

14. `createCanvasMCPServer` advertises the `prompts` capability, and still advertises `tools` and
    `resources` (guards the capability-merge finding in §1.1).
15. Role parity: for each of unset/student/teacher/admin, the set of registered prompt names equals
    the set of skills whose audience that role can see — computed from `ROLE_VISIBILITY`, not
    hard-coded — mirroring `tests/discovery/audience-runtime-parity.test.ts`.
16. A catalog filtered to zero prompts declares no `prompts` capability.

**Docs consistency** — extend `tests/docs/skill-count-consistency.test.ts`

17. The number of registered prompts (unset role) equals the skill-directory count, so adding a
    skill without regenerating fails CI.

---

## 8. Implementation checklist

1. Add the two `metadata` keys to all 16 `SKILL.md` files (§3.1). Content otherwise untouched.
2. `src/prompts/arguments.ts` — the closed argument vocabulary (§3.2).
3. `scripts/generate-prompts.ts` — parse, validate, derive write tools, emit
   `src/prompts/skills.generated.ts`. Wire `pnpm generate:prompts`.
4. `src/prompts/skills.generated.ts` — generated and committed.
5. `src/prompts/catalog.ts` — build prompt definitions: title, description with the appended write
   sentence, argument descriptors, `_meta`, and the message builder.
6. `src/prompts/index.ts` — `registerAllPrompts(server, role)`: filter by role, and when the result
   is non-empty register the capability and both handlers (§1.1, §5).
7. `src/server.ts` — call `registerAllPrompts` alongside `registerAllTools` and
   `registerAllResources`.
8. `package.json#files` — add `skills/` (§6).
9. Tests per §7.
10. Docs: README Agent Skills section (prompts are now served over MCP), `docs/agent-discovery.md`
    (prompt surface + `pnpm generate:prompts`), and a new step in `.claude/CLAUDE.md`'s "How to add
    a new tool" sibling section covering how to add a skill.
11. Full local validation: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## 9. Out of scope

- **A `prompt-manifest.json` under `docs/generated/`.** The protocol is the discovery surface for
  prompts; a static file would be a second oracle to keep in sync. The tool manifest exists because
  tools have no other machine-readable catalog for non-MCP consumers.
- **A skill-to-tool drift gate.** Worth having, but §1.2 shows the obvious implementation fails on
  correct content today. It needs its own design to distinguish a tool a skill *calls* from one it
  warns does not exist.
- **Prompt arguments carrying non-ID context** (date ranges, audit scope). Every skill already asks;
  IDs are the arguments a host can actually prefill.
- **`prompts/list` pagination.** 16 entries, names and descriptions only.
- **Elicitation or any model-initiated prompt invocation.** A prompt is user-chosen by design; that
  property is what makes this change add no tool authority.
