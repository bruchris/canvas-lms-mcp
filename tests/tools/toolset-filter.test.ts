import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { getAllTools } from '../../src/tools'
import {
  CANVAS_TOOLSETS,
  parseToolsets,
  unknownToolsetWarning,
  type CanvasToolset,
} from '../../src/tools/toolsets'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// getAllTools never invokes a tool's handler — it only constructs the
// definitions — so a deep no-op proxy is a sufficient CanvasClient stand-in.
function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, { get: () => deep, apply: () => deep })
  return deep as CanvasClient
}

// Oracle: the generated manifest, never a hard-coded count. It carries both
// `domain` and `toolset`, so "a toolset exposes exactly its mapped domains" is
// checkable against a generated artifact rather than against this file's idea
// of the mapping.
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/generated/tool-manifest.json'), 'utf8'),
) as {
  toolCount: number
  tools: Array<{ name: string; domain: string; toolset: CanvasToolset }>
}

/** Every tool name the manifest assigns to any of `toolsets`. */
function expectedNames(...toolsets: CanvasToolset[]): string[] {
  const wanted = new Set<string>(toolsets)
  return manifest.tools
    .filter((tool) => wanted.has(tool.toolset))
    .map((tool) => tool.name)
    .sort()
}

/** Registered names under a toolset selection, with the opt-in domain gate on. */
function names(toolsets?: Iterable<CanvasToolset>, role?: 'student' | 'teacher' | 'admin') {
  return getAllTools(mockCanvas(), undefined, role, {
    assignmentSubmission: true,
    ...(toolsets ? { toolsets: new Set(toolsets) } : {}),
  })
    .map((tool) => tool.name)
    .sort()
}

describe('parseToolsets', () => {
  it('accepts a single name, case-insensitively, trimming whitespace', () => {
    expect(parseToolsets('grading')).toEqual({ toolsets: new Set(['grading']), unknown: [] })
    expect(parseToolsets('  GRADING ')).toEqual({ toolsets: new Set(['grading']), unknown: [] })
  })

  it('accepts a comma-separated list and unions it', () => {
    expect(parseToolsets('grading,quizzes')).toEqual({
      toolsets: new Set(['grading', 'quizzes']),
      unknown: [],
    })
    expect(parseToolsets(' core , People ,grading ')).toEqual({
      toolsets: new Set(['core', 'people', 'grading']),
      unknown: [],
    })
  })

  it('dedupes repeats rather than treating them as a different selection', () => {
    expect(parseToolsets('core,core,core')).toEqual({ toolsets: new Set(['core']), unknown: [] })
  })

  it('treats unset, empty, whitespace, bare commas and "all" as no filter, without warning', () => {
    for (const raw of [undefined, null, '', '   ', ',', ',,,', 'all', ' ALL ']) {
      expect(parseToolsets(raw)).toEqual({ unknown: [] })
    }
  })

  it('"all" anywhere in a list wins outright', () => {
    expect(parseToolsets('grading,all')).toEqual({ unknown: [] })
    expect(parseToolsets('all,nonsense')).toEqual({ unknown: [] })
  })

  it('discards the whole selection when any name is unknown, naming the offenders', () => {
    // The rule that matters: a typo must not quietly serve a *narrower* surface
    // than the operator typed, so the parseable remainder is dropped too.
    expect(parseToolsets('grading,bogus')).toEqual({ unknown: ['bogus'] })
    expect(parseToolsets('nope,alsonope')).toEqual({ unknown: ['nope', 'alsonope'] })
    expect(parseToolsets('bogus,bogus')).toEqual({ unknown: ['bogus'] })
  })

  it('never returns an empty set, so "no filter" has exactly one representation', () => {
    for (const raw of [undefined, '', 'all', 'bogus', ',']) {
      const parsed = parseToolsets(raw)
      expect(parsed.toolsets === undefined || parsed.toolsets.size > 0).toBe(true)
    }
  })

  it('accepts every published toolset name', () => {
    for (const toolset of CANVAS_TOOLSETS) {
      expect(parseToolsets(toolset)).toEqual({ toolsets: new Set([toolset]), unknown: [] })
    }
  })
})

describe('unknownToolsetWarning', () => {
  it('names the offending values, says what happened, and lists the valid names', () => {
    const message = unknownToolsetWarning('CANVAS_TOOLSETS', ['bogus'])

    expect(message).toContain("'bogus'")
    expect(message).toContain('CANVAS_TOOLSETS')
    expect(message).toContain('registering all tools')
    for (const toolset of CANVAS_TOOLSETS) expect(message).toContain(toolset)
  })

  it('pluralises for several unknown names', () => {
    expect(unknownToolsetWarning('--toolsets', ['a', 'b'])).toContain("values 'a', 'b'")
  })
})

