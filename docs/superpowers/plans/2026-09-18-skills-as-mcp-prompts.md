# Agent Skills as MCP Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register each of the 16 Agent Skills as an MCP prompt so any host — not just one with a skill-file loader — can discover and run the Canvas workflows.

**Architecture:** A build-time script parses `skills/*/SKILL.md` into a committed TypeScript module, so the markdown stays the single source of truth and the prompts survive bundling. The server owns the `prompts/list` and `prompts/get` handlers directly rather than using `McpServer.registerPrompt`, because a declared `argsSchema` makes a spec-legal `prompts/get` call fail. Prompts are filtered by the configured role through the same `ROLE_VISIBILITY` table that filters tools.

**Tech Stack:** TypeScript (strict, ESM), `@modelcontextprotocol/sdk` 1.30.0, Zod 4, vitest, tsup, prettier.

**Spec:** `docs/superpowers/specs/2026-09-18-issue-355-skills-as-mcp-prompts.md`

## Global Constraints

- Node `>=22`, pnpm. Validation suite: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Prettier: no semicolons, single quotes, trailing commas `all`, print width 100, tab width 2. `pnpm lint` runs `eslint src/ tests/ && prettier --check src/ tests/`, so every file under `src/` and `tests/` must be prettier-clean — including generated ones.
- TypeScript strict, with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`. Indexing an array or record yields `T | undefined`; handle it.
- Conventional commits: `feat`, `fix`, `chore`, `docs`, `test`, `ci`.
- Tests never hit a real Canvas instance.
- `_meta` namespace key, used verbatim everywhere: `io.github.bruchris/canvas-lms-mcp` (matches `package.json#mcpName`).
- Frontmatter metadata keys, used verbatim: `io.github.bruchris/canvas-lms-mcp-audience` and `io.github.bruchris/canvas-lms-mcp-arguments`.
- Do not merge the PR. Push the branch and open it; the CTO merges.
- Branch is `feat/issue-355-skills-as-mcp-prompts`, already created from `origin/main` @ `db2c5e2`, with the spec committed at `19dc02c`.

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `src/prompts/types.ts` | `GeneratedSkill`, `PromptDefinition`, `PromptArgumentDescriptor`. Types only; excluded from coverage. |
| `src/prompts/arguments.ts` | The closed argument vocabulary and its lookup. |
| `src/prompts/generate.ts` | Build-time only: frontmatter parsing, validation, write-tool derivation, module emission. Never imported by `src/prompts/index.ts`, so tsup tree-shakes it out of `dist/server.js`. |
| `scripts/generate-prompts.ts` | Thin CLI wrapper, mirroring `scripts/generate-manifests.ts`. |
| `src/prompts/skills.generated.ts` | Generated and committed. Never hand-edited. |
| `src/prompts/catalog.ts` | Turns generated skills into prompt definitions: composed description, argument descriptors, role filter, message text. |
| `src/prompts/index.ts` | `registerAllPrompts(server, role)` — capability + both request handlers. |
| `src/tools/roles.ts` | Modified: extract `isAudienceVisibleForRole` so prompts and tools share one visibility table. |
| `src/server.ts` | Modified: call `registerAllPrompts`. |
| `skills/*/SKILL.md` | Modified: 16 files gain a `metadata:` block. Bodies untouched. |
| `package.json` | Modified: `files` gains `skills/`; new `generate:prompts` script. |

---

## Task 1: Frontmatter parsing and the argument vocabulary

**Files:**

- Create: `src/prompts/types.ts`
- Create: `src/prompts/arguments.ts`
- Create: `src/prompts/generate.ts` (parsing half only)
- Test: `tests/prompts/parse.test.ts`

**Interfaces:**

- Consumes: `ToolAudience` from `src/tools/types.ts`.
- Produces:
  - `ARGUMENT_VOCABULARY: Readonly<Record<string, string>>` — argument name → description.
  - `parseSkillFile(fileName: string, raw: string): ParsedSkillFile`
  - `interface ParsedSkillFile { name: string; title: string; description: string; audience: ToolAudience; argumentNames: string[]; body: string }`
  - `interface GeneratedSkill { name: string; title: string; description: string; argumentNames: readonly string[]; audience: ToolAudience; writeTools: readonly string[]; body: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/prompts/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../../src/prompts/generate'
import { ARGUMENT_VOCABULARY } from '../../src/prompts/arguments'

const VALID = `---
name: canvas-grading-pass
description: Educator grading workflow for Canvas. Trigger phrases include "grade submissions", "start grading".
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
---

# Canvas Grading Pass

Walk ungraded submissions one at a time.
`

describe('parseSkillFile', () => {
  it('extracts name, title, description, audience and arguments', () => {
    const parsed = parseSkillFile('canvas-grading-pass/SKILL.md', VALID)

    expect(parsed.name).toBe('canvas-grading-pass')
    expect(parsed.title).toBe('Canvas Grading Pass')
    expect(parsed.description).toContain('Educator grading workflow')
    expect(parsed.audience).toBe('educator')
    expect(parsed.argumentNames).toEqual(['course_id', 'assignment_id'])
  })

  it('keeps a colon inside the description value', () => {
    const parsed = parseSkillFile('x/SKILL.md', VALID)
    expect(parsed.description.endsWith('"start grading".')).toBe(true)
  })

  it('returns the body without frontmatter and without leading blank lines', () => {
    const parsed = parseSkillFile('canvas-grading-pass/SKILL.md', VALID)
    expect(parsed.body.startsWith('# Canvas Grading Pass')).toBe(true)
    expect(parsed.body).not.toContain('io.github.bruchris')
  })

  it('treats a skill with no arguments key as declaring none', () => {
    const noArgs = VALID.replace(
      '  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id\n',
      '',
    )
    expect(parseSkillFile('x/SKILL.md', noArgs).argumentNames).toEqual([])
  })

  it('ignores third-party metadata keys', () => {
    const extra = VALID.replace(
      'metadata:\n',
      'metadata:\n  com.example/other: something\n',
    )
    expect(parseSkillFile('x/SKILL.md', extra).audience).toBe('educator')
  })

  it('ignores unknown top-level frontmatter keys defined by the skills spec', () => {
    const licensed = VALID.replace('name:', 'license: MIT\nname:')
    expect(parseSkillFile('x/SKILL.md', licensed).name).toBe('canvas-grading-pass')
  })

  it.each([
    ['missing audience', VALID.replace(/ *io\.github\.bruchris\/canvas-lms-mcp-audience.*\n/, ''), /audience/i],
    ['unknown audience', VALID.replace('educator', 'teacher'), /teacher/],
    ['unknown argument', VALID.replace('course_id assignment_id', 'course_id bogus_id'), /bogus_id/],
    ['duplicate argument', VALID.replace('course_id assignment_id', 'course_id course_id'), /duplicate/i],
    ['no frontmatter', '# Just a heading\n', /frontmatter/i],
    ['unterminated frontmatter', '---\nname: x\n', /frontmatter/i],
    ['missing description', VALID.replace(/description:.*\n/, ''), /description/i],
    ['missing body heading', VALID.replace('# Canvas Grading Pass', 'Canvas Grading Pass'), /heading/i],
    ['block scalar description', VALID.replace(/description:.*/, 'description: |'), /block scalar/i],
  ])('rejects %s', (_label, raw, pattern) => {
    expect(() => parseSkillFile('canvas-grading-pass/SKILL.md', raw)).toThrow(pattern)
  })

  it('names the offending file in every error', () => {
    expect(() => parseSkillFile('canvas-week-plan/SKILL.md', '# nope\n')).toThrow(
      /canvas-week-plan\/SKILL\.md/,
    )
  })
})

describe('ARGUMENT_VOCABULARY', () => {
  it('is the closed set the spec defines', () => {
    expect(Object.keys(ARGUMENT_VOCABULARY).sort()).toEqual([
      'account_id',
      'assignment_id',
      'course_id',
      'quiz_id',
      'student_id',
    ])
  })

  it('gives every argument a non-empty description', () => {
    for (const [name, description] of Object.entries(ARGUMENT_VOCABULARY)) {
      expect(description.length, name).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run tests/prompts/parse.test.ts`
