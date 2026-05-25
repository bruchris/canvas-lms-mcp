import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasSubmission } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
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

    it('calls canvas.submissions.list with course_id, assignment_id, and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(canvas.submissions.list).toHaveBeenCalledWith(1, 101, {})
    })

    it('forwards include[] and filters', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'list_submissions')!
      await tool.handler({
        course_id: 1,
        assignment_id: 101,
        include: ['user', 'rubric_assessment'],
        student_ids: [5, 6],
        workflow_state: 'submitted',
      })
      expect(canvas.submissions.list).toHaveBeenCalledWith(1, 101, {
        include: ['user', 'rubric_assessment'],
        student_ids: [5, 6],
        workflow_state: 'submitted',
      })
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

    it('calls canvas.submissions.get with all three IDs and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      await tool.handler({ course_id: 1, assignment_id: 101, user_id: 5 })
      expect(canvas.submissions.get).toHaveBeenCalledWith(1, 101, 5, {})
    })

    it('forwards include[] to canvas.submissions.get', async () => {
      const canvas = buildMockCanvas()
      const tool = submissionTools(canvas).find((t) => t.name === 'get_submission')!
      await tool.handler({
        course_id: 1,
        assignment_id: 101,
        user_id: 5,
        include: ['rubric_assessment', 'user'],
      })
      expect(canvas.submissions.get).toHaveBeenCalledWith(1, 101, 5, {
        include: ['rubric_assessment', 'user'],
      })
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

  describe('pseudonymization', () => {
    const submissionWithUser: CanvasSubmission = {
      ...mockSubmission,
      user: {
        id: 5,
        name: 'Alice',
        sortable_name: 'Alice',
        short_name: 'Alice',
        email: 'alice@example.edu',
        sis_user_id: 'SIS-5',
      },
      submission_comments: [
        {
          id: 301,
          author_id: 5,
          author_name: 'Alice',
          comment: 'Good feedback',
          created_at: '2026-04-11T10:00:00Z',
        },
      ],
    }

    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'submission-tool-'))
    })
    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    function makePseudonymizer(enabled = true) {
      return new Pseudonymizer({
        baseUrl: 'https://school.instructure.com/api/v1',
        rootDir: tmpDir,
        env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
      })
    }

    function buildCanvasWithUser(): CanvasClient {
      return {
        submissions: {
          list: vi.fn().mockResolvedValue([submissionWithUser]),
          get: vi.fn().mockResolvedValue(submissionWithUser),
          grade: vi.fn().mockResolvedValue(submissionWithUser),
          comment: vi.fn().mockResolvedValue(submissionWithUser),
        },
      } as unknown as CanvasClient
    }

    describe('list_submissions', () => {
      it('pseudonymizes embedded user when enabled', async () => {
        const tool = submissionTools(buildCanvasWithUser(), makePseudonymizer()).find(
          (t) => t.name === 'list_submissions',
        )!
        const result = (await tool.handler({
          course_id: 1,
          assignment_id: 101,
        })) as CanvasSubmission[]
        expect(result[0].user?.name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const tool = submissionTools(buildCanvasWithUser(), makePseudonymizer(false)).find(
          (t) => t.name === 'list_submissions',
        )!
        const result = (await tool.handler({
          course_id: 1,
          assignment_id: 101,
        })) as CanvasSubmission[]
        expect(result[0].user?.name).toBe('Alice')
      })
    })

    describe('get_submission', () => {
      it('pseudonymizes embedded user when enabled', async () => {
        const tool = submissionTools(buildCanvasWithUser(), makePseudonymizer()).find(
          (t) => t.name === 'get_submission',
        )!
        const result = (await tool.handler({
          course_id: 1,
          assignment_id: 101,
          user_id: 5,
        })) as CanvasSubmission
        expect(result.user?.name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const tool = submissionTools(buildCanvasWithUser(), makePseudonymizer(false)).find(
          (t) => t.name === 'get_submission',
        )!
        const result = (await tool.handler({
          course_id: 1,
          assignment_id: 101,
          user_id: 5,
        })) as CanvasSubmission
        expect(result.user?.name).toBe('Alice')
      })
    })
  })
})
