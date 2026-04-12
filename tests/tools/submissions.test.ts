import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasSubmission } from '../../src/canvas/types'
import { submissionTools } from '../../src/tools/submissions'

describe('submissionTools', () => {
  const mockSubmission: CanvasSubmission = {
    id: 201,
    assignment_id: 101,
    user_id: 5,
    submitted_at: '2026-04-10T12:00:00Z',
    score: 95,
    grade: '95',
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'graded',
    submission_comments: [],
  }

  function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
    return {
      submissions: {
        list: vi.fn().mockResolvedValue([mockSubmission]),
        get: vi.fn().mockResolvedValue(mockSubmission),
        grade: vi.fn().mockResolvedValue(mockSubmission),
        comment: vi.fn().mockResolvedValue(mockSubmission),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = submissionTools(canvas)
    expect(tools).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = submissionTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_submissions')
    expect(names).toContain('get_submission')
    expect(names).toContain('grade_submission')
    expect(names).toContain('comment_on_submission')
  })

  describe('list_submissions', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id and assignment_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
    })

    it('calls canvas.submissions.list with course_id and assignment_id', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(canvas.submissions.list).toHaveBeenCalledWith(1, 101)
    })

    it('returns the submission list from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      const result = await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(result).toEqual([mockSubmission])
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('get_submission', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id, assignment_id, and user_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
      expect(tool.inputSchema).toHaveProperty('user_id')
    })

    it('calls canvas.submissions.get with all three IDs', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      await tool.handler({ course_id: 1, assignment_id: 101, user_id: 5 })
      expect(canvas.submissions.get).toHaveBeenCalledWith(1, 101, 5)
    })

    it('returns the submission from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      const result = await tool.handler({ course_id: 1, assignment_id: 101, user_id: 5 })
      expect(result).toEqual(mockSubmission)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('grade_submission', () => {
    it('has destructiveHint, idempotentHint, and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'grade_submission')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id, assignment_id, user_id, and grade in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'grade_submission')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
      expect(tool.inputSchema).toHaveProperty('user_id')
      expect(tool.inputSchema).toHaveProperty('grade')
    })

    it('calls canvas.submissions.grade with all params', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'grade_submission')!
      await tool.handler({ course_id: 1, assignment_id: 101, user_id: 5, grade: '95' })
      expect(canvas.submissions.grade).toHaveBeenCalledWith(1, 101, 5, '95')
    })

    it('returns the graded submission from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'grade_submission')!
      const result = await tool.handler({
        course_id: 1,
        assignment_id: 101,
        user_id: 5,
        grade: '95',
      })
      expect(result).toEqual(mockSubmission)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'grade_submission')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('comment_on_submission', () => {
    it('has destructiveHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'comment_on_submission')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id, assignment_id, user_id, and comment in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'comment_on_submission')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
      expect(tool.inputSchema).toHaveProperty('user_id')
      expect(tool.inputSchema).toHaveProperty('comment')
    })

    it('calls canvas.submissions.comment with all params', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'comment_on_submission')!
      await tool.handler({
        course_id: 1,
        assignment_id: 101,
        user_id: 5,
        comment: 'Great work!',
      })
      expect(canvas.submissions.comment).toHaveBeenCalledWith(1, 101, 5, 'Great work!')
    })

    it('returns the updated submission from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'comment_on_submission')!
      const result = await tool.handler({
        course_id: 1,
        assignment_id: 101,
        user_id: 5,
        comment: 'Great work!',
      })
      expect(result).toEqual(mockSubmission)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'comment_on_submission')!
      expect(tool.description).toBeTruthy()
    })
  })
})
