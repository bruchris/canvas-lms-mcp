import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { getAllTools } from '../../src/tools'
import { deriveTitle, toolTitleOverrides } from '../../src/tools/titles'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// Coverage gate (BRU-1984 / Connectors Directory) — mirrors
// tests/tools/audience-coverage.test.ts. The Anthropic Connectors Directory
// requires every tool to expose a top-level `title`. Titles resolve centrally
// (src/tools/titles.ts), so a new tool automatically gets a Title-Cased default;
// this gate proves the resolution is wired through `getAllTools` for every tool
// and that nothing leaks a raw snake_case name as its title.

function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

describe('tool title coverage gate', () => {
  it('every registered tool has a non-empty title (pseudonymizer off)', () => {
    const untitled = getAllTools(mockCanvas()).filter(
      (t) => typeof t.title !== 'string' || t.title.trim() === '',
    )
    expect(untitled.map((t) => t.name)).toEqual([])
  })

  it('every registered tool has a non-empty title (pseudonymizer + reverse lookup on)', () => {
    const ps = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: {
        CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
        CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
      },
    })
    const untitled = getAllTools(mockCanvas(), ps).filter(
      (t) => typeof t.title !== 'string' || t.title.trim() === '',
    )
    expect(untitled.map((t) => t.name)).toEqual([])
  })

  it('no resolved title leaks a raw snake_case name', () => {
    const leaked = getAllTools(mockCanvas()).filter((t) => (t.title ?? '').includes('_'))
    expect(leaked.map((t) => t.name)).toEqual([])
  })

  it('every title override references a registered tool', () => {
    const names = new Set(getAllTools(mockCanvas()).map((t) => t.name))
    // resolve_pseudonym is conditional on the pseudonymizer, so include it.
    const ps = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true', CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true' },
    })
    for (const t of getAllTools(mockCanvas(), ps)) names.add(t.name)

    const orphans = Object.keys(toolTitleOverrides).filter((name) => !names.has(name))
    expect(orphans).toEqual([])
  })

  it('deriveTitle Title-Cases snake_case names', () => {
    expect(deriveTitle('list_courses')).toBe('List Courses')
    expect(deriveTitle('health_check')).toBe('Health Check')
    expect(deriveTitle('get_my_upcoming_assignments')).toBe('Get My Upcoming Assignments')
  })
})
