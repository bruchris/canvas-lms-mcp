import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { CanvasHttpClient } from '../../src/canvas/client'
import { ModulesModule } from '../../src/canvas/modules'
import type { CanvasModule, CanvasModuleItem } from '../../src/canvas/types'

/**
 * BRU-3103 Stage 1 of the student course requirement graph
 * (`docs/superpowers/specs/2026-10-15-bru-2952-student-course-requirement-graph.md`
 * §12 PR 1): types and requests only, no tool.
 *
 * ## Why half of this is a source-level guard
 *
 * Stage 1's central claim is a *declaration* — `CanvasCompletionRequirement.completed`
 * is **optional**, so every consumer is forced to handle the absent case (§1.3). There
 * is no behavioural substitute for that, and `pnpm typecheck` cannot stand in either:
 * this repo's `tsconfig.json` sets `"exclude": ["node_modules", "dist", "tests"]`, so a
 * type-level assertion written in `tests/` is never typechecked by CI and would be
 * decoration. A guard that parses `src/canvas/types.ts` fails on the day the `?` is
 * dropped, whether or not any consumer happens to exercise it.
 *
 * Following `tests/canvas/id-declaration-guard.test.ts`, the walk takes
 * `{ fileName, text }` rather than reading the tree itself, so the same code that
 * polices `src/` also runs over injected fixture strings below. That is what makes "the
 * guard is green" mean something: the injections prove it produces a failure on the
 * defects it exists to catch, and the floors prove it is looking at a non-empty tree.
 *
 * ## Red-first accounting
 *
 * Everything in `describe('declaration guard over src/canvas/types.ts')` was red before
 * this PR — none of the declarations existed. The injection cases and the §5.1
 * nearest-neighbour control are **not** red-first: they are unit tests of the guard and
 * characterization of `paginate`, and they are labelled as such.
 *
 * Every fixture below cites the Canvas file it was derived from, at
 * `instructure/canvas-lms` `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c` — re-fetched and
 * byte-compared against `master` while writing this PR, no drift. A fixture with no
 * citation is an assumption wearing a test's clothes.
 */

const TYPES_PATH = resolve(__dirname, '..', '..', 'src', 'canvas', 'types.ts')

interface SourceInput {
  fileName: string
  text: string
}

interface MemberShape {
  /** Declared with a `?`. */
  optional: boolean
  /** Verbatim source text of the member's type annotation. */
  typeText: string
}

/** Every `interface` in the input, by name, with each member's optionality. */
function readInterfaces(src: SourceInput): Map<string, Map<string, MemberShape>> {
  const sf = ts.createSourceFile(src.fileName, src.text, ts.ScriptTarget.Latest, true)
  const out = new Map<string, Map<string, MemberShape>>()
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      const members = new Map<string, MemberShape>()
      for (const m of node.members) {
        if (!ts.isPropertySignature(m) || !m.name) continue
        members.set(m.name.getText(sf), {
          optional: m.questionToken !== undefined,
          typeText: m.type ? m.type.getText(sf) : '',
        })
      }
      out.set(node.name.getText(sf), members)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * The constituents of a `type X = 'a' | 'b'` union alias, or `null` when the alias is
 * absent or is not a union of string literals.
 */
function readStringUnion(src: SourceInput, aliasName: string): string[] | null {
  const sf = ts.createSourceFile(src.fileName, src.text, ts.ScriptTarget.Latest, true)
  let found: string[] | null = null
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.getText(sf) === aliasName) {
      const parts = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type]
      const literals: string[] = []
      for (const p of parts) {
        if (ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal)) literals.push(p.literal.text)
      }
      found = literals.length > 0 ? literals : null
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function liveTypes(): SourceInput {
  return { fileName: TYPES_PATH, text: readFileSync(TYPES_PATH, 'utf8') }
}

/**
 * The validated set from `ContextModule#validate_completion_requirements` — the three
 * name-only types plus `scoreable_types = %w[must_submit min_score min_percentage]`.
 * Six, not the five the docs page foregrounds (§1.1).
 */
const CANVAS_SIX_REQUIREMENT_TYPES = [
  'must_view',
  'must_contribute',
  'must_submit',
  'must_mark_done',
  'min_score',
  'min_percentage',
]