Expected: FAIL — cannot resolve `../../src/prompts/generate`.

- [ ] **Step 3: Write the types**

Create `src/prompts/types.ts`:

```ts
import type { ToolAudience } from '../tools/types'

/**
 * One skill as `pnpm generate:prompts` captured it from `skills/<name>/SKILL.md`.
 * Everything here is derived from the markdown — nothing is hand-maintained.
 */
export interface GeneratedSkill {
  /** Frontmatter `name`. Also the prompt name and the directory name. */
  name: string
  /** The body's first level-1 heading. */
  title: string
  /** Frontmatter `description`, verbatim. Carries the trigger phrases. */
  description: string
  /** Declared argument names, in declaration order. Each exists in ARGUMENT_VOCABULARY. */
  argumentNames: readonly string[]
  /** Audience tag driving role filtering. */
  audience: ToolAudience
  /** Registered tools with destructiveHint that the body names. Sorted, deduped. */
  writeTools: readonly string[]
  /** The markdown body with frontmatter removed, verbatim. */
  body: string
}

/** One prompt argument as advertised on `prompts/list`. Always optional. */
export interface PromptArgumentDescriptor {
  name: string
  description: string
  required: false
}

/** A skill shaped for the wire: composed description, argument descriptors, body. */
export interface PromptDefinition {
  name: string
  title: string
  description: string
  audience: ToolAudience
  writeTools: readonly string[]
  arguments: PromptArgumentDescriptor[]
  body: string
}
```

- [ ] **Step 4: Write the argument vocabulary**

Create `src/prompts/arguments.ts`:

```ts
/**
 * The closed set of prompt arguments a skill may declare. MCP prompt arguments
 * are strings on the wire, and every one of these is optional: a host that has
 * the ID in hand can prefill it, and a host that does not still gets a working
 * workflow, because every skill already knows how to ask.
 *
 * Generation fails on a name outside this table, so a frontmatter typo is a CI
 * failure rather than an undocumented argument.
 */
export const ARGUMENT_VOCABULARY: Readonly<Record<string, string>> = {
  course_id: 'Canvas course ID to run this workflow against. Omit to be asked.',
  assignment_id: 'Canvas assignment ID to scope to. Omit to be asked.',
  quiz_id: 'Canvas quiz ID to scope to. Omit to be asked.',
  account_id: 'Canvas account ID to scope to. Omit to start from the root account.',
  student_id: 'Canvas user ID of a single student to scope to. Omit for the whole class.',
}

export function isKnownArgument(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ARGUMENT_VOCABULARY, name)
}

export function describeArgument(name: string): string {
  const description = ARGUMENT_VOCABULARY[name]
  if (description === undefined) {
    throw new Error(`Unknown prompt argument "${name}".`)
  }
  return description
}
```

- [ ] **Step 5: Write the parser**

Create `src/prompts/generate.ts`:

