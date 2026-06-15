import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { getAllTools } from '../../src/tools'
import { toolDomainCatalog } from '../../src/tools/catalog'
import type { ToolAudience } from '../../src/tools/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// Coverage gate — mirrors tests/pseudonym/coverage.test.ts. Every tool the
// server can register MUST resolve to a concrete audience (its own `audience`
// field, or its domain's `defaultPrimaryAudience`). A tool that resolves to
// `undefined` would silently fall through `isVisibleForRole`'s `?? 'shared'`
// safety net and leak to roles it was never reviewed for — so we fail the build
// instead.

function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

const VALID_AUDIENCES: ReadonlySet<ToolAudience> = new Set<ToolAudience>([
  'student',
  'educator',
  'admin',
  'shared',
])

describe('tool audience coverage gate', () => {
  it('every catalog domain declares a default primary audience', () => {
    const missing = toolDomainCatalog.filter(
      (reg) => !VALID_AUDIENCES.has(reg.defaultPrimaryAudience),
    )
    expect(missing.map((r) => r.domain)).toEqual([])
  })

  it('every registered tool resolves to a valid audience (pseudonymizer off)', () => {
    const unresolved = getAllTools(mockCanvas()).filter(
      (t) => t.audience === undefined || !VALID_AUDIENCES.has(t.audience),
    )
    expect(unresolved.map((t) => t.name)).toEqual([])
  })

  it('every registered tool resolves to a valid audience (pseudonymizer + reverse lookup on)', () => {
    const ps = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: {
        CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
        CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
      },
    })
    const unresolved = getAllTools(mockCanvas(), ps).filter(
      (t) => t.audience === undefined || !VALID_AUDIENCES.has(t.audience),
    )
    expect(unresolved.map((t) => t.name)).toEqual([])
  })
})