describe('getAllTools — toolset filtering', () => {
  it('unset is the full registry, byte-for-byte current behaviour', () => {
    const unset = getAllTools(mockCanvas(), undefined, undefined, { assignmentSubmission: true })
    expect(unset.map((tool) => tool.name).sort()).toEqual(
      manifest.tools.map((tool) => tool.name).sort(),
    )
    expect(names()).toEqual(names(undefined))
  })

  it('an empty set is treated as no filter, not as "no tools"', () => {
    // Fail-open on purpose: a filter that narrowed to nothing would serve zero
    // tools, which a client cannot tell apart from a broken server.
    expect(names(new Set<CanvasToolset>())).toEqual(names())
    expect(names(new Set<CanvasToolset>()).length).toBe(manifest.toolCount)
  })

  it('each toolset exposes exactly the tools of its mapped domains', () => {
    for (const toolset of CANVAS_TOOLSETS) {
      const got = names([toolset])
      expect(got, `toolset ${toolset}`).toEqual(expectedNames(toolset))
      expect(got.length, `toolset ${toolset} is non-empty`).toBeGreaterThan(0)
    }
  })

  it('every single-toolset surface is a strict subset of the full registry', () => {
    const all = new Set(names())
    for (const toolset of CANVAS_TOOLSETS) {
      const subset = names([toolset])
      expect(subset.length).toBeLessThan(all.size)
      for (const name of subset) expect(all.has(name)).toBe(true)
    }
  })

  it('comma-separated sets union', () => {
    expect(names(['grading', 'quizzes'])).toEqual(expectedNames('grading', 'quizzes'))
    expect(names(['grading', 'quizzes']).length).toBe(
      names(['grading']).length + names(['quizzes']).length,
    )
  })

  it('selecting all nine reproduces the full registry exactly', () => {
    expect(names([...CANVAS_TOOLSETS])).toEqual(names())
  })

  it('intersects with role filtering rather than overriding it', () => {
    const toolsetOnly = new Set(names(['grading']))
    const roleOnly = new Set(names(undefined, 'teacher'))
    const both = names(['grading'], 'teacher')

    // Exactly the intersection, in both directions.
    expect(both).toEqual([...toolsetOnly].filter((name) => roleOnly.has(name)).sort())
    for (const name of both) {
      expect(toolsetOnly.has(name)).toBe(true)
      expect(roleOnly.has(name)).toBe(true)
    }
  })

  it('a toolset can only remove tools a role would have seen, never add one back', () => {
    for (const role of ['student', 'teacher', 'admin'] as const) {
      const roleOnly = new Set(names(undefined, role))
      for (const toolset of CANVAS_TOOLSETS) {
        for (const name of names([toolset], role)) {
          expect(roleOnly.has(name), `${role} + ${toolset}: ${name}`).toBe(true)
        }
      }
    }
  })

  it('the student toolset plus the student role is the student-facing surface', () => {
    const studentSurface = names(['student'], 'student')

    expect(studentSurface).toContain('get_my_grades')
    expect(studentSurface).toContain('get_dashboard_cards')
    expect(studentSurface).not.toContain('grade_submission')
    expect(studentSurface).not.toContain('list_account_users')
  })

  it('the gated submission domain follows its toolset AND its gate', () => {
    const gateOn = getAllTools(mockCanvas(), undefined, undefined, {
      assignmentSubmission: true,
      toolsets: new Set<CanvasToolset>(['student']),
    }).map((tool) => tool.name)
    const gateOff = getAllTools(mockCanvas(), undefined, undefined, {
      toolsets: new Set<CanvasToolset>(['student']),
    }).map((tool) => tool.name)

    expect(gateOn).toContain('submit_assignment')
    expect(gateOff).not.toContain('submit_assignment')
    // And the gated domain is absent from a toolset it is not mapped to, with
    // the gate on — so the toolset filter is doing the work, not the gate.
    expect(
      getAllTools(mockCanvas(), undefined, undefined, {
        assignmentSubmission: true,
        toolsets: new Set<CanvasToolset>(['grading']),
      }).map((tool) => tool.name),
    ).not.toContain('submit_assignment')
  })

  it('composes with the destructive-tools gate', () => {
    const blocked = getAllTools(mockCanvas(), undefined, undefined, {
      toolsets: new Set<CanvasToolset>(['core']),
      destructiveTools: 'block',
    }).map((tool) => tool.name)

    expect(blocked).toContain('list_assignments')
    expect(blocked).not.toContain('delete_assignment')
    expect(blocked.length).toBeLessThan(names(['core']).length)
  })

  it('leaves resolve_pseudonym available under every toolset — it has no domain', () => {
    // Deliberate: a server capability rather than a Canvas area, and already
    // conditional on the deployer enabling reverse lookup. Hiding it under a
    // narrow toolset would hand a caller pseudonymised names it cannot resolve.
    const pseudonymizer = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: {
        CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
        CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
      },
    })

    for (const toolset of CANVAS_TOOLSETS) {
      const got = getAllTools(mockCanvas(), pseudonymizer, undefined, {
        toolsets: new Set<CanvasToolset>([toolset]),
      }).map((tool) => tool.name)
      expect(got, `toolset ${toolset}`).toContain('resolve_pseudonym')
    }

    // Its own audience tag still applies, exactly as before.
    expect(
      getAllTools(mockCanvas(), pseudonymizer, 'student', {
        toolsets: new Set<CanvasToolset>(['student']),
      }).map((tool) => tool.name),
    ).not.toContain('resolve_pseudonym')
  })
})