```ts
import type { ToolAudience } from '../tools/types'
import { isKnownArgument } from './arguments'

const DELIMITER = '---'
const METADATA_KEY = 'metadata'
const AUDIENCE_KEY = 'io.github.bruchris/canvas-lms-mcp-audience'
const ARGUMENTS_KEY = 'io.github.bruchris/canvas-lms-mcp-arguments'
const AUDIENCES: readonly ToolAudience[] = ['student', 'educator', 'admin', 'shared']

export interface ParsedSkillFile {
  name: string
  title: string
  description: string
  audience: ToolAudience
  argumentNames: string[]
  body: string
}

function fail(fileName: string, message: string): never {
  throw new Error(`${fileName}: ${message}`)
}

function stripQuotes(value: string): string {
  const first = value[0]
  if ((first === '"' || first === "'") && value.length > 1 && value.endsWith(first)) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Parses the narrow slice of YAML these files actually use: single-line scalars
 * at the top level, plus a one-level `metadata:` map. Anything richer than that
 * — a block scalar, a nested sequence — throws rather than being guessed at, so
 * an unsupported construct is a build failure, never a silently dropped value.
 *
 * Unknown keys are ignored rather than rejected: the Agent Skills spec defines
 * `license`, `compatibility` and `allowed-tools`, and explicitly invites
 * third-party keys under `metadata`.
 */
export function parseSkillFile(fileName: string, raw: string): ParsedSkillFile {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== DELIMITER) {
    fail(fileName, 'missing YAML frontmatter — the file must start with "---".')
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER)
  if (closing === -1) {
    fail(fileName, 'unterminated YAML frontmatter — no closing "---".')
  }

  const top = new Map<string, string>()
  const metadata = new Map<string, string>()
  let inMetadata = false

  for (const line of lines.slice(1, closing)) {
    if (line.trim() === '') continue
    const match = line.trim().match(/^([^:]+):\s*(.*)$/)
    if (!match) {
      fail(fileName, `frontmatter line is not "key: value": ${line.trim()}`)
    }
    const key = match[1]!.trim()
    const value = stripQuotes(match[2]!.trim())
    const indented = /^\s/.test(line)

    if (indented) {
      if (!inMetadata) fail(fileName, `indented frontmatter key "${key}" outside a metadata block.`)
      metadata.set(key, value)
      continue
    }

    inMetadata = key === METADATA_KEY
    if (inMetadata) {
      if (value !== '') fail(fileName, 'metadata must be a nested map, not an inline value.')
      continue
    }
    if (value === '|' || value === '>' || value === '') {
      fail(fileName, `block scalar or empty value for "${key}" is not supported.`)
    }
    top.set(key, value)
  }

  const name = top.get('name')
  if (name === undefined) fail(fileName, 'frontmatter is missing "name".')
  const description = top.get('description')
  if (description === undefined) fail(fileName, 'frontmatter is missing "description".')

  const rawAudience = metadata.get(AUDIENCE_KEY)
  if (rawAudience === undefined) {
    fail(fileName, `frontmatter metadata is missing "${AUDIENCE_KEY}".`)
  }
  if (!AUDIENCES.includes(rawAudience as ToolAudience)) {
    fail(fileName, `unknown audience "${rawAudience}" — expected one of ${AUDIENCES.join(', ')}.`)
  }

  const argumentNames = (metadata.get(ARGUMENTS_KEY) ?? '').split(/\s+/).filter(Boolean)
  for (const argument of argumentNames) {
    if (!isKnownArgument(argument)) {
      fail(fileName, `unknown prompt argument "${argument}" — add it to ARGUMENT_VOCABULARY first.`)
    }
  }
  if (new Set(argumentNames).size !== argumentNames.length) {
    fail(fileName, `duplicate prompt argument in "${argumentNames.join(' ')}".`)
  }

  const body = lines.slice(closing + 1).join('\n').replace(/^\n+/, '').trimEnd()
  const title = body.match(/^# (.+)$/m)?.[1]?.trim()
  if (title === undefined || title === '') {
    fail(fileName, 'body has no level-1 heading ("# Title") to use as the prompt title.')
  }

  return { name, title, description, audience: rawAudience as ToolAudience, argumentNames, body }
}
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `pnpm vitest run tests/prompts/parse.test.ts`
Expected: PASS, all cases.

- [ ] **Step 7: Verify lint and types**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/prompts/types.ts src/prompts/arguments.ts src/prompts/generate.ts tests/prompts/parse.test.ts
git commit -m "feat(prompts): parse skill frontmatter and define the argument vocabulary"
```

---

## Task 2: Skill metadata, write-tool derivation, and the generated module

**Files:**

- Modify: all 16 `skills/*/SKILL.md` (frontmatter only)
- Modify: `src/prompts/generate.ts` (add derivation + emission)
- Create: `scripts/generate-prompts.ts`
- Create: `src/prompts/skills.generated.ts` (generated output, committed)
- Modify: `package.json` (add `generate:prompts` script)
- Test: `tests/prompts/generate.test.ts`

**Interfaces:**

- Consumes: `parseSkillFile`, `ParsedSkillFile` (Task 1); `getAllTools` from `src/tools`; `GeneratedSkill` from `src/prompts/types.ts`.
- Produces:
  - `deriveWriteTools(body: string, writeToolNames: ReadonlySet<string>): string[]`
  - `collectWriteToolNames(): Set<string>`
  - `buildGeneratedSkills(skillsDir?: string): GeneratedSkill[]`
  - `renderGeneratedModule(skills: readonly GeneratedSkill[]): Promise<string>`
  - `GENERATED_SKILLS: readonly GeneratedSkill[]` exported from `src/prompts/skills.generated.ts`

- [ ] **Step 1: Add the metadata block to all 16 skill files**

Insert a `metadata:` block immediately before the closing `---` of each file's frontmatter. Change nothing else. The exact values:

| File | `-audience` | `-arguments` |
| ---- | ----------- | ------------ |
| `skills/canvas-accessibility-sweep/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-admin-roster/SKILL.md` | `admin` | `account_id course_id` |
| `skills/canvas-at-risk-students/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-course-pulse/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-course-qc/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-discussion-facilitator/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-gradebook-audit/SKILL.md` | `educator` | `course_id assignment_id student_id` |
| `skills/canvas-grading-pass/SKILL.md` | `educator` | `course_id assignment_id` |
| `skills/canvas-morning-check/SKILL.md` | `educator` | *(omit the key entirely)* |
| `skills/canvas-office-hours/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-outcome-tracker/SKILL.md` | `educator` | `course_id student_id` |
| `skills/canvas-peer-review-tracker/SKILL.md` | `educator` | `course_id assignment_id` |
| `skills/canvas-quiz-review/SKILL.md` | `educator` | `course_id quiz_id student_id` |
| `skills/canvas-student-todo/SKILL.md` | `student` | *(omit the key entirely)* |
| `skills/canvas-syllabus-coach/SKILL.md` | `educator` | `course_id` |
| `skills/canvas-week-plan/SKILL.md` | `student` | *(omit the key entirely)* |

For `canvas-grading-pass`, the frontmatter becomes:

```yaml
---
name: canvas-grading-pass
description: Educator grading workflow for Canvas. Walks through ungraded submissions one at a time, applying rubric assessments and score comments with explicit confirmation before each write. Trigger phrases include "grade submissions", "start grading", "grading pass", "mark submissions", "grade this assignment", or "rubric grading".
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
---
```

For `canvas-morning-check`, which declares no arguments:

```yaml
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
```

- [ ] **Step 2: Write the failing test**

