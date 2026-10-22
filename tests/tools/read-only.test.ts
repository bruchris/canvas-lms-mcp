import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasClient } from '../../src/canvas'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'
import { resolveWriteToolsMode } from '../../src/tools/write-policy'
import type { CanvasToolset } from '../../src/tools/toolsets'

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/generated/tool-manifest.json'), 'utf8'),
) as {
  toolCount: number
  tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean }; toolset: CanvasToolset }>
}
const READ_ONLY_NAMES = manifest.tools
  .filter((tool) => tool.annotations?.readOnlyHint === true)
  .map((tool) => tool.name)
  .sort()

const canvas = new CanvasClient({ token: 't', baseUrl: 'https://canvas.example.com' })

function registeredNames(config: Parameters<typeof createCanvasMCPServer>[0]): string[] {
  const { server } = createCanvasMCPServer(config)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.keys((server as any)._registeredTools).sort()
}

const BASE = { token: 't', baseUrl: 'https://canvas.example.com', sharedAcrossCallers: false }

describe('resolveWriteToolsMode — the read-only floor', () => {
  it('returns undefined when neither source narrows, so the key stays absent', () => {
    expect(resolveWriteToolsMode({})).toBeUndefined()
    expect(resolveWriteToolsMode({ readOnly: false })).toBeUndefined()
    expect(resolveWriteToolsMode({ readOnly: undefined })).toBeUndefined()
  })

  it('blocks when the operator declared read-only', () => {
    expect(resolveWriteToolsMode({ readOnly: true })).toBe('block')
  })

  it('blocks when the caller credential lacks write scope', () => {
    expect(resolveWriteToolsMode({ scopeAllowsWrite: false })).toBe('block')
    expect(resolveWriteToolsMode({ readOnly: false, scopeAllowsWrite: false })).toBe('block')
  })

  it('allows when the credential carries write scope and no read-only floor is set', () => {
    expect(resolveWriteToolsMode({ scopeAllowsWrite: true })).toBe('allow')
    expect(resolveWriteToolsMode({ readOnly: false, scopeAllowsWrite: true })).toBe('allow')
  })

  it('read-only wins over a write-scoped credential — the floor cannot be widened', () => {
    // The asymmetry is the whole point: a caller presenting a token that
    // happens to carry `canvas:write` must not reopen writes on a server the
    // operator started read-only.
    expect(resolveWriteToolsMode({ readOnly: true, scopeAllowsWrite: true })).toBe('block')
  })

  it('is additive to OAuth scope handling — a scope-blocked token still blocks', () => {
    expect(resolveWriteToolsMode({ readOnly: true, scopeAllowsWrite: false })).toBe('block')
    expect(resolveWriteToolsMode({ readOnly: false, scopeAllowsWrite: false })).toBe('block')
  })
})

describe('createCanvasMCPServer — readOnly', () => {
  it('readOnly: true registers exactly the readOnlyHint tools', () => {
    const got = registeredNames({ ...BASE, readOnly: true, enableAssignmentSubmission: true })

    expect(got).toEqual(READ_ONLY_NAMES)
    expect(got.length).toBeLessThan(manifest.toolCount)
  })

  it('readOnly: false and unset both preserve the default surface', () => {
    const unset = registeredNames({ ...BASE, enableAssignmentSubmission: true })
    const explicitFalse = registeredNames({
      ...BASE,
      readOnly: false,
      enableAssignmentSubmission: true,
    })

    expect(explicitFalse).toEqual(unset)
    expect(unset.length).toBe(manifest.toolCount)
  })

  it('reaches the same surface as the pre-existing writeTools: block policy', () => {
    // It is the same mechanism, not a second one — this is what makes
    // "no new filtering path" a measurement rather than a claim.
    expect(registeredNames({ ...BASE, readOnly: true, enableAssignmentSubmission: true })).toEqual(
      registeredNames({ ...BASE, writeTools: 'block', enableAssignmentSubmission: true }),
    )
  })

  it('readOnly overrides a writeTools: allow passed alongside it', () => {
    expect(
      registeredNames({
        ...BASE,
        readOnly: true,
        writeTools: 'allow',
        enableAssignmentSubmission: true,
      }),
    ).toEqual(READ_ONLY_NAMES)
  })

  it('intersects with toolsets and with role', () => {
    const readOnlyGrading = registeredNames({
      ...BASE,
      readOnly: true,
      toolsets: new Set<CanvasToolset>(['grading']),
    })
    const grading = new Set(
      registeredNames({ ...BASE, toolsets: new Set<CanvasToolset>(['grading']) }),
    )

    expect(readOnlyGrading.length).toBeGreaterThan(0)
    expect(readOnlyGrading.length).toBeLessThan(grading.size)
    for (const name of readOnlyGrading) {
      expect(grading.has(name)).toBe(true)
      expect(READ_ONLY_NAMES).toContain(name)
    }

    const readOnlyTeacher = registeredNames({ ...BASE, readOnly: true, role: 'teacher' })
    for (const name of readOnlyTeacher) expect(READ_ONLY_NAMES).toContain(name)
  })

  it('leaves no write tool reachable, including the gated deletes', () => {
    const got = new Set(
      registeredNames({
        ...BASE,
        readOnly: true,
        enableAssignmentSubmission: true,
        destructiveTools: 'allow',
      }),
    )

    for (const name of ['grade_submission', 'delete_assignment', 'submit_assignment']) {
      expect(got.has(name), name).toBe(false)
    }
  })
})

describe('getAllTools — readOnly reaches the registry through features.writeTools', () => {
  it('is the writeTools block filter, applied at the same choke point', () => {
    const blocked = getAllTools(canvas, undefined, undefined, {
      writeTools: 'block',
      assignmentSubmission: true,
    })

    expect(blocked.every((tool) => tool.annotations.readOnlyHint === true)).toBe(true)
    expect(blocked.map((tool) => tool.name).sort()).toEqual(READ_ONLY_NAMES)
  })
})