describe('declaration guard over src/canvas/types.ts', () => {
  it('finds a non-empty tree (anti-vacuity floor)', () => {
    const ifaces = readInterfaces(liveTypes())
    expect(ifaces.size).toBeGreaterThan(50)
    expect(ifaces.has('CanvasCompletionRequirement')).toBe(true)
    expect(ifaces.has('CanvasModuleItemContentDetails')).toBe(true)
  })

  it('declares exactly the six Canvas-validated requirement types', () => {
    const union = readStringUnion(liveTypes(), 'CanvasCompletionRequirementType')
    expect(union).not.toBeNull()
    expect([...(union ?? [])].sort()).toEqual([...CANVAS_SIX_REQUIREMENT_TYPES].sort())
  })

  it('declares completion_requirement.completed OPTIONAL — the §1.3 absence', () => {
    const cr = readInterfaces(liveTypes()).get('CanvasCompletionRequirement')
    expect(cr).toBeDefined()
    // `type` is unconditional in `module_item_json`; the rest are not.
    expect(cr?.get('type')?.optional).toBe(false)
    expect(cr?.get('completed')?.optional).toBe(true)
    expect(cr?.get('min_score')?.optional).toBe(true)
    expect(cr?.get('min_percentage')?.optional).toBe(true)
  })

  it('declares every truthiness-dropped content_details field optional (§5.5)', () => {
    const cd = readInterfaces(liveTypes()).get('CanvasModuleItemContentDetails')
    expect(cd).toBeDefined()
    // `if (val = item.try(attr))` drops `locked: false` and `points_possible: 0`.
    for (const field of ['locked', 'points_possible', 'hidden', 'due_at']) {
      expect(cd?.get(field)?.optional, `${field} must be optional`).toBe(true)
    }
    // `locked_json` always sets this one, but it only arrives with
    // `include[]=content_details`, so it is optional on the item too.
    expect(cd?.get('locked_for_user')?.optional).toBe(true)
    expect(cd?.get('lock_explanation')?.optional).toBe(true)
  })

  it('declares the module requirement fields, with requirement_count withholdable (§1.2)', () => {
    const mod = readInterfaces(liveTypes()).get('CanvasModule')
    expect(mod).toBeDefined()
    // Serialized unconditionally by `module_json`, but only reaches us on the calls
    // that request modules, so still optional on the type.
    expect(mod?.get('requirement_type')?.typeText).toBe("'all' | 'one'")
    // The integer is behind `can_have_requirement_count`; the semantics are not.
    expect(mod?.get('requirement_count')?.optional).toBe(true)
    expect(mod?.get('require_sequential_progress')?.optional).toBe(true)
    expect(mod?.get('prerequisite_module_ids')?.optional).toBe(true)
    // `state` / `completed_at` are emitted only `if progression`.
    expect(mod?.get('state')?.optional).toBe(true)
    expect(mod?.get('completed_at')?.optional).toBe(true)
  })

  it('declares the discussion requirement fields and NOT the author display object', () => {
    const topic = readInterfaces(liveTypes()).get('CanvasDiscussionTopic')
    expect(topic).toBeDefined()
    for (const field of [
      'require_initial_post',
      'user_can_see_posts',
      'topic_children',
      'group_topic_children',
      'is_checkpointed',
      'reply_to_entry_required_count',
    ]) {
      expect(topic?.has(field), `${field} must be declared`).toBe(true)
    }
    // §6.5: `author` is `user_display_json(topic.user, …)`, a third-party user display
    // object — the exact shape BRU-2863 and BRU-2864 leaked through. Nothing reading a
    // topic for requirement evidence needs it, so it stays off the type by design.
    expect(topic?.has('author')).toBe(false)
  })
})

describe('declaration guard: injections (unit tests of the walk, not red-first)', () => {
  const inject = (text: string): SourceInput => ({ fileName: 'injected.ts', text })

  it('fires when completed is declared required', () => {
    const cr = readInterfaces(
      inject(`export interface CanvasCompletionRequirement {
        type: string
        completed: boolean
      }`),
    ).get('CanvasCompletionRequirement')
    expect(cr?.get('completed')?.optional).toBe(false)
  })

  it('fires when the requirement-type union drops min_percentage', () => {
    const union = readStringUnion(
      inject(
        `export type CanvasCompletionRequirementType =
          | 'must_view' | 'must_contribute' | 'must_submit' | 'must_mark_done' | 'min_score'`,
      ),
      'CanvasCompletionRequirementType',
    )
    expect(union).toHaveLength(5)
    expect([...(union ?? [])].sort()).not.toEqual([...CANVAS_SIX_REQUIREMENT_TYPES].sort())
  })

  it('fires when the author display object is modelled on the topic', () => {
    const topic = readInterfaces(
      inject(`export interface CanvasDiscussionTopic {
        id: number
        author?: { id: number; display_name: string }
      }`),
    ).get('CanvasDiscussionTopic')
    expect(topic?.has('author')).toBe(true)
  })

  it('fires the anti-vacuity floor on an empty tree', () => {
    const ifaces = readInterfaces(inject('export const x = 1\n'))
    expect(ifaces.size).toBe(0)
    expect(readStringUnion(inject(''), 'CanvasCompletionRequirementType')).toBeNull()
  })
})

interface Captured {
  url: string
}

/**
 * Replaces `globalThis.fetch` with a queue of canned bodies and records the URL of
 * every call. Real capture: the recorded `url` is the string the client handed to
 * `fetch`, not an assertion about the arguments we passed the client.
 */
function stubFetch(bodies: unknown[]): Captured[] {
  const captured: Captured[] = []
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      captured.push({ url: String(input) })
      const body = bodies[Math.min(i++, bodies.length - 1)]
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      } as unknown as Response
    }),
  )
  return captured
}

