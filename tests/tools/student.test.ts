import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas'
import type {
  CanvasCourse,
  CanvasEnrollment,
  CanvasSubmission,
  CanvasSubmissionComment,
  CanvasUpcomingEvent,
} from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { studentTools } from '../../src/tools/student'

describe('studentTools', () => {
  const mockCourse: CanvasCourse = {
    id: 1,
    name: 'Intro to CS',
    course_code: 'CS101',
    workflow_state: 'available',
  }

  const mockEnrollment: CanvasEnrollment = {
    id: 10,
    course_id: 1,
    user_id: 5,
    type: 'StudentEnrollment',
    role: 'StudentEnrollment',
    enrollment_state: 'active',
    grades: {
      current_grade: 'A',
      current_score: 95,
      final_grade: 'A',
      final_score: 95,
    },
  }

  const mockSubmission: CanvasSubmission = {
    id: 100,
    assignment_id: 20,
    user_id: 5,
    submitted_at: '2026-04-01T10:00:00Z',
    score: 90,
    grade: 'A-',
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'graded',
  }

  const mockUpcomingEvent: CanvasUpcomingEvent = {
    id: 200,
    title: 'Homework 3',
    type: 'Assignment',
    workflow_state: 'published',
    context_code: 'course_1',
    start_at: '2026-04-20T23:59:00Z',
    end_at: null,
  }

  // --- get_my_submission_feedback fixtures (course 1, assignment 20, submission 100, owner 5) ---
  const teacherComment: CanvasSubmissionComment = {
    id: 900,
    author_id: 7, // matches feedbackSubmission.grader_id
    author_name: 'Dr. Chen',
    comment: 'Nice improvement on the thesis statement.',
    created_at: '2026-06-30T14:02:00Z',
  }
  const peerComment: CanvasSubmissionComment = {
    id: 901,
    author_id: 55, // not user_id, not grader_id
    author_name: 'Jordan (peer reviewer)',
    comment: 'I think question 3 could use a source.',
    created_at: '2026-06-29T09:00:00Z',
  }
  const selfComment: CanvasSubmissionComment = {
    id: 902,
    author_id: 5, // === submission.user_id
    author_name: 'Alex Rivera',
    comment: 'Is this graded against the new rubric?',
    created_at: '2026-06-28T08:00:00Z',
  }

  const feedbackSubmission: CanvasSubmission = {
    id: 100,
    assignment_id: 20,
    user_id: 5,
    grader_id: 7,
    submitted_at: '2026-06-25T10:00:00Z',
    graded_at: '2026-06-30T14:00:00Z',
    score: 88,
    grade: 'B+',
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'graded',
    read_status: 'unread',
    html_url: 'https://school.instructure.com/courses/1/assignments/20/submissions/5',
    user: { id: 5, name: 'Alex Rivera', short_name: 'Alex', sortable_name: 'Rivera, Alex' },
    assignment: {
      id: 20,
      name: 'Essay 2',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_text_entry'],
      course_id: 1,
      allowed_attempts: -1,
    },
    course: { id: 1, name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
    submission_comments: [selfComment, peerComment, teacherComment],
  }

  const noFeedbackSubmission: CanvasSubmission = {
    id: 101,
    assignment_id: 21,
    user_id: 5,
    submitted_at: '2026-06-20T10:00:00Z',
    graded_at: null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'submitted',
    read_status: 'read',
    submission_comments: [selfComment], // only self — not "feedback"
  }

  const noCommentsSubmission: CanvasSubmission = {
    id: 102,
    assignment_id: 22,
    user_id: 5,
    submitted_at: '2026-06-15T10:00:00Z',
    graded_at: null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'submitted',
    submission_comments: [],
  }

  const readFeedbackSubmission: CanvasSubmission = {
    ...feedbackSubmission,
    id: 103,
    assignment_id: 23,
    read_status: 'read',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      courses: {
        list: vi.fn().mockResolvedValue([mockCourse]),
      },
      enrollments: {
        listMyGrades: vi.fn().mockResolvedValue([mockEnrollment]),
      },
      submissions: {
        listMy: vi.fn().mockResolvedValue([mockSubmission]),
      },
      users: {
        getUpcomingAssignments: vi.fn().mockResolvedValue([mockUpcomingEvent]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 5 tool definitions', () => {
    expect(studentTools(buildMockCanvas())).toHaveLength(5)
  })

  it('exports tools with correct names', () => {
    const names = studentTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'get_my_courses',
      'get_my_grades',
      'get_my_submissions',
      'get_my_upcoming_assignments',
      'get_my_submission_feedback',
    ])
  })

  it('all student tools have read-only annotations', () => {
    for (const tool of studentTools(buildMockCanvas())) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    }
  })

  describe('get_my_courses', () => {
    it('delegates to canvas.courses.list with enrollment_state=active', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_courses')!
      const result = await tool.handler({})
      expect(canvas.courses.list).toHaveBeenCalledWith({ enrollment_state: 'active' })
      expect(result).toEqual([mockCourse])
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.list).mockRejectedValue(
        new CanvasApiError('Unauthorized', 401, '/api/v1/courses'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_courses')!
      await expect(tool.handler({})).rejects.toThrow(CanvasApiError)
    })
  })

  describe('get_my_grades', () => {
    it('delegates to canvas.enrollments.listMyGrades without courseId', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_grades')!
      const result = await tool.handler({})
      expect(canvas.enrollments.listMyGrades).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockEnrollment])
    })

    it('delegates to canvas.enrollments.listMyGrades with courseId', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_grades')!
      await tool.handler({ course_id: 1 })
      expect(canvas.enrollments.listMyGrades).toHaveBeenCalledWith(1)
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.enrollments.listMyGrades).mockRejectedValue(
        new CanvasApiError('Not Found', 404, '/api/v1/users/self/enrollments'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_grades')!
      await expect(tool.handler({})).rejects.toThrow(CanvasApiError)
    })
  })

  describe('get_my_submissions', () => {
    it('delegates to canvas.submissions.listMy', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_submissions')!
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.submissions.listMy).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockSubmission])
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockRejectedValue(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/students/submissions'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_submissions')!
      await expect(tool.handler({ course_id: 1 })).rejects.toThrow(CanvasApiError)
    })
  })

  describe('get_my_upcoming_assignments', () => {
    it('delegates to canvas.users.getUpcomingAssignments', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_upcoming_assignments')!
      const result = await tool.handler({})
      expect(canvas.users.getUpcomingAssignments).toHaveBeenCalled()
      expect(result).toEqual([mockUpcomingEvent])
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.users.getUpcomingAssignments).mockRejectedValue(
        new CanvasApiError('Unauthorized', 401, '/api/v1/users/self/upcoming_events'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_upcoming_assignments')!
      await expect(tool.handler({})).rejects.toThrow(CanvasApiError)
    })
  })

  describe('get_my_submission_feedback', () => {
    function getTool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
      return studentTools(canvas, pseudonymizer).find(
        (t) => t.name === 'get_my_submission_feedback',
      )!
    }

    it('filters out submissions with no non-self feedback', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([
        feedbackSubmission,
        noFeedbackSubmission,
        noCommentsSubmission,
      ])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as {
        findings_count: number
        submissions_scanned: number
        findings: Array<{ submission_id: number }>
      }
      expect(result.submissions_scanned).toBe(3)
      expect(result.findings_count).toBe(1)
      expect(result.findings[0].submission_id).toBe(100)
    })

    it('classifies self / peer / teacher comment authors', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as {
        findings: Array<{
          feedback_author_roles: string[]
          comments: Array<{ id: number; author_role: string }>
        }>
      }
      const finding = result.findings[0]
      const roleById = (id: number) => finding.comments.find((c) => c.id === id)!.author_role
      expect(roleById(902)).toBe('self')
      expect(roleById(901)).toBe('peer')
      expect(roleById(900)).toBe('teacher')
      expect(new Set(finding.feedback_author_roles)).toEqual(new Set(['peer', 'teacher']))
    })

    it('picks the newest non-self comment for latest_feedback_comment', async () => {
      const canvas = buildMockCanvas()
      // self comment is the chronologically newest — it must still be excluded from "latest feedback"
      const selfNewest: CanvasSubmissionComment = {
        ...selfComment,
        created_at: '2026-07-05T00:00:00Z',
      }
      const submission: CanvasSubmission = {
        ...feedbackSubmission,
        submission_comments: [teacherComment, peerComment, selfNewest],
      }
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([submission])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as {
        findings: Array<{ latest_feedback_comment: { id: number } }>
      }
      expect(result.findings[0].latest_feedback_comment.id).toBe(900) // teacher (06-30), not self (07-05)
    })

    it('unread_only excludes submissions the student has already read', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([
        feedbackSubmission,
        readFeedbackSubmission,
      ])
      const result = (await getTool(canvas).handler({ course_id: 1, unread_only: true })) as {
        findings_count: number
        findings: Array<{ submission_id: number }>
      }
      expect(result.findings_count).toBe(1)
      expect(result.findings[0].submission_id).toBe(100)
    })

    it('scans all active courses when course_id is omitted', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.list).mockResolvedValue([
        { id: 1, name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
        { id: 2, name: 'Calc', course_code: 'MATH101', workflow_state: 'available' },
      ])
      vi.mocked(canvas.submissions.listMy).mockImplementation(async (courseId: number) =>
        courseId === 1 ? [feedbackSubmission] : [],
      )
      const result = (await getTool(canvas).handler({})) as { courses_scanned: number }
      expect(canvas.courses.list).toHaveBeenCalledWith({ enrollment_state: 'active' })
      expect(canvas.submissions.listMy).toHaveBeenCalledTimes(2)
      expect(canvas.submissions.listMy).toHaveBeenCalledWith(1, {
        include: ['submission_comments', 'user', 'assignment', 'course', 'read_status'],
      })
      expect(canvas.submissions.listMy).toHaveBeenCalledWith(2, {
        include: ['submission_comments', 'user', 'assignment', 'course', 'read_status'],
      })
      expect(result.courses_scanned).toBe(2)
    })

    it('returns nothing and never calls listMy when there are no active courses', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.list).mockResolvedValue([])
      const result = (await getTool(canvas).handler({})) as { findings_count: number }
      expect(result.findings_count).toBe(0)
      expect(canvas.submissions.listMy).not.toHaveBeenCalled()
    })

    it('passes through course/assignment/score/url metadata', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as {
        findings: Array<{
          course_name: string | null
          assignment_name: string | null
          score: number | null
          workflow_state: string
          read_status: string | null
          html_url: string | null
        }>
      }
      const finding = result.findings[0]
      expect(finding.course_name).toBe('Intro to CS')
      expect(finding.assignment_name).toBe('Essay 2')
      expect(finding.score).toBe(88)
      expect(finding.workflow_state).toBe('graded')
      expect(finding.read_status).toBe('unread')
      expect(finding.html_url).toBe(
        'https://school.instructure.com/courses/1/assignments/20/submissions/5',
      )
    })

    it('defaults an ungraded submission (grader_id null) non-self author to peer', async () => {
      const canvas = buildMockCanvas()
      const ungraded: CanvasSubmission = {
        ...feedbackSubmission,
        grader_id: null,
        graded_at: null,
        score: null,
        grade: null,
        workflow_state: 'submitted',
        submission_comments: [teacherComment], // author_id 7, but no grader_id to match
      }
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([ungraded])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as {
        findings: Array<{ comments: Array<{ id: number; author_role: string }> }>
      }
      expect(result.findings[0].comments.find((c) => c.id === 900)!.author_role).toBe('peer')
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockRejectedValue(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/students/submissions'),
      )
      await expect(getTool(canvas).handler({ course_id: 1 })).rejects.toThrow(CanvasApiError)
    })

    describe('pseudonymization', () => {
      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'student-feedback-'))
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

      it('passes real author names through when disabled', async () => {
        const canvas = buildMockCanvas()
        vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
        const result = (await getTool(canvas, makePseudonymizer(false)).handler({
          course_id: 1,
        })) as { findings: Array<{ comments: Array<{ id: number; author_name: string }> }> }
        const nameById = (id: number) =>
          result.findings[0].comments.find((c) => c.id === id)!.author_name
        expect(nameById(900)).toBe('Dr. Chen')
        expect(nameById(901)).toBe('Jordan (peer reviewer)')
        expect(nameById(902)).toBe('Alex Rivera')
      })

      it('pseudonymizes peer and self authors but not the recorded grader', async () => {
        const canvas = buildMockCanvas()
        vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
        const result = (await getTool(canvas, makePseudonymizer()).handler({
          course_id: 1,
        })) as { findings: Array<{ comments: Array<{ id: number; author_name: string }> }> }
        const nameById = (id: number) =>
          result.findings[0].comments.find((c) => c.id === id)!.author_name
        // teacher (recorded grader) keeps their real name
        expect(nameById(900)).toBe('Dr. Chen')
        // peer reviewer is pseudonymized
        expect(nameById(901)).toMatch(/^Student \d+$/)
        expect(nameById(901)).not.toBe('Jordan (peer reviewer)')
        // self (the submission owner) is pseudonymized too, distinct from the peer
        expect(nameById(902)).toMatch(/^Student \d+$/)
        expect(nameById(902)).not.toBe(nameById(901))
      })

      it('reuses the same pseudonym for a peer across two calls', async () => {
        const canvas = buildMockCanvas()
        vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
        const pseudonymizer = makePseudonymizer()
        const tool = getTool(canvas, pseudonymizer)
        const peerName = (r: unknown) =>
          (
            r as { findings: Array<{ comments: Array<{ id: number; author_name: string }> }> }
          ).findings[0].comments.find((c) => c.id === 901)!.author_name
        const first = peerName(await tool.handler({ course_id: 1 }))
        const second = peerName(await tool.handler({ course_id: 1 }))
        expect(first).toMatch(/^Student \d+$/)
        expect(second).toBe(first)
      })
    })
  })
})