Create `tests/prompts/generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildGeneratedSkills,
  collectWriteToolNames,
  deriveWriteTools,
  renderGeneratedModule,
} from '../../src/prompts/generate'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { ARGUMENT_VOCABULARY } from '../../src/prompts/arguments'

const ROOT = resolve(__dirname, '../..')
const SKILLS_DIR = resolve(ROOT, 'skills')

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)

describe('write-tool derivation', () => {
  const writeToolNames = collectWriteToolNames()

  it('resolves backticked names that are registered write tools', () => {
    expect(deriveWriteTools('call `grade_submission` then `list_submissions`', writeToolNames)).toEqual([
      'grade_submission',
    ])
  })

  it('ignores identifiers a skill names only to say they do not exist', () => {
    // canvas-discussion-facilitator and canvas-admin-roster warn the model away
    // from tools this server does not expose. Those must never be flagged.
    const body = 'There is no `list_discussion_entries` tool, and no `get_account_tree` either.'
    expect(deriveWriteTools(body, writeToolNames)).toEqual([])
  })

  it('sorts and dedupes', () => {
    const body = '`update_page` `create_page` `update_page`'
    expect(deriveWriteTools(body, writeToolNames)).toEqual(['create_page', 'update_page'])
  })

  it('includes tools that are behind a feature flag at runtime', () => {
    expect(writeToolNames.has('submit_assignment')).toBe(true)
  })

  it('does not treat a read-only tool as a write tool', () => {
    expect(deriveWriteTools('`list_courses`', writeToolNames)).toEqual([])
  })
})

describe('GENERATED_SKILLS', () => {
  it('has one entry per skill directory, with matching names', () => {
    expect(GENERATED_SKILLS.map((skill) => skill.name).sort()).toEqual([...skillDirs].sort())
  })

  it('matches a fresh generation — regenerate with `pnpm generate:prompts`', () => {
    expect(buildGeneratedSkills()).toEqual([...GENERATED_SKILLS])
  })

  it('is byte-identical to the committed module', async () => {
    const rendered = await renderGeneratedModule(buildGeneratedSkills())
    const committed = readFileSync(resolve(ROOT, 'src/prompts/skills.generated.ts'), 'utf8')
    expect(committed).toBe(rendered)
  })

  it('carries a body that matches the file on disk after its frontmatter', () => {
    for (const skill of GENERATED_SKILLS) {
      const raw = readFileSync(join(SKILLS_DIR, skill.name, 'SKILL.md'), 'utf8')
      expect(raw, skill.name).toContain(skill.body.slice(0, 200))
      expect(skill.body, skill.name).not.toContain('io.github.bruchris/canvas-lms-mcp-audience')
    }
  })

  it('declares only vocabulary arguments and a concrete audience', () => {
    for (const skill of GENERATED_SKILLS) {
      expect(['student', 'educator', 'admin', 'shared'], skill.name).toContain(skill.audience)
      for (const argument of skill.argumentNames) {
        expect(Object.keys(ARGUMENT_VOCABULARY), skill.name).toContain(argument)
      }
    }
  })

  it('flags the skills that reach write tools and no others', () => {
    const flagged = GENERATED_SKILLS.filter((skill) => skill.writeTools.length > 0).map((s) => s.name)
    expect(flagged.sort()).toEqual([
      'canvas-admin-roster',
      'canvas-at-risk-students',
      'canvas-discussion-facilitator',
      'canvas-grading-pass',
      'canvas-office-hours',
      'canvas-peer-review-tracker',
      'canvas-quiz-review',
      'canvas-syllabus-coach',
    ])
  })

  it('names the exact write tools for the grading workflow', () => {
    const skill = GENERATED_SKILLS.find((s) => s.name === 'canvas-grading-pass')
    expect(skill?.writeTools).toEqual([
      'comment_on_submission',
      'grade_submission',
      'submit_rubric_assessment',
    ])
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm vitest run tests/prompts/generate.test.ts`
Expected: FAIL — `buildGeneratedSkills` and `src/prompts/skills.generated` do not exist.

- [ ] **Step 4: Add derivation and emission to `src/prompts/generate.ts`**

Append to `src/prompts/generate.ts` (and add the imports shown at the top):

```ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { format, resolveConfig } from 'prettier'
import { getAllTools } from '../tools'
import type { CanvasClient } from '../canvas'
import type { GeneratedSkill } from './types'
```

```ts
/**
 * Every registered tool name carrying `destructiveHint`, including the two
 * behind CANVAS_ENABLE_ASSIGNMENT_SUBMISSION. Derivation must not depend on a
 * deployer's feature flags: a skill either names a write tool or it does not.
 */
export function collectWriteToolNames(): Set<string> {
  const deep: unknown = new Proxy(function () {}, { get: () => deep, apply: () => deep })
  const tools = getAllTools(deep as CanvasClient, undefined, undefined, {
    assignmentSubmission: true,
  })
  return new Set(
    tools.filter((tool) => tool.annotations.destructiveHint === true).map((tool) => tool.name),
  )
}

/**
 * Write tools a skill body names, sorted and deduped.
 *
 * Unresolvable identifiers are ignored on purpose. Three skills deliberately
 * name tools that do not exist — "there is no `list_discussion_entries` tool" —
 * to steer the model away from them, so an identifier that does not resolve is
 * normal content, not drift.
 */
export function deriveWriteTools(body: string, writeToolNames: ReadonlySet<string>): string[] {
  const ticked = new Set([...body.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1]!))
  return [...ticked].filter((name) => writeToolNames.has(name)).sort()
}

export function buildGeneratedSkills(skillsDir = resolve('skills')): GeneratedSkill[] {
  const writeToolNames = collectWriteToolNames()
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort()
    .map((name) => {
      const path = join(skillsDir, name, 'SKILL.md')
      const parsed = parseSkillFile(`skills/${name}/SKILL.md`, readFileSync(path, 'utf8'))
      if (parsed.name !== name) {
        fail(`skills/${name}/SKILL.md`, `frontmatter name "${parsed.name}" must match its directory.`)
      }
      return {
        name: parsed.name,
        title: parsed.title,
        description: parsed.description,
        argumentNames: parsed.argumentNames,
        audience: parsed.audience,
        writeTools: deriveWriteTools(parsed.body, writeToolNames),
        body: parsed.body,
      }
    })
}

const BANNER = `// GENERATED by \`pnpm generate:prompts\` from skills/*/SKILL.md. Do not edit by hand.
// Regenerate after changing any SKILL.md; tests/prompts/generate.test.ts fails if this is stale.`

/**
 * Emits the module already prettier-formatted, so `pnpm lint`, which checks
 * every file under src/, passes on generated output without an ignore rule.
 */
export async function renderGeneratedModule(skills: readonly GeneratedSkill[]): Promise<string> {
  const source = `${BANNER}
import type { GeneratedSkill } from './types'

export const GENERATED_SKILLS: readonly GeneratedSkill[] = ${JSON.stringify(skills, null, 2)}
`
  const config = await resolveConfig(resolve('src/prompts/skills.generated.ts'))
  return format(source, { ...config, parser: 'typescript' })
}
```

- [ ] **Step 5: Write the generator script**

Create `scripts/generate-prompts.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildGeneratedSkills, renderGeneratedModule } from '../src/prompts/generate'

async function main(): Promise<void> {
  const skills = buildGeneratedSkills()
  const source = await renderGeneratedModule(skills)
  await writeFile(resolve('src/prompts/skills.generated.ts'), source, 'utf8')
  console.log(`Generated ${skills.length} skill prompts.`)
}

await main()
```

Add to `package.json#scripts`, immediately after `generate:manifests`:

```json
"generate:prompts": "tsx scripts/generate-prompts.ts",
```

- [ ] **Step 6: Generate the module**

