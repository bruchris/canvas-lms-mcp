import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import { getAllTools } from '../../src/tools'
import type { ToolAnnotations, ToolFeatureFlags } from '../../src/tools/types'
import type { ToolOutputContract } from '../../src/tools/output/contract'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// CI ratchet for docs/tool-description-standard.md (BRU-3041 / Glama TDQS).
// Glama's Tool Definition Quality scoring flagged that most of this repo's
// tool descriptions are thin one-liners (see the standard doc for the
// evidence). Rewriting all of them is a separate effort; this file is the
// guardrail that stops the problem from getting worse while that happens.
//
// Rules R1-R5 below are a mechanical subset of the full standard — the parts
// that are checkable without a rubric model. A tool listed in
// description-quality.baseline.json is pre-existing debt and is allowed to
// keep violating whatever rules are recorded there. Any tool NOT in the
// baseline must pass every rule, and any baselined tool whose description is
// fixed must be removed from the baseline in the same PR (see "Updating the
// baseline" in docs/tool-description-standard.md).

function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

interface DescribedTool {
  name: string
  description: string
  annotations: ToolAnnotations
  output?: ToolOutputContract
}

const NON_TOOL_TOKENS = new Set(['search_term', 'score_statistics'])

const VERB_NOUN =
  /\b(list|get|create|update|delete|set|search|find|view|audit|explain|project|submit|post|grade|score|send|enroll|remove|resolve|upload|download|check|add|apply|attach)_[a-z0-9_]+\b/g
const SNAKE_TOKEN = /\b[a-z]+(?:_[a-z0-9]+)+\b/g

/**
 * Pure rule evaluator — no registry access, so it can be exercised directly
 * against a synthetic tool (see "a new low-quality description" test below)
 * as well as against every real registered tool.
 */
function ruleViolations(tool: DescribedTool, registeredNames: ReadonlySet<string>): string[] {
  const violations: string[] = []
  const desc = tool.description
  const isWrite = tool.annotations.readOnlyHint !== true

  // R1: length floor (write tools need more room for S3's extra clauses) and ceiling.
  const minLen = isWrite ? 200 : 150
  if (desc.length < minLen || desc.length > 1600) violations.push('R1')

  // R2: must name at least one OTHER registered tool (S2).
  const snakeTokens = [...desc.matchAll(SNAKE_TOKEN)].map((m) => m[0])
  const namesSibling = snakeTokens.some((tok) => tok !== tool.name && registeredNames.has(tok))
  if (!namesSibling) violations.push('R2')

  // R3: every verb_noun-shaped token must resolve to a real tool (catches
  // stale/invented references like the old create_new_quiz -> create_quiz).
  const verbNounTokens = [...desc.matchAll(VERB_NOUN)].map((m) => m[0])
  const badVerbNoun = verbNounTokens.some(
    (tok) => !registeredNames.has(tok) && !NON_TOOL_TOKENS.has(tok),
  )
  if (badVerbNoun) violations.push('R3')

  // R4: write tools must state the return value (or declare an output
  // contract) and the required permission (S3).
  if (isWrite) {
    const hasReturns = /\breturns?\b/i.test(desc)
    const hasPermission = /(requires?|permission|instructor|teacher|admin)/i.test(desc)
    if (!hasReturns && !tool.output) violations.push('R4a')
    if (!hasPermission) violations.push('R4b')
  }

  // R5: list tools must mention pagination behavior (S4).
  if (tool.name.startsWith('list_')) {
    const hasPagination = /(pagin|every page|all pages|at most|capped|truncat)/i.test(desc)
    if (!hasPagination) violations.push('R5')
  }

  return violations
}

const ROOT = resolve(__dirname, '../..')
const baseline = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/tools/description-quality.baseline.json'), 'utf8'),
) as Record<string, string[]>

// Register every tool the server can ever produce: every feature-gated
// domain enabled, and the pseudonymizer on with reverse lookup (which is what
// surfaces resolve_pseudonym), so nothing escapes the check by being gated.
const ALL_FEATURES: ToolFeatureFlags = { assignmentSubmission: true }
const ps = new Pseudonymizer({
  baseUrl: 'https://h.example/api/v1',
  env: {
    CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
    CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
  },
})
const tools = getAllTools(mockCanvas(), ps, undefined, ALL_FEATURES)
const registeredNames = new Set(tools.map((t) => t.name))

describe('description quality ratchet', () => {
  it('anti-vacuity: enough tools are registered for this gate to mean something', () => {
    expect(tools.length).toBeGreaterThan(150)
  })

  it('every baseline entry still references a currently registered tool', () => {
    const orphans = Object.keys(baseline).filter((name) => !registeredNames.has(name))
    expect(
      orphans,
      `tests/tools/description-quality.baseline.json lists tool(s) that no longer exist: ` +
        `${orphans.join(', ')} — remove the stale entry`,
    ).toEqual([])
  })

  it.each(tools.map((t) => t.name))(
    'tool `%s` passes every rule, or is covered by the baseline',
    (name) => {
      const tool = tools.find((t) => t.name === name)!
      const violations = ruleViolations(tool, registeredNames)
      if (baseline[name]) {
        // Baselined debt: must still violate something, or the entry is stale.
        expect(
          violations.length,
          `"${name}" is in description-quality.baseline.json but its description now passes ` +
            `every rule — remove its entry from the baseline (the baseline can only shrink)`,
        ).toBeGreaterThan(0)
      } else {
        expect(
          violations,
          `"${name}" is not in description-quality.baseline.json but violates rule(s) ` +
            `${violations.join(', ')} — fix the description per docs/tool-description-standard.md, ` +
            `or (not recommended) add it to the baseline with a reason`,
        ).toEqual([])
      }
    },
  )

  describe('ruleViolations (unit, no registry dependency)', () => {
    it('flags a new low-quality one-line CRUD description', () => {
      const weak: DescribedTool = {
        name: 'create_widget',
        description: 'Create a new widget.',
        annotations: { destructiveHint: true, openWorldHint: true },
      }
      const violations = ruleViolations(weak, registeredNames)
      expect(violations).toContain('R1') // too short for a write tool
      expect(violations).toContain('R2') // names no sibling
      expect(violations).toContain('R4a') // no return value / output contract
      expect(violations).toContain('R4b') // no permission statement
    })

    it('passes a description that satisfies every applicable rule', () => {
      const good: DescribedTool = {
        name: 'create_widget',
        description:
          'Create a new widget in a course and return the created widget object (id, name, ' +
          'created_at). Not idempotent: each call creates another widget, so check list_widgets ' +
          'with a search term before retrying. Use update_widget to change an existing widget and ' +
          'delete_widget to remove it. Requires permission to manage widgets in the course.',
        annotations: { destructiveHint: true, openWorldHint: true },
      }
      const names = new Set([...registeredNames, 'list_widgets', 'update_widget', 'delete_widget'])
      expect(ruleViolations(good, names)).toEqual([])
    })

    it('R5 flags a list tool with no pagination statement', () => {
      const noPagination: DescribedTool = {
        name: 'list_widgets',
        description:
          'List every widget visible to the caller in a course, returning widget objects (id, ' +
          'name, created_at). Use get_widget to fetch one by ID.',
        annotations: { readOnlyHint: true, openWorldHint: true },
      }
      const names = new Set([...registeredNames, 'get_widget'])
      expect(ruleViolations(noPagination, names)).toContain('R5')
    })
  })
})
