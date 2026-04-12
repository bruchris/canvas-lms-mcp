import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasEnrollment } from '../../src/canvas/types'
import { enrollmentTools } from '../../src/tools/enrollments'

describe('enrollmentTools', () => {
  const mockEnrollment: CanvasEnrollment = {
    id: 1,
    course_id: 1,
    user_id: 5,
    type: 'StudentEnrollment',
    enrollment_state: 'active',
    role: 'StudentEnrollment',
    created_at: '2026-01-01T00:00:00Z',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      enrollments: {
        list: vi.fn().mockResolvedValue([mockEnrollment]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 1 tool definition', () => {
    expect(enrollmentTools(buildMockCanvas())).toHaveLength(1)
  })

  it('exports tools with correct names', () => {
    const names = enrollmentTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_enrollments'])
  })

  describe('list_enrollments', () => {
    it('has read-only annotations', () => {
      const tool = enrollmentTools(buildMockCanvas()).find((t) => t.name === 'list_enrollments')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.enrollments.list', async () => {
      const canvas = buildMockCanvas()
      const tool = enrollmentTools(canvas).find((t) => t.name === 'list_enrollments')!
      const result = await tool.handler({})
      expect(canvas.enrollments.list).toHaveBeenCalled()
      expect(result).toEqual([mockEnrollment])
    })
  })
})
