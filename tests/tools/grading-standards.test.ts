import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { gradingStandardsTools } from '../../src/tools/grading-standards'

const mockStandard = {
  id: 42,
  title: 'GPA 4.0 Scale',
  context_type: 'Course' as const,
  context_id: 100,
  grading_scheme: [
    { name: 'A', value: 0.94 },
    { name: 'B', value: 0.84 },
    { name: 'F', value: 0.0 },
  ],
}

const schemeEntries = [
  { name: 'A', value: 0.94 },
  { name: 'B', value: 0.84 },
  { name: 'F', value: 0.0 },
]

function buildMockCanvas(): CanvasClient {
  return {
    gradingStandards: {
      listForCourse: vi.fn().mockResolvedValue([mockStandard]),
      listForAccount: vi.fn().mockResolvedValue([mockStandard]),
      createForCourse: vi.fn().mockResolvedValue(mockStandard),
      createForAccount: vi.fn().mockResolvedValue(mockStandard),
    },
    courses: {
      update: vi.fn().mockResolvedValue({ id: 100, grading_standard_id: 42 }),
    },
  } as unknown as CanvasClient
}

const tool = (canvas: CanvasClient, name: string) =>
  gradingStandardsTools(canvas).find((t) => t.name === name)!

describe('gradingStandardsTools', () => {
  it('returns 3 tool definitions', () => {
    expect(gradingStandardsTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const names = gradingStandardsTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_grading_standards',
      'create_grading_standard',
      'apply_grading_standard_to_course',
    ])
  })

  describe('list_grading_standards', () => {
    it('has readOnlyHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'list_grading_standards').annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('lists by course_id', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'list_grading_standards').handler({ course_id: 100 })
      expect(canvas.gradingStandards.listForCourse).toHaveBeenCalledWith(100)
      expect(result).toEqual([mockStandard])
    })

    it('lists by account_id', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'list_grading_standards').handler({ account_id: 1 })
      expect(canvas.gradingStandards.listForAccount).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockStandard])
    })

    it('throws a plain Error when neither id is provided', async () => {
      const canvas = buildMockCanvas()
      await expect(tool(canvas, 'list_grading_standards').handler({})).rejects.toThrow(
        'Provide either course_id or account_id.',
      )
      await expect(tool(canvas, 'list_grading_standards').handler({})).rejects.not.toBeInstanceOf(
        CanvasApiError,
      )
    })

    it('throws when both course_id and account_id are provided', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'list_grading_standards').handler({ course_id: 100, account_id: 1 }),
      ).rejects.toThrow('Provide either course_id or account_id, not both.')
      expect(canvas.gradingStandards.listForCourse).not.toHaveBeenCalled()
      expect(canvas.gradingStandards.listForAccount).not.toHaveBeenCalled()
    })

    it('propagates a 404 CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.gradingStandards.listForCourse).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/courses/100/grading_standards'),
      )
      await expect(
        tool(canvas, 'list_grading_standards').handler({ course_id: 100 }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })
  })

  describe('create_grading_standard', () => {
    it('has destructiveHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'create_grading_standard').annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('creates in a course context', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'create_grading_standard').handler({
        course_id: 100,
        title: 'GPA 4.0 Scale',
        scheme_entries: schemeEntries,
      })
      expect(canvas.gradingStandards.createForCourse).toHaveBeenCalledWith(
        100,
        'GPA 4.0 Scale',
        schemeEntries,
      )
      expect(result).toEqual(mockStandard)
    })

    it('creates in an account context', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'create_grading_standard').handler({
        account_id: 1,
        title: 'GPA 4.0 Scale',
        scheme_entries: schemeEntries,
      })
      expect(canvas.gradingStandards.createForAccount).toHaveBeenCalledWith(
        1,
        'GPA 4.0 Scale',
        schemeEntries,
      )
    })

    it('throws a plain Error when neither id is provided', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'create_grading_standard').handler({
          title: 'GPA 4.0 Scale',
          scheme_entries: schemeEntries,
        }),
      ).rejects.toThrow('Provide either course_id or account_id.')
    })

    it('throws when both course_id and account_id are provided (no API call, no admin re-wrap)', async () => {
      const canvas = buildMockCanvas()
      await expect(
        tool(canvas, 'create_grading_standard').handler({
          course_id: 100,
          account_id: 1,
          title: 'GPA 4.0 Scale',
          scheme_entries: schemeEntries,
        }),
      ).rejects.toThrow('Provide either course_id or account_id, not both.')
      expect(canvas.gradingStandards.createForCourse).not.toHaveBeenCalled()
      expect(canvas.gradingStandards.createForAccount).not.toHaveBeenCalled()
    })

    it('re-throws an account-context 403 as a plain Error mentioning admin permissions', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.gradingStandards.createForAccount).mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/v1/accounts/1/grading_standards'),
      )
      const promise = tool(canvas, 'create_grading_standard').handler({
        account_id: 1,
        title: 'GPA 4.0 Scale',
        scheme_entries: schemeEntries,
      })
      await expect(promise).rejects.toThrow(/Canvas admin permissions/)
      await expect(promise).rejects.not.toBeInstanceOf(CanvasApiError)
    })

    it('propagates a course-context 403 as CanvasApiError (no admin re-wrap)', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.gradingStandards.createForCourse).mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/100/grading_standards'),
      )
      await expect(
        tool(canvas, 'create_grading_standard').handler({
          course_id: 100,
          title: 'GPA 4.0 Scale',
          scheme_entries: schemeEntries,
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })

    it('propagates a 422 CanvasApiError unchanged', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.gradingStandards.createForCourse).mockRejectedValueOnce(
        new CanvasApiError('Unprocessable', 422, '/api/v1/courses/100/grading_standards'),
      )
      await expect(
        tool(canvas, 'create_grading_standard').handler({
          course_id: 100,
          title: 'GPA 4.0 Scale',
          scheme_entries: schemeEntries,
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })

    it('validates scheme entry value bounds (0–1) and non-empty entries', () => {
      const schema = z.object(tool(buildMockCanvas(), 'create_grading_standard').inputSchema)
      expect(
        schema.safeParse({ course_id: 100, title: 'x', scheme_entries: schemeEntries }).success,
      ).toBe(true)
      // value above 1 is rejected
      expect(
        schema.safeParse({
          course_id: 100,
          title: 'x',
          scheme_entries: [{ name: 'A', value: 1.5 }],
        }).success,
      ).toBe(false)
      // empty scheme_entries is rejected
      expect(schema.safeParse({ course_id: 100, title: 'x', scheme_entries: [] }).success).toBe(
        false,
      )
    })
  })

  describe('apply_grading_standard_to_course', () => {
    it('has destructiveHint + openWorldHint', () => {
      expect(tool(buildMockCanvas(), 'apply_grading_standard_to_course').annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('applies a grading standard id to the course', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'apply_grading_standard_to_course').handler({
        course_id: 100,
        grading_standard_id: 42,
      })
      expect(canvas.courses.update).toHaveBeenCalledWith(100, { grading_standard_id: 42 })
      expect(result).toEqual({ id: 100, grading_standard_id: 42 })
    })

    it('removes the grading standard when passed null', async () => {
      const canvas = buildMockCanvas()
      await tool(canvas, 'apply_grading_standard_to_course').handler({
        course_id: 100,
        grading_standard_id: null,
      })
      expect(canvas.courses.update).toHaveBeenCalledWith(100, { grading_standard_id: null })
    })

    it('propagates a 404 CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.update).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/v1/courses/100'),
      )
      await expect(
        tool(canvas, 'apply_grading_standard_to_course').handler({
          course_id: 100,
          grading_standard_id: 42,
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