Run: `pnpm generate:prompts`
Expected: `Generated 16 skill prompts.` and a new `src/prompts/skills.generated.ts`.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `pnpm vitest run tests/prompts`
Expected: PASS. If the write-tool list assertion fails, do not edit the assertion — read the failure, because it means a skill body changed.

- [ ] **Step 8: Verify lint, types and the round trip**

Run: `pnpm typecheck && pnpm lint`
Expected: clean, including the generated file.

Then confirm regeneration is a no-op:

```bash
pnpm generate:prompts && git diff --exit-code src/prompts/skills.generated.ts
```

Expected: exit 0, no diff.

- [ ] **Step 9: Commit**

```bash
git add skills src/prompts/generate.ts src/prompts/skills.generated.ts scripts/generate-prompts.ts package.json tests/prompts/generate.test.ts
git commit -m "feat(prompts): generate a skill prompt catalog from skills/*/SKILL.md"
```

---

## Task 3: Prompt catalog — descriptions, arguments, role filter, message text

**Files:**

- Create: `src/prompts/catalog.ts`
- Modify: `src/tools/roles.ts`
- Test: `tests/prompts/catalog.test.ts`

**Interfaces:**

- Consumes: `GENERATED_SKILLS`, `PromptDefinition`, `PromptArgumentDescriptor`, `describeArgument`, `ROLE_VISIBILITY`.
- Produces:
  - `isAudienceVisibleForRole(audience: ToolAudience | undefined, role: CanvasRole): boolean` (from `src/tools/roles.ts`)
  - `buildPromptDefinitions(role?: CanvasRole, skills?: readonly GeneratedSkill[]): PromptDefinition[]`
  - `buildPromptText(definition: PromptDefinition, supplied: Readonly<Record<string, string>>): string`
  - `PROMPT_META_KEY = 'io.github.bruchris/canvas-lms-mcp'`
  - `buildPromptMeta(definition: PromptDefinition): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Create `tests/prompts/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildPromptDefinitions,
  buildPromptMeta,
  buildPromptText,
  PROMPT_META_KEY,
} from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { ROLE_VISIBILITY } from '../../src/tools/roles'
import type { CanvasRole } from '../../src/tools/types'

function definition(name: string) {
  const found = buildPromptDefinitions().find((entry) => entry.name === name)
  if (!found) throw new Error(`No prompt named ${name}`)
  return found
}

describe('buildPromptDefinitions', () => {
  it('returns every skill when no role is set', () => {
    expect(buildPromptDefinitions()).toHaveLength(GENERATED_SKILLS.length)
  })

  it.each(['student', 'teacher', 'admin'] as const)(
    'filters to exactly the audiences %s can see',
    (role: CanvasRole) => {
      const visible = ROLE_VISIBILITY[role]
      const expected = GENERATED_SKILLS.filter((skill) => visible.has(skill.audience))
        .map((skill) => skill.name)
        .sort()
      expect(buildPromptDefinitions(role).map((entry) => entry.name).sort()).toEqual(expected)
    },
  )

  it('uses the body heading as the title', () => {
    expect(definition('canvas-grading-pass').title).toBe('Canvas Grading Pass')
  })

  it('appends a write-tool sentence only to skills that reach write tools', () => {
    const writing = definition('canvas-grading-pass')
    expect(writing.description).toContain(
      'Uses write tools: comment_on_submission, grade_submission, submit_rubric_assessment.',
    )
    expect(writing.description).toContain('confirm before each write')

    const reading = definition('canvas-week-plan')
    expect(reading.description).not.toContain('Uses write tools')
    expect(reading.description).toBe(
      GENERATED_SKILLS.find((skill) => skill.name === 'canvas-week-plan')?.description,
    )
  })

  it('describes every declared argument as optional, in declaration order', () => {
    const entry = definition('canvas-grading-pass')
    expect(entry.arguments.map((argument) => argument.name)).toEqual(['course_id', 'assignment_id'])
    for (const argument of entry.arguments) {
      expect(argument.required).toBe(false)
      expect(argument.description.length).toBeGreaterThan(0)
    }
  })

  it('gives an argument-free skill an empty argument list', () => {
    expect(definition('canvas-morning-check').arguments).toEqual([])
  })
})

describe('buildPromptText', () => {
  const entry = definition('canvas-grading-pass')

  it('returns the body unchanged when nothing is supplied', () => {
    expect(buildPromptText(entry, {})).toBe(entry.body)
  })

  it('prepends one context block naming each supplied argument', () => {
    const text = buildPromptText(entry, { course_id: '42', assignment_id: '7' })
    expect(text).toBe(
      `Context supplied by the user:\n- course_id: 42\n- assignment_id: 7\n\n${entry.body}`,
    )
  })

  it('keeps declaration order regardless of the order supplied', () => {
    const text = buildPromptText(entry, { assignment_id: '7', course_id: '42' })
    expect(text.indexOf('course_id')).toBeLessThan(text.indexOf('assignment_id'))
  })

  it('ignores blank and whitespace-only values', () => {
    expect(buildPromptText(entry, { course_id: '', assignment_id: '   ' })).toBe(entry.body)
  })

  it('trims a supplied value', () => {
    expect(buildPromptText(entry, { course_id: '  42  ' })).toContain('- course_id: 42\n')
  })

  it('ignores a value for an argument this prompt does not declare', () => {
    expect(buildPromptText(definition('canvas-morning-check'), { course_id: '42' })).toBe(
      definition('canvas-morning-check').body,
    )
  })
})