describe('module requests carry the requirement evidence (wire-level)', () => {
  let modules: ModulesModule

  beforeEach(() => {
    modules = new ModulesModule(
      new CanvasHttpClient({ token: 't', baseUrl: 'https://canvas.example.com' }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listWithItems sends include[]=items and an explicit per_page=100', async () => {
    const captured = stubFetch([[]])
    await modules.listWithItems(42)
    expect(captured).toHaveLength(1)
    const q = new URL(captured[0].url).searchParams
    expect(q.getAll('include[]')).toEqual(['items'])
    // §5.2: never Canvas's `Api::PER_PAGE = 10`. `paginate` sets this for us, which is
    // why Stage 1 adds no `per_page` parameter — this is the assertion that replaces it.
    expect(q.get('per_page')).toBe('100')
  })

  it('listWithItems({ contentDetails: true }) adds include[]=content_details', async () => {
    const captured = stubFetch([[]])
    await modules.listWithItems(42, { contentDetails: true })
    const q = new URL(captured[0].url).searchParams
    expect(q.getAll('include[]')).toEqual(['items', 'content_details'])
    expect(q.get('per_page')).toBe('100')
  })

  it('listItems is unchanged by default and opts into content_details', async () => {
    const plain = stubFetch([[]])
    await modules.listItems(42, 7)
    expect(new URL(plain[0].url).searchParams.getAll('include[]')).toEqual([])
    expect(new URL(plain[0].url).searchParams.get('per_page')).toBe('100')

    vi.unstubAllGlobals()
    const detailed = stubFetch([[]])
    await modules.listItems(42, 7, { contentDetails: true })
    expect(new URL(detailed[0].url).searchParams.getAll('include[]')).toEqual(['content_details'])
  })

  it('leaves an absent completion_requirement.completed absent (§1.3 at the boundary)', async () => {
    // `module_item_json` with no progression: `ch["completed"] = … if progression`, so
    // the key is missing, not false. This is what a teacher/admin/anonymous caller sees.
    stubFetch([
      [
        {
          id: 1,
          name: 'Week 1',
          position: 1,
          items_count: 1,
          requirement_type: 'all',
          items: [
            {
              id: 10,
              module_id: 1,
              title: 'Syllabus',
              position: 1,
              type: 'Page',
              completion_requirement: { type: 'must_view' },
            },
          ],
        },
      ],
    ])
    const [mod] = await modules.listWithItems(42)
    const cr = (mod as CanvasModule & { items?: CanvasModuleItem[] }).items?.[0]
      .completion_requirement
    expect(cr).toEqual({ type: 'must_view' })
    expect(cr && 'completed' in cr).toBe(false)
    expect(cr?.completed).toBeUndefined()
  })

  it('an oversized module arrives with items ABSENT, and an empty one with items: [] (§5.1 pair)', async () => {
    // Characterization, not red-first: this is `paginate` passing the body through.
    // It is the pair that matters — `module_json` inlines items only when
    // `count <= Api::MAX_PER_PAGE` (= 100), so a 142-item module has no `items` key at
    // all, while a genuinely empty module has `items: []`. `[]` is truthy in JS, so the
    // two take opposite branches of any `mod.items &&` guard and `mod.items ?? []`
    // collapses them into one wrong answer. Stage 3's recovery keys on this difference.
    stubFetch([
      [
        { id: 1, name: 'Huge', position: 1, items_count: 142 },
        { id: 2, name: 'Empty', position: 2, items_count: 0, items: [] },
      ],
    ])
    const [huge, empty] = (await modules.listWithItems(42)) as Array<
      CanvasModule & { items?: CanvasModuleItem[] }
    >
    expect('items' in huge).toBe(false)
    expect(huge.items).toBeUndefined()
    expect(huge.items_count).toBe(142)
    expect(empty.items).toEqual([])
    expect(empty.items_count).toBe(0)
  })

  it('passes the §5.5 truthiness-dropped content_details through verbatim', async () => {
    // `content_details` copies with `if (val = item.try(attr))`, so a visible item with
    // zero points and no lock has NEITHER `locked` NOR `points_possible` — while
    // `locked_json` still sets `locked_for_user`.
    stubFetch([
      [
        {
          id: 1,
          name: 'Week 1',
          position: 1,
          items_count: 1,
          items: [
            {
              id: 10,
              module_id: 1,
              title: 'Reading',
              position: 1,
              type: 'Page',
              content_details: { locked_for_user: false, due_at: '2026-11-01T06:59:00Z' },
            },
          ],
        },
      ],
    ])
    const [mod] = (await modules.listWithItems(42, { contentDetails: true })) as Array<
      CanvasModule & { items?: CanvasModuleItem[] }
    >
    const cd = mod.items?.[0].content_details
    expect(cd?.locked_for_user).toBe(false)
    expect(cd && 'locked' in cd).toBe(false)
    expect(cd && 'points_possible' in cd).toBe(false)
    expect(cd?.locked).toBeUndefined()
    expect(cd?.points_possible).toBeUndefined()
  })
})
