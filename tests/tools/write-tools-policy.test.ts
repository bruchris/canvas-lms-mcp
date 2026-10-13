import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasClient } from '../../src/canvas'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'

// Oracle: the generated manifest, as every other count test uses (never a
// hard-coded number).
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/generated/tool-manifest.json'), 'utf8'),
) as { toolCount: number; tools: Array<{ annotations?: { readOnlyHint?: boolean } }> }
const READ_ONLY = manifest.tools.filter((t) => t.annotations?.readOnlyHint === true).length

const canvas = new CanvasClient({ token: 't', baseUrl: 'https://canvas.example.com' })

describe('writeTools policy (#302 §7.4)', () => {
  it('block keeps exactly the read-only tools; allow and unset keep everything', () => {
    const blocked = getAllTools(canvas, undefined, undefined, {
      writeTools: 'block',
      assignmentSubmission: true,
    })
    expect(blocked.length).toBe(READ_ONLY)
    expect(blocked.every((t) => t.annotations.readOnlyHint === true)).toBe(true)
    expect(
      getAllTools(canvas, undefined, undefined, { writeTools: 'allow', assignmentSubmission: true })
        .length,
    ).toBe(manifest.toolCount)
    expect(getAllTools(canvas, undefined, undefined, { assignmentSubmission: true }).length).toBe(
      manifest.toolCount,
    )
  })

  it('composes with role filtering and the destructive policy', () => {
    const student = getAllTools(canvas, undefined, 'student', { writeTools: 'block' })
    expect(student.every((t) => t.annotations.readOnlyHint === true)).toBe(true)
    expect(student.length).toBeLessThan(READ_ONLY)
    const both = getAllTools(canvas, undefined, undefined, {
      writeTools: 'block',
      destructiveTools: 'block',
      assignmentSubmission: true,
    })
    expect(both.length).toBe(READ_ONLY)
  })

  it('is accepted by the server factory', () => {
    expect(() =>
      createCanvasMCPServer({
        token: 't',
        baseUrl: 'https://canvas.example.com',
        writeTools: 'block',
        sharedAcrossCallers: true,
      }),
    ).not.toThrow()
  })
})
