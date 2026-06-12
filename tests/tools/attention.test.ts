import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CanvasApiError } from '../../src/canvas/client'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasEnrollment,
  CanvasStudentSummary,
  CanvasSubmission,
} from '../../src/canvas/types'
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
    enrollments: {
      listForCourse: vi.fn().mockResolvedValue([]),
    },
    analytics: {
      getStudentSummaries: vi.fn().mockResolvedValue([]),
    },
  } as unknown as CanvasClient
}

// ---------------------------------------------------------------------------
// Fixtures for Signal B (list_students_needing_attention)
// ---------------------------------------------------------------------------

const atRiskEnrollment: CanvasEnrollment = {
  id: 10,
  course_id: 101,
  user_id: 42,
  type: 'StudentEnrollment',
  enrollment_state: 'active',
  role: 'StudentEnrollment',
  last_activity_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  grades: { current_score: 58, current_grade: 'F', final_score: 58, final_grade: 'F' },
  user: { id: 42, name: 'Alice', sortable_name: 'Alice', short_name: 'Alice' },
}

const healthyEnrollment: CanvasEnrollment = {
  id: 11,
  course_id: 101,
  user_id: 99,
  type: 'StudentEnrollment',
  enrollment_state: 'active',
  role: 'StudentEnrollment',
  last_activity_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  grades: { current_score: 92, current_grade: 'A', final_score: 92, final_grade: 'A' },
  user: { id: 99, name: 'Bob', sortable_name: 'Bob', short_name: 'Bob' },
}

const atRiskSummary: CanvasStudentSummary = {
  id: 42,
  page_views: 5,
  participations: 1,
  tardiness_breakdown: { total: 10, on_time: 4, late: 3, missing: 2, floating: 1 },
}

const healthySummary: CanvasStudentSummary = {
  id: 99,
  page_views: 40,
  participations: 10,
  tardiness_breakdown: { total: 10, on_time: 10, late: 0, missing: 0, floating: 0 },
}

function buildAtRiskCanvas(
  enrollments: CanvasEnrollment[] = [atRiskEnrollment],
  summaries: CanvasStudentSummary[] = [atRiskSummary],
): CanvasClient {
  return {
    submissions: { listForStudents: vi.fn().mockResolvedValue([]) },
    enrollments: { listForCourse: vi.fn().mockResolvedValue(enrollments) },
    analytics: { getStudentSummaries: vi.fn().mockResolvedValue(summaries) },
  } as unknown as CanvasClient
}