describe('buildPromptMeta', () => {
  it('namespaces audience and write tools under the server key', () => {
    expect(buildPromptMeta(definition('canvas-grading-pass'))).toEqual({
      [PROMPT_META_KEY]: {
        audience: 'educator',
        writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
      },
    })
  })

  it('reports an empty write-tool list for a read-only workflow', () => {
    const meta = buildPromptMeta(definition('canvas-week-plan'))
    expect(meta[PROMPT_META_KEY]).toEqual({ audience: 'student', writeTools: [] })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run tests/prompts/catalog.test.ts`
Expected: FAIL — cannot resolve `../../src/prompts/catalog`.

- [ ] **Step 3: Share the role-visibility table**

In `src/tools/roles.ts`, replace the body of `isVisibleForRole` and add the new export above it:

```ts
/** Whether an audience tag is visible to the given role. */
export function isAudienceVisibleForRole(
  audience: ToolAudience | undefined,
  role: CanvasRole,
): boolean {
  return ROLE_VISIBILITY[role].has(audience ?? 'shared')
}

/** Whether a tool is visible to the given role. */
export function isVisibleForRole(tool: ToolDefinition, role: CanvasRole): boolean {
  return isAudienceVisibleForRole(tool.audience, role)
}
```

This is a pure extraction — `isVisibleForRole` keeps its exact behaviour, so
`tests/tools/role-filter.test.ts` must stay green unchanged.

- [ ] **Step 4: Write the catalog**

Create `src/prompts/catalog.ts`:

```ts
import { describeArgument } from './arguments'
import { GENERATED_SKILLS } from './skills.generated'
import type { GeneratedSkill, PromptArgumentDescriptor, PromptDefinition } from './types'
import { isAudienceVisibleForRole } from '../tools/roles'
import type { CanvasRole } from '../tools/types'

/** Reverse-DNS `_meta` namespace, matching package.json#mcpName. */
export const PROMPT_META_KEY = 'io.github.bruchris/canvas-lms-mcp'

/**
 * A host showing the picker to a person reads the description; one deciding
 * whether to offer the workflow at all reads `_meta`. Both say the same thing,
 * and both are derived, so neither can drift from the tool registry.
 */
function composeDescription(skill: GeneratedSkill): string {
  if (skill.writeTools.length === 0) return skill.description
  return (
    `${skill.description} Uses write tools: ${skill.writeTools.join(', ')}. ` +
    'The workflow asks you to confirm before each write.'
  )
}

function describeArguments(skill: GeneratedSkill): PromptArgumentDescriptor[] {
  return skill.argumentNames.map((name) => ({
    name,
    description: describeArgument(name),
    required: false,
  }))
}

/**
 * Prompt definitions for a role, or every one when the role is unset — the same
 * filter `getAllTools` applies to tools, reading the same visibility table, so a
 * host is never offered a workflow whose tools its role filter hides.
 *
 * Like the tool filter, this is UX and context reduction, not a security
 * boundary: Canvas enforces permissions server-side, and a prompt is inert text.
 */
export function buildPromptDefinitions(
  role?: CanvasRole,
  skills: readonly GeneratedSkill[] = GENERATED_SKILLS,
): PromptDefinition[] {
  return skills
    .filter((skill) => !role || isAudienceVisibleForRole(skill.audience, role))
    .map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: composeDescription(skill),
      audience: skill.audience,
      writeTools: skill.writeTools,
      arguments: describeArguments(skill),
      body: skill.body,
    }))
}

/**
 * The prompt text: the skill body, with a context block prepended only when the
 * caller supplied something. The block says the value came from the user rather
 * than asserting it is correct — the workflow's own steps still validate it.
 */
export function buildPromptText(
  definition: PromptDefinition,
  supplied: Readonly<Record<string, string>>,
): string {
  const lines = definition.arguments
    .map((argument) => [argument.name, supplied[argument.name]?.trim() ?? ''] as const)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `- ${name}: ${value}`)

  if (lines.length === 0) return definition.body
  return `Context supplied by the user:\n${lines.join('\n')}\n\n${definition.body}`
}

export function buildPromptMeta(definition: PromptDefinition): Record<string, unknown> {
  return {
    [PROMPT_META_KEY]: {
      audience: definition.audience,
      writeTools: [...definition.writeTools],
    },
  }
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `pnpm vitest run tests/prompts/catalog.test.ts tests/tools/role-filter.test.ts`
Expected: PASS for both — the role-filter suite proves the extraction changed no behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/catalog.ts src/tools/roles.ts tests/prompts/catalog.test.ts
git commit -m "feat(prompts): build prompt definitions with role filtering and write-tool marking"
```

---

## Task 4: Register the prompt surface on the server

**Files:**

- Create: `src/prompts/index.ts`
- Modify: `src/server.ts`
- Test: `tests/prompts/wire.test.ts`

**Interfaces:**

- Consumes: `buildPromptDefinitions`, `buildPromptText`, `buildPromptMeta` (Task 3).
- Produces: `registerAllPrompts(server: McpServer, role?: CanvasRole): void`

- [ ] **Step 1: Write the failing test**

Create `tests/prompts/wire.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerAllPrompts } from '../../src/prompts'
import { buildPromptDefinitions, PROMPT_META_KEY } from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { createCanvasMCPServer } from '../../src/server'
import { ROLE_VISIBILITY } from '../../src/tools/roles'
import type { CanvasRole } from '../../src/tools/types'

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function promptServer(role?: CanvasRole): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  registerAllPrompts(server, role)
  return connect(server)
}

function textOf(result: { messages: { content: unknown }[] }): string {
  const content = result.messages[0]?.content as { type: string; text: string }
  expect(content.type).toBe('text')
  return content.text
}

describe('prompts/list', () => {
  it('advertises every skill with title, description and arguments', async () => {
    const client = await promptServer()
    const { prompts } = await client.listPrompts()

    expect(prompts).toHaveLength(GENERATED_SKILLS.length)
    const grading = prompts.find((prompt) => prompt.name === 'canvas-grading-pass')
    expect(grading?.title).toBe('Canvas Grading Pass')
    expect(grading?.description).toContain('Uses write tools:')
    expect(grading?.arguments).toEqual([
      {
        name: 'course_id',
        description: 'Canvas course ID to run this workflow against. Omit to be asked.',
        required: false,
      },
      {
        name: 'assignment_id',
        description: 'Canvas assignment ID to scope to. Omit to be asked.',
        required: false,
      },
    ])
  })

  it('carries namespaced _meta through the wire', async () => {
    const client = await promptServer()
    const { prompts } = await client.listPrompts()
    const grading = prompts.find((prompt) => prompt.name === 'canvas-grading-pass')

    expect(grading?._meta?.[PROMPT_META_KEY]).toEqual({
      audience: 'educator',
      writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
    })
  })
})

