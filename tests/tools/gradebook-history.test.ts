import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasGradebookHistoryDay,
  CanvasGradebookHistoryGrader,
  CanvasGradebookHistorySubmission,
  CanvasGradebookHistorySubmissionVersion,
} from '../../src/canvas/types'
import { gradebookHistoryTools } from '../../src/tools/gradebook-history'

describe('gradebookHistoryTools', () => {
  const mockDays: CanvasGradebookHistoryDay[] = [
    {
      date: '2026-04-20',
      graders: [{ id: 7, name: 'Prof Smith', assignments: [101, 102] }],
    },
  ]
  const mockGraders: CanvasGradebookHistoryGrader[] = [
    { id: 7, name: 'Prof Smith', assignments: [101, 102] },
  ]
  const mockSubmissionHistory: CanvasGradebookHistorySubmission[] = [
    {
      submission_id: 99,
      versions: [
        {
          id: 99,
          assignment_id: 101,
          user_id: 12,
          submitted_at: '2026-04-20T08:00:00Z',
          score: 95,
          grade: '95',
          body: null,
          url: null,
          attempt: 1,
          workflow_state: 'graded',
          new_grade: '95',
          previous_grade: '90',
          user_name: 'Alice Student',
          current_grader: 'Prof Smith',
        },
      ],
    },
  ]
  const mockFeed: CanvasGradebookHistorySubmissionVersion[] = [
    {
      id: 99,
      assignment_id: 101,
      user_id: 12,
      submitted_at: '2026-04-20T08:00:00Z',
      score: 95,
      grade: '95',
      body: null,
      url: null,
      attempt: 1,
      workflow_state: 'graded',
      assignment_name: 'Essay 1',
      user_name: 'Alice Student',
      current_grader: 'Prof Smith',
    },
  ]

  function buildMockCanvas(): CanvasClient {
    return {
      gradebookHistory: {
        listDays: vi.fn().mockResolvedValue(mockDays),
        getDay: vi.fn().mockResolvedValue(mockGraders),
        listSubmissions: vi.fn().mockResolvedValue(mockSubmissionHistory),
        getFeed: vi.fn().mockResolvedValue(mockFeed),
      },
    } as unknown as CanvasClient
  }

  it('returns 4 tool definitions', () => {
    expect(gradebookHistoryTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with the expected names', () => {
    expect(gradebookHistoryTools(buildMockCanvas()).map((tool) => tool.name)).toEqual([
      'list_gradebook_history_days',
      'get_gradebook_history_day',
      'list_gradebook_history_submissions',
      'get_gradebook_history_feed',
    ])
  })

  it('marks every gradebook history tool as read-only', () => {
    for (const tool of gradebookHistoryTools(buildMockCanvas())) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    }
  })

  it('delegates list_gradebook_history_days to canvas.gradebookHistory.listDays', async () => {
    const canvas = buildMockCanvas()
    const tool = gradebookHistoryTools(canvas).find(
      (t) => t.name === 'list_gradebook_history_days',
    )!

    const result = await tool.handler({ course_id: 42 })

    expect(result).toEqual(mockDays)
    expect(canvas.gradebookHistory.listDays).toHaveBeenCalledWith(42)
  })

  it('delegates get_gradebook_history_day to canvas.gradebookHistory.getDay', async () => {
    const canvas = buildMockCanvas()
    const tool = gradebookHistoryTools(canvas).find((t) => t.name === 'get_gradebook_history_day')!

    const result = await tool.handler({ course_id: 42, date: '2026-04-20' })

    expect(result).toEqual(mockGraders)
    expect(canvas.gradebookHistory.getDay).toHaveBeenCalledWith(42, '2026-04-20')
  })

  it('delegates list_gradebook_history_submissions to canvas.gradebookHistory.listSubmissions', async () => {
    const canvas = buildMockCanvas()
    const tool = gradebookHistoryTools(canvas).find(
      (t) => t.name === 'list_gradebook_history_submissions',
    )!

    const result = await tool.handler({
      course_id: 42,
      date: '2026-04-20',
      grader_id: 7,
      assignment_id: 101,
    })

    expect(result).toEqual(mockSubmissionHistory)
    expect(canvas.gradebookHistory.listSubmissions).toHaveBeenCalledWith(42, '2026-04-20', 7, 101)
  })

  it('delegates get_gradebook_history_feed to canvas.gradebookHistory.getFeed', async () => {
    const canvas = buildMockCanvas()
    const tool = gradebookHistoryTools(canvas).find((t) => t.name === 'get_gradebook_history_feed')!

    const result = await tool.handler({
      course_id: 42,
      assignment_id: 101,
      user_id: 12,
      ascending: true,
    })

    expect(result).toEqual(mockFeed)
    expect(canvas.gradebookHistory.getFeed).toHaveBeenCalledWith(42, {
      assignment_id: 101,
      user_id: 12,
      ascending: true,
    })
  })

  describe('pseudonymization', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'gbhist-tool-'))
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

    describe('list_gradebook_history_submissions', () => {
      it('pseudonymizes user_name when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = gradebookHistoryTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_gradebook_history_submissions',
        )!
        const result = (await tool.handler({
          course_id: 42,
          date: '2026-04-20',
          grader_id: 7,
          assignment_id: 101,
        })) as CanvasGradebookHistorySubmission[]
        expect(result[0].versions![0].user_name).toMatch(/^Student \d+$/)
      })

      it('passes through real user_name when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = gradebookHistoryTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_gradebook_history_submissions',
        )!
        const result = (await tool.handler({
          course_id: 42,
          date: '2026-04-20',
          grader_id: 7,
          assignment_id: 101,
        })) as CanvasGradebookHistorySubmission[]
        expect(result[0].versions![0].user_name).toBe('Alice Student')
      })

      it('does not pseudonymize grader names', async () => {
        const canvas = buildMockCanvas()
        const tool = gradebookHistoryTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_gradebook_history_submissions',
        )!
        const result = (await tool.handler({
          course_id: 42,
          date: '2026-04-20',
          grader_id: 7,
          assignment_id: 101,
        })) as CanvasGradebookHistorySubmission[]
        expect(result[0].versions![0].current_grader).toBe('Prof Smith')
      })
    })

    describe('get_gradebook_history_feed', () => {
      it('pseudonymizes user_name when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = gradebookHistoryTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'get_gradebook_history_feed',
        )!
        const result = (await tool.handler({
          course_id: 42,
        })) as CanvasGradebookHistorySubmissionVersion[]
        expect(result[0].user_name).toMatch(/^Student \d+$/)
      })

      it('passes through real user_name when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = gradebookHistoryTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'get_gradebook_history_feed',
        )!
        const result = (await tool.handler({
          course_id: 42,
        })) as CanvasGradebookHistorySubmissionVersion[]
        expect(result[0].user_name).toBe('Alice Student')
      })
    })
  })
})