describe('attentionTools', () => {
  it('returns an array with 2 tool definitions', () => {
    const tools = attentionTools(buildMockCanvas())
    expect(tools).toHaveLength(2)
  })

  it('exports tools with the correct names', () => {
    const tools = attentionTools(buildMockCanvas())
    expect(tools.map((t) => t.name)).toEqual([
      'list_submission_comments_needing_attention',
      'list_students_needing_attention',
    ])
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

  // -------------------------------------------------------------------------
  // Signal B: list_students_needing_attention
  // -------------------------------------------------------------------------

  describe('list_students_needing_attention', () => {
    function getTool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
      return attentionTools(canvas, pseudonymizer).find(
        (t) => t.name === 'list_students_needing_attention',
      )!
    }

    it('has readOnlyHint and openWorldHint annotations', () => {
      expect(getTool(buildAtRiskCanvas()).annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('returns correct students_scanned count and analytics_available true', async () => {
      const canvas = buildAtRiskCanvas(
        [atRiskEnrollment, healthyEnrollment],
        [atRiskSummary, healthySummary],
      )
      const result = (await getTool(canvas).handler({ course_id: 101 })) as Record<string, unknown>
      expect(result.students_scanned).toBe(2)
      expect(result.analytics_available).toBe(true)
    })

    it('echoes default thresholds_used', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
      })) as Record<string, unknown>
      expect(result.thresholds_used).toEqual({
        inactive_days: 7,
        min_missing: 1,
        min_late: 3,
        score_threshold: 70,
      })
    })

    it('echoes overridden thresholds_used', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
        inactive_days: 14,
        min_missing: 2,
        min_late: 5,
        score_threshold: 80,
      })) as Record<string, unknown>
      expect(result.thresholds_used).toEqual({
        inactive_days: 14,
        min_missing: 2,
        min_late: 5,
        score_threshold: 80,
      })
    })

    it('omits zero-signal students', async () => {
      const canvas = buildAtRiskCanvas([healthyEnrollment], [healthySummary])
      const result = (await getTool(canvas).handler({ course_id: 101 })) as Record<string, unknown>
      expect((result.findings as unknown[]).length).toBe(0)
    })

    it('flags inactive signal for student with old last_activity_at', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      const signals = findings[0].signals as Array<{ type: string }>
      expect(signals.some((s) => s.type === 'inactive')).toBe(true)
    })

    it('flags low_score signal for student below threshold', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      const signals = findings[0].signals as Array<{ type: string }>
      expect(signals.some((s) => s.type === 'low_score')).toBe(true)
    })

    it('flags missing_submissions and late_pattern from analytics', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      const types = (findings[0].signals as Array<{ type: string }>).map((s) => s.type)
      expect(types).toContain('missing_submissions')
      expect(types).toContain('late_pattern')
    })

    it('assigns risk_level high when 4 signals fire', async () => {
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      // inactive + low_score + missing_submissions + late_pattern = 4
      expect(findings[0].risk_level).toBe('high')
    })

    it('assigns risk_level medium when exactly 2 signals fire', async () => {
      // Only inactive + low_score (missing=0, late=0)
      const summary: CanvasStudentSummary = {
        ...atRiskSummary,
        tardiness_breakdown: { total: 5, on_time: 5, late: 0, missing: 0, floating: 0 },
      }
      const result = (await getTool(buildAtRiskCanvas([atRiskEnrollment], [summary])).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      expect(findings[0].risk_level).toBe('medium')
    })

    it('assigns risk_level low when exactly 1 signal fires', async () => {
      const enrollment: CanvasEnrollment = {
        ...atRiskEnrollment,
        grades: { current_score: 90, current_grade: 'A', final_score: 90, final_grade: 'A' },
      }
      const summary: CanvasStudentSummary = {
        ...atRiskSummary,
        tardiness_breakdown: { total: 5, on_time: 5, late: 0, missing: 0, floating: 0 },
      }
      const result = (await getTool(buildAtRiskCanvas([enrollment], [summary])).handler({
        course_id: 101,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      expect(findings[0].risk_level).toBe('low')
    })

    it('respects score_threshold override — skips low_score when score is above new threshold', async () => {
      // atRiskEnrollment has score=58; raising threshold to 50 means 58>=50, so low_score should NOT fire
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
        score_threshold: 50,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      const types = (findings[0].signals as Array<{ type: string }>).map((s) => s.type)
      expect(types).not.toContain('low_score')
    })

    it('respects min_late override — skips late_pattern when below raised threshold', async () => {
      // atRiskSummary has late=3; raising to 5 means 3<5, so late_pattern should NOT fire
      const result = (await getTool(buildAtRiskCanvas()).handler({
        course_id: 101,
        min_late: 5,
      })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      const types = (findings[0].signals as Array<{ type: string }>).map((s) => s.type)
      expect(types).not.toContain('late_pattern')
    })

    it('sorts high-risk before low-risk findings', async () => {
      const lowRisk: CanvasEnrollment = {
        ...atRiskEnrollment,
        user_id: 1,
        user: { id: 1, name: 'LowRisk', sortable_name: 'LowRisk', short_name: 'LowRisk' },
        grades: { current_score: 90, current_grade: 'A', final_score: 90, final_grade: 'A' },
      }
      const lowSummary: CanvasStudentSummary = {
        id: 1,
        page_views: 1,
        participations: 0,
        tardiness_breakdown: { total: 5, on_time: 5, late: 0, missing: 0, floating: 0 },
      }
      const highRisk: CanvasEnrollment = {
        ...atRiskEnrollment,
        user_id: 2,
        user: { id: 2, name: 'HighRisk', sortable_name: 'HighRisk', short_name: 'HighRisk' },
        grades: { current_score: 55, current_grade: 'F', final_score: 55, final_grade: 'F' },
      }
      const highSummary: CanvasStudentSummary = {
        id: 2,
        page_views: 1,
        participations: 0,
        tardiness_breakdown: { total: 10, on_time: 3, late: 4, missing: 3, floating: 0 },
      }
      const canvas = buildAtRiskCanvas([lowRisk, highRisk], [lowSummary, highSummary])
      const result = (await getTool(canvas).handler({ course_id: 101 })) as Record<string, unknown>
      const findings = result.findings as Array<Record<string, unknown>>
      expect(findings[0].user_id).toBe(2) // HighRisk first
      expect(findings[1].user_id).toBe(1) // LowRisk second
    })

    describe('analytics 404 degradation', () => {
      it('sets analytics_available false and appends a note', async () => {
        const canvas = buildAtRiskCanvas()
        vi.mocked(canvas.analytics.getStudentSummaries).mockRejectedValueOnce(
          new CanvasApiError('Not Found', 404, '/api/v1/courses/101/analytics/student_summaries'),
        )
        const result = (await getTool(canvas).handler({ course_id: 101 })) as Record<
          string,
          unknown
        >
        expect(result.analytics_available).toBe(false)
        expect(typeof result.note).toBe('string')
      })

      it('still reports inactive and low_score signals on analytics 404', async () => {
        const canvas = buildAtRiskCanvas()
        vi.mocked(canvas.analytics.getStudentSummaries).mockRejectedValueOnce(
          new CanvasApiError('Not Found', 404, '/api/v1/courses/101/analytics/student_summaries'),
        )
        const result = (await getTool(canvas).handler({ course_id: 101 })) as Record<
          string,
          unknown
        >
        const findings = result.findings as Array<Record<string, unknown>>
        const types = (findings[0].signals as Array<{ type: string }>).map((s) => s.type)
        expect(types).toContain('inactive')
        expect(types).toContain('low_score')
        expect(types).not.toContain('missing_submissions')
        expect(types).not.toContain('late_pattern')
      })

      it('rethrows non-404 analytics errors', async () => {
        const canvas = buildAtRiskCanvas()
        vi.mocked(canvas.analytics.getStudentSummaries).mockRejectedValueOnce(
          new CanvasApiError('Forbidden', 403, '/api/v1/courses/101/analytics/student_summaries'),
        )
        await expect(getTool(canvas).handler({ course_id: 101 })).rejects.toBeInstanceOf(
          CanvasApiError,
        )
      })
    })

    describe('pseudonymization', () => {
      const enrollmentWithPii: CanvasEnrollment = {
        ...atRiskEnrollment,
        sis_user_id: 'SIS-9999',
        user: {
          id: 42,
          name: 'Alice Smith',
          sortable_name: 'Smith, Alice',
          short_name: 'Alice',
          email: 'alice@example.edu',
        },
      }

      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'attention-b-'))
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

      it('replaces user_name with pseudonym when enabled', async () => {
        const canvas = buildAtRiskCanvas([enrollmentWithPii], [atRiskSummary])
        const result = (await getTool(canvas, makePseudonymizer()).handler({
          course_id: 101,
        })) as Record<string, unknown>
        const findings = result.findings as Array<Record<string, unknown>>
        expect(findings[0].user_name).toMatch(/^Student \d+$/)
      })

      it('preserves real user_name when pseudonymizer disabled', async () => {
        const canvas = buildAtRiskCanvas([enrollmentWithPii], [atRiskSummary])
        const result = (await getTool(canvas, makePseudonymizer(false)).handler({
          course_id: 101,
        })) as Record<string, unknown>
        const findings = result.findings as Array<Record<string, unknown>>
        expect(findings[0].user_name).toBe('Alice Smith')
      })

      it('preserves numeric user_id under pseudonymization', async () => {
        const canvas = buildAtRiskCanvas([enrollmentWithPii], [atRiskSummary])
        const result = (await getTool(canvas, makePseudonymizer()).handler({
          course_id: 101,
        })) as Record<string, unknown>
        const findings = result.findings as Array<Record<string, unknown>>
        expect(findings[0].user_id).toBe(42)
      })
    })
  })
})