describe('prompts/get', () => {
  it('succeeds when the client omits the arguments key entirely', async () => {
    // Regression gate. `arguments` is optional in the MCP schema, but
    // McpServer.registerPrompt parses it against an object schema, so a prompt
    // with a declared argsSchema rejects this call. This test fails against any
    // registerPrompt-based implementation — that is the point.
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-grading-pass' })

    expect(textOf(result)).toContain('# Canvas Grading Pass')
    expect(textOf(result)).not.toContain('Context supplied by the user')
  })

  it('accepts an empty arguments object', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-grading-pass', arguments: {} })
    expect(textOf(result)).not.toContain('Context supplied by the user')
  })

  it('prepends a context block for supplied arguments', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({
      name: 'canvas-grading-pass',
      arguments: { course_id: '42' },
    })

    expect(textOf(result)).toContain('Context supplied by the user:\n- course_id: 42\n')
  })

  it('returns the body byte-identical to the generated skill', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-week-plan' })
    const skill = GENERATED_SKILLS.find((entry) => entry.name === 'canvas-week-plan')

    expect(textOf(result)).toBe(skill?.body)
  })

  it('returns one user-role message and the composed description', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-week-plan' })
    const expected = buildPromptDefinitions().find((entry) => entry.name === 'canvas-week-plan')

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')
    expect(result.description).toBe(expected?.description)
  })

  it('rejects an unknown argument name', async () => {
    const client = await promptServer()
    await expect(
      client.getPrompt({ name: 'canvas-grading-pass', arguments: { bogus: 'x' } }),
    ).rejects.toThrow(/bogus/)
  })

  it('rejects an unknown prompt name', async () => {
    const client = await promptServer()
    await expect(client.getPrompt({ name: 'no-such-prompt' })).rejects.toThrow(/not found/i)
  })

  it('rejects a prompt the configured role cannot see', async () => {
    const client = await promptServer('student')
    await expect(client.getPrompt({ name: 'canvas-grading-pass' })).rejects.toThrow(/not found/i)
  })
})

describe('role filtering', () => {
  it.each(['student', 'teacher', 'admin'] as const)(
    'registers exactly the prompts %s can see',
    async (role: CanvasRole) => {
      const client = await promptServer(role)
      const visible = ROLE_VISIBILITY[role]
      const expected = GENERATED_SKILLS.filter((skill) => visible.has(skill.audience))
        .map((skill) => skill.name)
        .sort()

      const { prompts } = await client.listPrompts()
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual(expected)
    },
  )

  it('declares no prompts capability when the catalog is empty', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    server.registerTool('noop', { description: 'noop', inputSchema: {} }, () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }))
    registerAllPrompts(server, undefined, [])
    const client = await connect(server)

    expect(client.getServerCapabilities()?.prompts).toBeUndefined()
    await expect(client.listPrompts()).rejects.toThrow(/method not found/i)
  })
})

describe('createCanvasMCPServer', () => {
  it('advertises prompts alongside tools and resources', async () => {
    const { server } = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    const client = await connect(server)
    const capabilities = client.getServerCapabilities()

    expect(capabilities?.prompts).toBeDefined()
    expect(capabilities?.tools).toBeDefined()
    expect(capabilities?.resources).toBeDefined()
    expect((await client.listPrompts()).prompts).toHaveLength(GENERATED_SKILLS.length)
  })

  it('applies the configured role to prompts as well as tools', async () => {
    const { server } = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      role: 'student',
    })
    const client = await connect(server)
    const { prompts } = await client.listPrompts()

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'canvas-student-todo',
      'canvas-week-plan',
    ])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run tests/prompts/wire.test.ts`
Expected: FAIL — cannot resolve `../../src/prompts`.

- [ ] **Step 3: Write the registrar**

Create `src/prompts/index.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { buildPromptDefinitions, buildPromptMeta, buildPromptText } from './catalog'
import type { GeneratedSkill, PromptDefinition } from './types'
import type { CanvasRole } from '../tools/types'

export { buildPromptDefinitions, PROMPT_META_KEY } from './catalog'

/**
 * Registers the prompt surface directly on the underlying `Server` rather than
 * through `McpServer.registerPrompt`.
 *
 * The reason is concrete: `registerPrompt` parses `request.params.arguments`
 * against an object schema, so a prompt that declares any argument rejects
 * `prompts/get` when the client omits `arguments` — which the MCP schema allows
 * and the SDK's own client does. Owning the handlers is what lets this server
 * both advertise arguments and honour that call. `tests/prompts/wire.test.ts`
 * pins the behaviour.
 *
 * Must run before the server is connected: `registerCapabilities` throws once a
 * transport is attached, and `setRequestHandler` refuses a method whose
 * capability has not been declared — hence the ordering below.
 */
export function registerAllPrompts(
  server: McpServer,
  role?: CanvasRole,
  skills?: readonly GeneratedSkill[],
): void {
  const definitions = buildPromptDefinitions(role, skills)
  // No prompts means no `prompts` capability at all, so capability negotiation
  // stays honest rather than advertising an empty surface.
  if (definitions.length === 0) return

  const byName = new Map<string, PromptDefinition>(
    definitions.map((definition) => [definition.name, definition]),
  )

  server.server.registerCapabilities({ prompts: { listChanged: false } })

  server.server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: definitions.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      arguments: definition.arguments,
      _meta: buildPromptMeta(definition),
    })),
  }))

  server.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const definition = byName.get(request.params.name)
    if (!definition) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`)
    }

    const supplied = request.params.arguments ?? {}
    const declared = new Set(definition.arguments.map((argument) => argument.name))
    const unknown = Object.keys(supplied).filter((name) => !declared.has(name))
    if (unknown.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown argument(s) for prompt ${definition.name}: ${unknown.join(', ')}`,
      )
    }

    return {
      description: definition.description,
      _meta: buildPromptMeta(definition),
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: buildPromptText(definition, supplied) },
        },
      ],
    }
  })
}
```

- [ ] **Step 4: Wire it into the server factory**

In `src/server.ts`, add the import next to the resources import:

```ts
import { registerAllPrompts } from './prompts'
```

and call it immediately after `registerAllResources`, inside `createCanvasMCPServer`:

```ts
  registerAllTools(server, canvas, pseudonymizer, config.role, features)
  registerAllResources(server, canvas)
  registerAllPrompts(server, config.role)
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `pnpm vitest run tests/prompts tests/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: PASS — in particular `tests/http.test.ts`, `tests/stdio.test.ts` and
`tests/discovery/audience-runtime-parity.test.ts`, which construct servers through the same factory.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/index.ts src/server.ts tests/prompts/wire.test.ts
git commit -m "feat(prompts): serve the 16 Agent Skills over prompts/list and prompts/get"
```

---

