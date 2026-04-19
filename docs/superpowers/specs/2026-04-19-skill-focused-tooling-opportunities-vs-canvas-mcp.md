# Skill-Focused Tooling Opportunities vs `vishalsachdev/canvas-mcp`

**Date:** 2026-04-19  
**Scope:** Compare `bruchris/canvas-lms-mcp` against `vishalsachdev/canvas-mcp` and identify the highest-value agent/tooling improvements for this repo.  
**Comparison baseline:** `vishalsachdev/canvas-mcp` `main` branch as observed on 2026-04-19 via GitHub repo metadata, `AGENTS.md`, `tools/TOOL_MANIFEST.json`, `tools/README.md`, and repository tree.

## Executive Summary

`canvas-lms-mcp` is already stronger on core server architecture than `vishalsachdev/canvas-mcp`: it has a cleaner three-layer TypeScript design, a standalone reusable Canvas client export, and materially broader first-class tool coverage (88 tools vs the comparison repo's 21 tools documented in `tools/TOOL_MANIFEST.json` version `1.0.6`).

The main gap is not raw Canvas coverage. The gap is **agent-facing packaging**:

1. `vishalsachdev/canvas-mcp` is easier for agents to discover, classify, and compose because it ships a machine-readable tool manifest plus explicit workflow examples.
2. It has a clearer story for high-frequency workflows such as bulk grading and peer-review reminders.
3. It packages role/persona guidance more explicitly for students, educators, and developers.

The highest-value opportunity for this repo is therefore to add a **skill/workflow layer on top of the existing 88 tools**, rather than expanding the low-level tool surface again.

## What `canvas-lms-mcp` Already Does Better

### 1. Stronger core architecture

This repo already separates:

- `src/canvas/` as a standalone client
- `src/tools/` as MCP definitions
- `src/server.ts` plus transport entry points

That is a better long-term base than the comparison repo's mixed Python server plus separate TypeScript code-execution package.

### 2. Better library and embedding story

This repo supports:

- stdio
- HTTP
- library import
- standalone `canvas-lms-mcp/canvas` usage

The comparison repo is more opinionated around standalone/server usage and developer-side code execution.

### 3. Broader first-class tool coverage

This repo already exposes 88 tools across:

- educator/admin workflows
- student workflows
- analytics
- accounts
- dashboard
- files
- modules/pages/calendar/conversations

The comparison repo is more selective in what it documents as the main agent-facing tool set.

## Where `vishalsachdev/canvas-mcp` Is Stronger

### 1. Machine-readable discovery

The comparison repo ships:

- `tools/TOOL_MANIFEST.json`
- `tools/README.md`
- workflow definitions inside the manifest

That makes it easier for agents and external tooling to answer:

- "What tools exist?"
- "Which tools are for students vs educators?"
- "What is the recommended workflow for bulk grading?"

This repo has strong README and AGENTS coverage, but no equivalent generated manifest or workflow index.

### 2. Persona-first packaging

The comparison repo treats the server as audience-specific:

- student
- educator
- shared
- developer

Its `AGENTS.md` also documents a role/profile concept (`CANVAS_ROLE=student|educator|all`) and maps tasks to tool subsets.

Even if this repo should **not** copy server-side role filtering, it should copy the **documentation and skill-packaging clarity** behind it.

### 3. Workflow-level utilities

The comparison repo emphasizes workflow helpers, not just primitive CRUD:

- `bulk_grade_submissions`
- `send_peer_review_reminders`
- workflow recipes in the manifest

This repo already has the underlying primitives, but it does not yet package them as explicit reusable workflow tools or skills.

### 4. Agent-oriented discovery helpers

The comparison repo adds developer-facing helper tools:

- `search_canvas_tools`
- `execute_typescript`

The important insight is not "add arbitrary code execution."  
The important insight is: **agents benefit from a smaller, structured discovery layer over a large tool surface.**

### 5. Optional privacy/accessibility positioning

The comparison repo invests in:

- FERPA-oriented anonymization
- accessibility helpers

Those are not immediate v1.0 blockers here, but they are meaningful differentiators for educator-facing adoption.

## What This Repo Should Not Copy Directly

### 1. Do not copy server-side role filtering

This repo's current spec is right to keep all tools registered and let Canvas enforce permissions. A single Canvas user can be a student in one course and an instructor in another, so hard role filtering at server startup is the wrong abstraction.

Recommended alternative:

- role-specific docs
- role-specific prompts/skills
- role-specific workflow catalogs

### 2. Do not copy arbitrary code execution as a near-term feature

`execute_typescript` is powerful, but it is also the highest-risk part of the comparison repo:

- security model complexity
- sandboxing requirements
- platform-specific execution concerns
- larger testing surface
- harder hosted-service story

For this repo, the safer move is curated workflow helpers first. If custom execution is ever added, it should be a later, explicitly sandboxed feature.

## Recommended Opportunities

### Priority 0: Generated Tool Manifest and Workflow Catalog

Add a generated artifact that describes the current server surface in a machine-readable way.

Suggested outputs:

- `docs/tool-manifest.json`
- `docs/workflow-manifest.json`
- optional `pnpm export:tool-manifest` command

Minimum fields:

- tool name
- domain
- read vs write
- annotations
- short description
- primary audience (`student`, `educator`, `admin`, `shared`)
- related workflows

Why this matters:

- improves agent discoverability immediately
- reduces README/AGENTS drift
- enables future doc generation
- gives "skills" a stable index to target

This is the cleanest response to the comparison repo's `TOOL_MANIFEST.json`.

### Priority 1: Ship First-Class Skills/Workflow Packs

The spec already pointed toward a skill layer, but the repo currently lacks it. That is the biggest missed opportunity.

Recommended first packs:

1. `student-weekly-planning`
2. `educator-assignment-review`
3. `educator-rubric-grading`
4. `educator-missing-work-outreach`
5. `peer-review-triage`

Each pack should define:

- when to use it
- recommended tool sequence
- safety notes for write actions
- example prompts
- expected outputs

This should live alongside the repo, not only in external agent homes, so downstream users can consume it directly.

### Priority 1: Add Curated Batch Workflow Helpers

Instead of general code execution, add a small number of narrow workflow helpers on top of the existing client:

- `draft_missing_submission_reminders`
- `summarize_assignment_submission_status`
- `prepare_rubric_grading_batch`
- `summarize_peer_review_completion`

Design constraints:

- dry-run first by default where writes are involved
- explicit rate-limiting and pagination handling
- deterministic input/output shapes
- implemented using the existing Canvas client modules

This preserves the current architecture while solving the same user problem that `bulk_grade_submissions` solves in the comparison repo.

### Priority 2: Audience-Specific Prompt and Doc Bundles

The current repo has student and educator guides, but it can be more agent-native.

Add:

- agent-ready prompt bundles for students, educators, and admins
- "recommended toolchains" per persona
- a lightweight `llms.txt` or equivalent agent index

This is lower effort than new code and closes a real usability gap.

### Priority 2: Optional Privacy and Accessibility Add-Ons

After the skill/workflow layer is in place, evaluate two optional educator-focused tracks:

1. privacy-preserving response shaping or anonymization modes
2. course accessibility scanning/reporting helpers

These should be opt-in modules, not baked into the core v1.0 story.

Rationale:

- they improve institutional appeal
- they are useful differentiators
- they are not prerequisites for the current npm/library-focused launch

## Recommended Implementation Order

1. Generate a tool/workflow manifest from the current tool registry.
2. Add repo-local skill definitions or workflow specs for the top 3-5 user journeys.
3. Introduce 1-2 curated batch/helper tools where the current primitives are awkward for agents.
4. Add agent-friendly doc indexes (`llms.txt`, prompt bundles, workflow pages).
5. Revisit privacy/accessibility extensions after the skill layer exists.

## Proposed Near-Term Deliverables

If this analysis is converted into implementation work, the best next issues are:

1. **Generate agent-readable tool manifest from `src/tools/`**
2. **Add repo-local workflow manifest for student and educator journeys**
3. **Create first workflow/skill pack: educator assignment review**
4. **Create first workflow/skill pack: student weekly planning**
5. **Design curated batch helper API instead of arbitrary code execution**

## Bottom Line

The comparison repo's advantage is not that it has "more MCP."  
Its advantage is that it gives agents a better **map** and better **pre-baked workflows**.

`canvas-lms-mcp` should respond by strengthening:

- manifest-driven discovery
- skill/workflow packaging
- curated batch helpers

It should **not** respond by copying:

- server-side role filtering
- arbitrary code execution

Those choices would dilute the architectural strengths this repo already has.
