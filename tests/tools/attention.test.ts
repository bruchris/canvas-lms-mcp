import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasSubmission } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { attentionTools } from '../../src/tools/attention'

// Minimal submission with comments used across tests
function makeSubmission(overrides: Partial<CanvasSubmission> = {}): CanvasSubmission {
  return {
    id: 1,
    assignment_id: 100,
    user_id: 42,
    submitted_at: '2026-06-01T08:00:00Z',
    graded_at: null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'submitted',
    html_url: 'https://school.instructure.com/courses/10/assignments/100/submissions/42',
    read_status: 'unread',
    user: {
      id: 42,
      name: 'Alice Smith',
      short_name: 'Alice',
      sortable_name: 'Smith, Alice',
      email: 'alice@school.edu',
      sis_user_id: 'SIS-42',
    },
    assignment: { id: 100, name: 'Essay 1', course_id: 10, due_at: null, points_possible: 100 },
    ...overrides,
  }
}

function buildMockCanvas(submissions: CanvasSubmission[] = []): CanvasClient {
  return {
    submissions: {
      listForStudents: vi.fn().mockResolvedValue(submissions),
    },
  } as unknown as CanvasClient
}

describe('attentionTools', () => {
  it('returns an array with 1 tool definition', () => {
    const tools = attentionTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
  })

  it('exports the tool with the correct name', () => {
    const tools = attentionTools(buildMockCanvas())
    expect(tools[0].name).toBe('list_submission_comments_needing_attention')
  })

  it('has readOnlyHint and openWorldHint annotations', () => {
    const tool = attentionTools(buildMockCanvas())[0]
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  it('has a description', () => {
    const tool = attentionTools(buildMockCanvas())[0]
    expect(tool.description).toBeTruthy()
  })

  describe('list_submission_comments_needing_attention', () => {
    it('returns empty findings when no submissions have comments', async () => {
      const canvas = buildMockCanvas([makeSubmission({ submission_comments: [] })])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        scanned_submissions: number
        findings_count: number
        findings: object[]
      }
      expect(result.scanned_submissions).toBe(1)
      expect(result.findings_count).toBe(0)
      expect(result.findings).toHaveLength(0)
    })

    it('flags an ungraded submission with a student comment', async () => {
      const submission = makeSubmission({
        graded_at: null,
        workflow_state: 'submitted',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice Smith',
            comment: 'Please review my work.',
            created_at: '2026-06-03T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ reason: string; user_id: number; assignment_id: number }>
      }
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].reason).toBe('student_comment_ungraded')
      expect(result.findings[0].user_id).toBe(42)
      expect(result.findings[0].assignment_id).toBe(100)
    })

    it('flags a graded submission with a student comment newer than graded_at', async () => {
      const submission = makeSubmission({
        graded_at: '2026-06-01T10:00:00Z',
        workflow_state: 'graded',
        score: 88,
        grade: '88',
        submission_comments: [
          {
            id: 1,
            author_id: 99, // instructor
            author_name: 'Prof Jones',
            comment: 'Good work overall.',
            created_at: '2026-06-01T10:00:00Z',
          },
          {
            id: 2,
            author_id: 42, // student comment AFTER grading
            author_name: 'Alice Smith',
            comment: 'I think question 3 was graded against the old rubric.',
            created_at: '2026-06-03T08:12:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ reason: string; unaddressed_comment_count: number }>
      }
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].reason).toBe('student_comment_after_grading')
      expect(result.findings[0].unaddressed_comment_count).toBe(1)
    })

    it('does NOT flag a graded submission where the last comment is from the instructor', async () => {
      const submission = makeSubmission({
        graded_at: '2026-06-01T10:00:00Z',
        workflow_state: 'graded',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice Smith',
            comment: 'I have a question.',
            created_at: '2026-06-01T09:00:00Z',
          },
          {
            id: 2,
            author_id: 99, // instructor replied after student
            author_name: 'Prof Jones',
            comment: 'Answered your question.',
            created_at: '2026-06-02T10:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as { findings: object[] }
      expect(result.findings).toHaveLength(0)
    })

    it('does NOT flag a graded submission where the student comment is OLDER than graded_at', async () => {
      const submission = makeSubmission({
        graded_at: '2026-06-05T10:00:00Z',
        workflow_state: 'graded',
        submission_comments: [
          {
            id: 1,
            author_id: 42, // student comment before grading
            author_name: 'Alice Smith',
            comment: 'Submitted my work.',
            created_at: '2026-06-01T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as { findings: object[] }
      expect(result.findings).toHaveLength(0)
    })

    it('sorts findings ascending by latest_student_comment.created_at (longest-waiting first)', async () => {
      const older = makeSubmission({
        id: 1,
        assignment_id: 100,
        user_id: 42,
        graded_at: null,
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice',
            comment: 'Older question.',
            created_at: '2026-06-01T09:00:00Z',
          },
        ],
      })
      const newer = makeSubmission({
        id: 2,
        assignment_id: 101,
        user_id: 43,
        graded_at: null,
        submission_comments: [
          {
            id: 2,
            author_id: 43,
            author_name: 'Bob',
            comment: 'Newer question.',
            created_at: '2026-06-05T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([newer, older])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ assignment_id: number }>
      }
      expect(result.findings[0].assignment_id).toBe(100) // older first
      expect(result.findings[1].assignment_id).toBe(101)
    })

    it('filters by unread_only when specified', async () => {
      const unread = makeSubmission({
        id: 1,
        assignment_id: 100,
        user_id: 42,
        graded_at: null,
        read_status: 'unread',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice',
            comment: 'Q',
            created_at: '2026-06-01T09:00:00Z',
          },
        ],
      })
      const alreadyRead = makeSubmission({
        id: 2,
        assignment_id: 101,
        user_id: 43,
        graded_at: null,
        read_status: 'read',
        submission_comments: [
          {
            id: 2,
            author_id: 43,
            author_name: 'Bob',
            comment: 'Q2',
            created_at: '2026-06-02T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([unread, alreadyRead])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10, unread_only: true })) as {
        findings: Array<{ assignment_id: number }>
      }
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].assignment_id).toBe(100)
    })

    it('passes assignment_ids to listForStudents when provided', async () => {
      const canvas = buildMockCanvas([])
      const tool = attentionTools(canvas)[0]
      await tool.handler({ course_id: 10, assignment_ids: [100, 200] })
      expect(canvas.submissions.listForStudents).toHaveBeenCalledWith(10, {
        student_ids: ['all'],
        assignment_ids: [100, 200],
        include: ['submission_comments', 'user', 'assignment', 'read_status'],
      })
    })

    it('counts unaddressed_comment_count as the trailing run of student comments', async () => {
      const submission = makeSubmission({
        graded_at: '2026-06-01T10:00:00Z',
        workflow_state: 'graded',
        submission_comments: [
          {
            id: 1,
            author_id: 99,
            author_name: 'Prof',
            comment: 'Good start.',
            created_at: '2026-06-01T10:00:00Z',
          },
          {
            id: 2,
            author_id: 42,
            author_name: 'Alice',
            comment: 'Follow-up 1.',
            created_at: '2026-06-02T08:00:00Z',
          },
          {
            id: 3,
            author_id: 42,
            author_name: 'Alice',
            comment: 'Follow-up 2.',
            created_at: '2026-06-03T08:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ unaddressed_comment_count: number }>
      }
      expect(result.findings[0].unaddressed_comment_count).toBe(2)
    })

    // Documented limitation: group submissions are a known false-negative
    it('(documented behavior) group submission: comment from non-submitter group member is NOT flagged', async () => {
      // submission.user_id is 42 (the submission owner), but comment author is 55 (group member)
      const submission = makeSubmission({
        graded_at: null,
        workflow_state: 'submitted',
        submission_comments: [
          {
            id: 1,
            author_id: 55, // different group member, not submission.user_id
            author_name: 'Group Peer',
            comment: 'I think we should add more detail.',
            created_at: '2026-06-03T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas)[0]
      const result = (await tool.handler({ course_id: 10 })) as { findings: object[] }
      // By design: group-member comments look like instructor comments at this layer
      expect(result.findings).toHaveLength(0)
    })
  })

  describe('pseudonymization', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'attention-tool-'))
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

    it('pseudonymizes user_name in findings when enabled', async () => {
      const submission = makeSubmission({
        graded_at: null,
        workflow_state: 'submitted',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice Smith',
            comment: 'Please review.',
            created_at: '2026-06-03T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas, makePseudonymizer())[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ user_name: string; user_id: number }>
      }
      expect(result.findings[0].user_name).toMatch(/^Student \d+$/)
    })

    it('passes through real user_name when pseudonymization disabled', async () => {
      const submission = makeSubmission({
        graded_at: null,
        workflow_state: 'submitted',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice Smith',
            comment: 'Please review.',
            created_at: '2026-06-03T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const tool = attentionTools(canvas, makePseudonymizer(false))[0]
      const result = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ user_name: string }>
      }
      expect(result.findings[0].user_name).toBe('Alice Smith')
    })

    it('preserves numeric user_id under pseudonymization (stable for follow-up calls)', async () => {
      const submission = makeSubmission({
        graded_at: null,
        workflow_state: 'submitted',
        submission_comments: [
          {
            id: 1,
            author_id: 42,
            author_name: 'Alice Smith',
            comment: 'Please review.',
            created_at: '2026-06-03T09:00:00Z',
          },
        ],
      })
      const canvas = buildMockCanvas([submission])
      const pseudonymizer = makePseudonymizer()
      const tool = attentionTools(canvas, pseudonymizer)[0]
      const result1 = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ user_id: number; user_name: string }>
      }
      const result2 = (await tool.handler({ course_id: 10 })) as {
        findings: Array<{ user_id: number; user_name: string }>
      }
      // Numeric ID preserved
      expect(result1.findings[0].user_id).toBe(42)
      // Pseudonym is stable across calls
      expect(result1.findings[0].user_name).toBe(result2.findings[0].user_name)
    })
  })
})