## Task 5: Ship `skills/` to npm, document the surface, gate the count

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/agent-discovery.md`
- Modify: `.claude/CLAUDE.md`
- Modify: `tests/docs/skill-count-consistency.test.ts`

**Interfaces:**

- Consumes: `buildPromptDefinitions` (Task 3).
- Produces: nothing new in code.

- [ ] **Step 1: Write the failing test**

Append to `tests/docs/skill-count-consistency.test.ts`, inside the existing top-level
`describe('skill-count consistency', …)` block:

```ts
  it('registers one MCP prompt per skill directory', async () => {
    const { buildPromptDefinitions } = await import('../../src/prompts/catalog')
    expect(
      buildPromptDefinitions().length,
      `skills/ has ${SKILL_COUNT} directories with a SKILL.md but the generated prompt catalog has a different count — run \`pnpm generate:prompts\``,
    ).toBe(SKILL_COUNT)
  })

  it('ships skills/ to npm consumers', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('skills/')
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run tests/docs/skill-count-consistency.test.ts`
Expected: the `skills/` assertion FAILS (`files` is `["bin/", "dist/"]`); the prompt-count
assertion passes.

- [ ] **Step 3: Ship the skills directory**

In `package.json`, change `files` to:

```json
  "files": [
    "bin/",
    "dist/",
    "skills/"
  ],
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `pnpm vitest run tests/docs/skill-count-consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the prompt surface in the README**

In `README.md`, replace the closing paragraph of the `## Agent Skills` section — the line
beginning "Skills are markdown workflow files (no extra dependencies)." — with:

```markdown
Skills are markdown workflow files (no extra dependencies). They work with the MCP server you already have installed. See the [`skills/` directory](./skills/) for the full list.

The same 16 workflows are also served over MCP as [prompts](https://modelcontextprotocol.io/docs/concepts/prompts), so a host without a skill-file loader — Claude Desktop, ChatGPT, or an application embedding this server in-process — can list them with `prompts/list` and fetch one with `prompts/get`. Each prompt advertises optional `course_id`-style arguments a host can prefill, and marks the workflows that reach write tools. Prompts are inert templates the user chooses: selecting one grants the model no tool authority it did not already have.
```

- [ ] **Step 6: Document generation in the agent-discovery doc**

In `docs/agent-discovery.md`, append a section after "## Regenerating":

~~~~markdown
## MCP prompts

The 16 Agent Skills under `skills/` are also registered as MCP prompts, so a host can discover
them over the protocol instead of through a client-side skill loader. `skills/*/SKILL.md` stays
the single source of truth: `src/prompts/skills.generated.ts` is generated from it, and
`tests/prompts/generate.test.ts` fails when the two disagree.

Each skill declares its audience and its prompt arguments in `SKILL.md` frontmatter, under the
Agent Skills specification's optional `metadata` field:

```yaml
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
```

Argument names come from a closed vocabulary in `src/prompts/arguments.ts`; generation fails on a
name outside it. The write tools a workflow reaches are derived from the body at generation time
and published both in the prompt description and under `_meta`.

Regenerate after changing any `SKILL.md`:

```bash
pnpm generate:prompts
```
~~~~

- [ ] **Step 7: Document adding a skill in CLAUDE.md**

In `.claude/CLAUDE.md`, add a section immediately after "## How to Add a New Tool":

```markdown
## How to Add a New Skill

1. Create `skills/<name>/SKILL.md` with frontmatter `name` (matching the directory) and
   `description` (carrying the trigger phrases), then a body whose first line is `# Title`.
2. Declare the audience and any arguments in frontmatter `metadata`, using the two namespaced
   keys `io.github.bruchris/canvas-lms-mcp-audience` (`student` | `educator` | `admin` | `shared`)
   and `io.github.bruchris/canvas-lms-mcp-arguments` (space-separated). Argument names must exist
   in `ARGUMENT_VOCABULARY` in `src/prompts/arguments.ts`.
3. Run `pnpm generate:prompts` and commit `src/prompts/skills.generated.ts`. CI
   (`tests/prompts/generate.test.ts`) fails if it is stale.
4. Update the skill counts CI checks in `tests/docs/skill-count-consistency.test.ts` cover:
   `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `docs/index.html`.

Write tools are **derived** from the body, never declared — a body may safely name a tool that
does not exist ("there is no `list_discussion_entries` tool"); unresolvable names are ignored.
```

- [ ] **Step 8: Run the full validation suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all clean.

- [ ] **Step 9: Verify the published package would contain the skills**

Run: `npm pack --dry-run 2>&1 | grep -c "skills/"`
Expected: 16 or more (one line per `SKILL.md`).

- [ ] **Step 10: Commit**

```bash
git add package.json README.md docs/agent-discovery.md .claude/CLAUDE.md tests/docs/skill-count-consistency.test.ts
git commit -m "docs(prompts): document the MCP prompt surface and ship skills/ to npm"
```

---

## Task 6: Open the pull request

- [ ] **Step 1: Confirm the branch is clean and rebased**

```bash
git status --short
git fetch origin && git rev-list --left-right --count origin/main...HEAD
```

Expected: no uncommitted changes; a left count of 0 (if not, rebase onto `origin/main`).

- [ ] **Step 2: Re-run the full validation suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all clean. Do not open the PR on a red suite.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/issue-355-skills-as-mcp-prompts
gh pr create --title "feat(prompts): advertise the 16 Agent Skills as MCP prompts" --body "..."
```

The body must state: what the change adds, that `skills/` stays the source of truth, the
`registerPrompt` finding from the spec and why the handlers are owned directly, the role-filter
counts, and a link to issue #355. End it with the required attribution line. **Do not merge.**

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| ------------ | ---- |
| §1.1 own the handlers; missing-`arguments` gate | Task 4 (step 3, and the regression test in step 1) |
| §1.2 derive write tools, ignore unresolvable names | Task 2 (steps 2 and 4) |
| §1.3 `_meta` published alongside prose | Task 3 (`buildPromptMeta`), Task 4 (both handlers) |
| §2 generated module architecture | Tasks 1 and 2 |
| §3 frontmatter contract, the 16 assignments | Task 2 step 1 |
| §3.2 argument vocabulary | Task 1 step 4 |
| §4 prompt surface shape | Tasks 3 and 4 |
| §5 role filtering, honest capability | Task 3 (filter), Task 4 (capability guard) |
| §6 `skills/` in `files`, no mcpb/server.json change | Task 5 (nothing touches those files) |
| §7 test plan, all 17 items | Tasks 1–5 |
| §8 implementation checklist, all 11 items | Tasks 1–5 |

Spec §7 item 12 (body byte-identical) is Task 4 step 1. Item 14 (capability merge) is the
`createCanvasMCPServer` block in Task 4. Item 17 (count gate) is Task 5 step 1.

**Type consistency check**

`GeneratedSkill`, `PromptDefinition` and `PromptArgumentDescriptor` are defined once in Task 1 and
used unchanged in Tasks 2–4. `buildPromptDefinitions(role?, skills?)` keeps the same two-parameter
shape in Tasks 3, 4 and 5. `registerAllPrompts(server, role?, skills?)` takes the third parameter
only so the empty-catalog test can construct that case; `src/server.ts` calls it with two.
`isAudienceVisibleForRole` is introduced in Task 3 and used only there.
