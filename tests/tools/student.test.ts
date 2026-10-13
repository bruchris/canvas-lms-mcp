import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { CanvasId } from '../../src/canvas/id'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasActivityStreamEntry, CanvasPlannerItem } from '../../src/canvas/types'
import {
  CANVAS_MESSAGE_CHARACTER_CAP,
  FIXTURE_CONTEXT_MESSAGE,
  FIXTURE_GROUP_DISCUSSION,
  FIXTURE_MESSAGE_AT_CAP,
} from '../fixtures/activity-stream'
import {
  FIXTURE_PLANNER_ALL_TYPES,
  FIXTURE_PLANNER_ASSIGNMENT,
  FIXTURE_PLANNER_NOTE,
} from '../fixtures/planner'
import { CanvasApiError } from '../../src/canvas'
import type {
  CanvasCourse,
  CanvasEnrollment,
  CanvasSubmission,
  CanvasSubmissionComment,
  CanvasUpcomingEvent,
} from '../../src/canvas/types'
import { Pseudonymizer, WITHHELD_AUTHOR_NAME } from '../../src/pseudonym/pseudonymizer'
import { studentTools } from '../../src/tools/student'

describe('studentTools', () => {
  const mockCourse: CanvasCourse = {
    id: '1',
    name: 'Intro to CS',
    course_code: 'CS101',
    workflow_state: 'available',
  }

  const mockEnrollment: CanvasEnrollment = {
    id: '10',
    course_id: '1',
    user_id: '5',
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
    id: '100',
    assignment_id: '20',
    user_id: '5',
    submitted_at: '2026-04-01T10:00:00Z',
    score: 90,
    grade: 'A-',
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'graded',
  }

  const mockUpcomingEvent: CanvasUpcomingEvent = {
    id: '200',
    title: 'Homework 3',
    type: 'Assignment',
    workflow_state: 'published',
    context_code: 'course_1',
    start_at: '2026-04-20T23:59:00Z',
    end_at: null,
  }

  // --- get_my_submission_feedback fixtures (course 1, assignment 20, submission 100, owner 5) ---
  const teacherComment: CanvasSubmissionComment = {
    id: '900',
    author_id: '7', // matches feedbackSubmission.grader_id
    author_name: 'Dr. Chen',
    comment: 'Nice improvement on the thesis statement.',
    created_at: '2026-06-30T14:02:00Z',
  }
  const peerComment: CanvasSubmissionComment = {
    id: '901',
    author_id: '55', // not user_id, not grader_id
    author_name: 'Jordan (peer reviewer)',
    comment: 'I think question 3 could use a source.',
    created_at: '2026-06-29T09:00:00Z',
  }
  const selfComment: CanvasSubmissionComment = {
    id: '902',
    author_id: '5', // === submission.user_id
    author_name: 'Alex Rivera',
    comment: 'Is this graded against the new rubric?',
    created_at: '2026-06-28T08:00:00Z',
  }

  const feedbackSubmission: CanvasSubmission = {
    id: '100',
    assignment_id: '20',
    user_id: '5',
    grader_id: '7',
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
    user: { id: '5', name: 'Alex Rivera', short_name: 'Alex', sortable_name: 'Rivera, Alex' },
    assignment: {
      id: '20',
      name: 'Essay 2',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_text_entry'],
      course_id: '1',
      allowed_attempts: -1,
    },
    course: { id: '1', name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
    submission_comments: [selfComment, peerComment, teacherComment],
  }

  const noFeedbackSubmission: CanvasSubmission = {
    id: '101',
    assignment_id: '21',
    user_id: '5',
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
    id: '102',
    assignment_id: '22',
    user_id: '5',
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
    id: '103',
    assignment_id: '23',
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
      activityStream: {
        getSummary: vi.fn().mockResolvedValue([{ type: 'Submission', count: 5, unread_count: 2 }]),
        getStream: vi.fn().mockResolvedValue([]),
      },
      planner: {
        listItems: vi.fn().mockResolvedValue([]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 8 tool definitions', () => {
    expect(studentTools(buildMockCanvas())).toHaveLength(8)
  })

  it('exports tools with correct names', () => {
    const names = studentTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'get_my_courses',
      'get_my_grades',
      'get_my_submissions',
      'get_my_upcoming_assignments',
      'get_my_submission_feedback',
      'get_my_activity_stream_summary',
      'get_my_activity_stream',
      'list_my_planner_items',
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
      await tool.handler({ course_id: '1' })
      expect(canvas.enrollments.listMyGrades).toHaveBeenCalledWith('1')
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
      const result = await tool.handler({ course_id: '1' })
      expect(canvas.submissions.listMy).toHaveBeenCalledWith('1')
      expect(result).toEqual([mockSubmission])
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockRejectedValue(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/students/submissions'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_submissions')!
      await expect(tool.handler({ course_id: '1' })).rejects.toThrow(CanvasApiError)
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
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings_count: number
        submissions_scanned: number
        findings: Array<{ submission_id: number }>
      }
      expect(result.submissions_scanned).toBe(3)
      expect(result.findings_count).toBe(1)
      expect(result.findings[0].submission_id).toBe('100')
    })

    it('classifies self / peer / teacher comment authors', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings: Array<{
          feedback_author_roles: string[]
          comments: Array<{ id: string; author_role: string }>
        }>
      }
      const finding = result.findings[0]
      const roleById = (id: number) =>
        finding.comments.find((c) => c.id === String(id))!.author_role
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
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings: Array<{ latest_feedback_comment: { id: number } }>
      }
      expect(result.findings[0].latest_feedback_comment.id).toBe('900') // teacher (06-30), not self (07-05)
    })

    it('unread_only excludes submissions the student has already read', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([
        feedbackSubmission,
        readFeedbackSubmission,
      ])
      const result = (await getTool(canvas).handler({ course_id: '1', unread_only: true })) as {
        findings_count: number
        findings: Array<{ submission_id: number }>
      }
      expect(result.findings_count).toBe(1)
      expect(result.findings[0].submission_id).toBe('100')
    })

    it('scans all active courses when course_id is omitted', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.list).mockResolvedValue([
        { id: '1', name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
        { id: '2', name: 'Calc', course_code: 'MATH101', workflow_state: 'available' },
      ])
      vi.mocked(canvas.submissions.listMy).mockImplementation(async (courseId: number) =>
        courseId === 1 ? [feedbackSubmission] : [],
      )
      const result = (await getTool(canvas).handler({})) as { courses_scanned: number }
      expect(canvas.courses.list).toHaveBeenCalledWith({ enrollment_state: 'active' })
      expect(canvas.submissions.listMy).toHaveBeenCalledTimes(2)
      expect(canvas.submissions.listMy).toHaveBeenCalledWith('1', {
        include: ['submission_comments', 'user', 'assignment', 'course', 'read_status'],
      })
      expect(canvas.submissions.listMy).toHaveBeenCalledWith('2', {
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
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
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
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings: Array<{ comments: Array<{ id: string; author_role: string }> }>
      }
      expect(result.findings[0].comments.find((c) => c.id === '900')!.author_role).toBe('peer')
    })

    it('propagates CanvasApiError on the explicit single-course path', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.submissions.listMy).mockRejectedValue(
        new CanvasApiError('Forbidden', 403, '/api/v1/courses/1/students/submissions'),
      )
      await expect(getTool(canvas).handler({ course_id: '1' })).rejects.toThrow(CanvasApiError)
    })

    it('sorts findings most-recent-feedback-first', async () => {
      const canvas = buildMockCanvas()
      // feedbackSubmission's latest feedback is the teacher comment on 2026-06-30.
      const newerFeedbackSubmission: CanvasSubmission = {
        ...feedbackSubmission,
        id: '200',
        assignment_id: '24',
        submission_comments: [
          {
            id: '950',
            author_id: '7', // grader -> teacher
            author_name: 'Dr. Chen',
            comment: 'A later note.',
            created_at: '2026-07-01T10:00:00Z',
          },
        ],
      }
      // input order is oldest-first on purpose, to prove the handler re-sorts
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([
        feedbackSubmission,
        newerFeedbackSubmission,
      ])
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings: Array<{ submission_id: number }>
      }
      expect(result.findings.map((f) => f.submission_id)).toEqual(['200', '100'])
    })

    it('keeps both findings (stable order) when latest feedback ties on the same timestamp', async () => {
      const canvas = buildMockCanvas()
      const tiedComment = (id: number): CanvasSubmissionComment => ({
        id,
        author_id: '7',
        author_name: 'Dr. Chen',
        comment: 'Same-second note.',
        created_at: '2026-07-02T12:00:00Z',
      })
      const first: CanvasSubmission = {
        ...feedbackSubmission,
        id: '210',
        submission_comments: [tiedComment(960)],
      }
      const second: CanvasSubmission = {
        ...feedbackSubmission,
        id: '211',
        submission_comments: [tiedComment(961)],
      }
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([first, second])
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings_count: number
        findings: Array<{ submission_id: number }>
      }
      expect(result.findings_count).toBe(2)
      // equal-timestamp comparator returns 0 -> stable sort preserves input order
      expect(result.findings.map((f) => f.submission_id)).toEqual(['210', '211'])
    })

    it('tolerates a failing course during an all-courses scan and reports it', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.courses.list).mockResolvedValue([
        { id: '1', name: 'Intro to CS', course_code: 'CS101', workflow_state: 'available' },
        { id: '2', name: 'Concluded', course_code: 'HIST101', workflow_state: 'available' },
      ])
      vi.mocked(canvas.submissions.listMy).mockImplementation(async (courseId: CanvasId) => {
        if (courseId === '2') {
          throw new CanvasApiError('Forbidden', 403, '/api/v1/courses/2/students/submissions')
        }
        return [feedbackSubmission]
      })
      const result = (await getTool(canvas).handler({})) as {
        courses_scanned: number
        courses_failed: Array<{ course_id: string; status: number | null }>
        findings_count: number
      }
      expect(result.courses_scanned).toBe(2)
      expect(result.findings_count).toBe(1) // course 1's feedback still returned
      expect(result.courses_failed).toEqual([{ course_id: '2', status: 403, message: 'Forbidden' }])
    })

    it('reports read_status as null when Canvas omits it', async () => {
      const canvas = buildMockCanvas()
      const noReadStatus: CanvasSubmission = {
        ...feedbackSubmission,
        id: '400',
        read_status: undefined,
      }
      vi.mocked(canvas.submissions.listMy).mockResolvedValue([noReadStatus])
      const result = (await getTool(canvas).handler({ course_id: '1' })) as {
        findings: Array<{ read_status: string | null }>
      }
      expect(result.findings[0].read_status).toBeNull()
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
          course_id: '1',
        })) as { findings: Array<{ comments: Array<{ id: string; author_name: string }> }> }
        const nameById = (id: number) =>
          result.findings[0].comments.find((c) => c.id === String(id))!.author_name
        expect(nameById(900)).toBe('Dr. Chen')
        expect(nameById(901)).toBe('Jordan (peer reviewer)')
        expect(nameById(902)).toBe('Alex Rivera')
      })

      it('pseudonymizes peer and self authors but not the recorded grader', async () => {
        const canvas = buildMockCanvas()
        vi.mocked(canvas.submissions.listMy).mockResolvedValue([feedbackSubmission])
        const result = (await getTool(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as { findings: Array<{ comments: Array<{ id: string; author_name: string }> }> }
        const nameById = (id: number) =>
          result.findings[0].comments.find((c) => c.id === String(id))!.author_name
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
            r as { findings: Array<{ comments: Array<{ id: string; author_name: string }> }> }
          ).findings[0].comments.find((c) => c.id === '901')!.author_name
        const first = peerName(await tool.handler({ course_id: '1' }))
        const second = peerName(await tool.handler({ course_id: '1' }))
        expect(first).toMatch(/^Student \d+$/)
        expect(second).toBe(first)
      })

      it('keeps the recorded grader name even when that user is a peer commenter elsewhere', async () => {
        // Same user (id 7) is the recorded grader on submission A (teacher) and a
        // non-grader commenter on submission B (peer) in the same course. The peer
        // pre-warm allocates a pseudonym for user 7 in the shared course map; the
        // teacher comment on A must still keep its real name.
        const canvas = buildMockCanvas()
        const graderComment: CanvasSubmissionComment = {
          id: '800',
          author_id: '7',
          author_name: 'Dr. Chen',
          comment: 'Graded feedback on your essay.',
          created_at: '2026-06-30T10:00:00Z',
        }
        const sameUserPeerComment: CanvasSubmissionComment = {
          id: '801',
          author_id: '7',
          author_name: 'Dr. Chen',
          comment: 'A note left without being the grader here.',
          created_at: '2026-06-29T10:00:00Z',
        }
        const subA: CanvasSubmission = {
          ...feedbackSubmission,
          id: '300',
          assignment_id: '30',
          grader_id: '7',
          submission_comments: [graderComment],
        }
        const subB: CanvasSubmission = {
          ...feedbackSubmission,
          id: '301',
          assignment_id: '31',
          grader_id: '99', // author 7 is NOT the grader here -> peer
          submission_comments: [sameUserPeerComment],
        }
        vi.mocked(canvas.submissions.listMy).mockResolvedValue([subA, subB])
        const result = (await getTool(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as {
          findings: Array<{
            submission_id: number
            comments: Array<{ id: string; author_role: string; author_name: string }>
          }>
        }
        const findingFor = (id: number) =>
          result.findings.find((f) => f.submission_id === String(id))!
        const teacherOnA = findingFor(300).comments.find((c) => c.id === '800')!
        const peerOnB = findingFor(301).comments.find((c) => c.id === '801')!
        expect(teacherOnA.author_role).toBe('teacher')
        expect(teacherOnA.author_name).toBe('Dr. Chen') // grader name preserved
        expect(peerOnB.author_role).toBe('peer')
        expect(peerOnB.author_name).toMatch(/^Student \d+$/) // same user, masked as a peer here
      })

      describe('a comment author Canvas has already anonymized (BRU-2865)', () => {
        // `submission_comment_json` sets `author_id: nil`, `author: {}` and
        // `author_name: "Anonymous User"` TOGETHER in its non-`:read_author`
        // branch (lib/api/v1/submission_comment.rb:68-72 at the pinned Canvas
        // SHA 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c). Canvas has already
        // anonymized that comment: there is no identity to key a pseudonym on,
        // and no name to mask.
        //
        // `classifyCommentAuthor` reads it as 'peer' — a nil `author_id`
        // matches neither `submission.user_id` nor `grader_id` — so the peer
        // pre-warm used to pass that nil into `anonymizeUser`, which keys the
        // course map on `String(null)`.
        const anonymousComment: CanvasSubmissionComment = {
          id: '903',
          author_id: null,
          author_name: 'Anonymous User',
          comment: 'A review from someone you may not see.',
          created_at: '2026-06-29T12:00:00Z',
          author: {},
        }
        // One unreadable author and one ordinary readable peer on the same
        // submission, so every assertion below carries its own control: the
        // readable peer must still be warmed, keyed and masked.
        const submissionWithAnonymousAuthor: CanvasSubmission = {
          ...feedbackSubmission,
          submission_comments: [selfComment, anonymousComment, peerComment, teacherComment],
        }

        async function readCourseMap() {
          const { mapFilePath } = await import('../../src/pseudonym/paths')
          return JSON.parse(
            await readFile(mapFilePath(tmpDir, 'school.instructure.com', '1'), 'utf8'),
          ) as { students: Record<string, unknown>; next_pseudonym_index: number }
        }

        function runTool() {
          const canvas = buildMockCanvas()
          vi.mocked(canvas.submissions.listMy).mockResolvedValue([submissionWithAnonymousAuthor])
          return getTool(canvas, makePseudonymizer()).handler({ course_id: '1' }) as Promise<{
            findings: Array<{
              comments: Array<{ id: string; author_role: string; author_name: string }>
            }>
          }>
        }

        it('writes no "null" key to the persisted course map', async () => {
          await runTool()

          const map = await readCourseMap()

          // The readable peer (55) and the submitting student (5), and nobody
          // else. A `"null"` key here means the pre-warm keyed the map on
          // `String(comment.author_id)` regardless of whether the comment
          // carries an author at all. The readable peer being present is the
          // control: this is not a blanket "stop warming comment authors".
          expect(Object.keys(map.students).sort()).toEqual(['5', '55'])
        })

        it('spends no pseudonym index on it, so real students keep their numbering', async () => {
          const result = await runTool()

          const map = await readCourseMap()
          const nameById = (id: string) =>
            result.findings[0].comments.find((c) => c.id === id)!.author_name

          // Allocation order: the peer pre-warm runs first (readable peers, in
          // comment order), then `anonymizeSubmission` warms the submitter.
          // With the unreadable author warmed as if it were a person it took
          // index 1 and shifted both real students by one.
          expect(nameById('901')).toBe('Student 1') // readable peer
          expect(nameById('902')).toBe('Student 2') // the submitting student
          expect(map.next_pseudonym_index).toBe(3)
        })

        it('leaves Canvas’s own byline alone (characterization — passes without the fix)', async () => {
          // Deliberately not load-bearing: with the write side closed there is
          // no `"null"` key for a read to find, so this holds whether or not
          // either guard exists. It is here to pin the user-visible half of
          // "hygiene, not a name leak", and the test below is the armed
          // version of it.
          const result = await runTool()
          const anonymous = result.findings[0].comments.find((c) => c.id === '903')!

          expect(anonymous.author_name).toBe('Anonymous User')
          expect(anonymous.author_name).not.toMatch(/^Student \d+$/)
          // Canvas emits no author id for this comment, so there is no role to
          // infer: 'peer' is what "not you, not your grader" resolves to. Left
          // as-is rather than given a role of its own — `author_role` is a
          // published output field, so a new value is an output-contract
          // change, and nothing downstream reads 'peer' as "a classmate".
          expect(anonymous.author_role).toBe('peer')
        })

        it('keeps that byline even when the map already holds a "null" key (read-side guard, BRU-2863)', async () => {
          // The armed counterpart. The course map is persisted and never
          // migrated, so a map written by <= 2.1.0 — when this tool still
          // warmed the key — can already hold a `"null"` entry. BRU-2863's own
          // test covers the read guard through `get_my_activity_stream`; this
          // one covers it through the second tool that shares the method.
          const pseudonymizer = makePseudonymizer()
          await pseudonymizer.anonymizeUser('1', {
            id: null,
            name: 'Anonymous User',
          } as unknown as Parameters<typeof pseudonymizer.anonymizeUser>[1])

          const canvas = buildMockCanvas()
          vi.mocked(canvas.submissions.listMy).mockResolvedValue([submissionWithAnonymousAuthor])
          const result = (await getTool(canvas, pseudonymizer).handler({
            course_id: '1',
          })) as { findings: Array<{ comments: Array<{ id: string; author_name: string }> }> }
          const commentById = (id: string) => result.findings[0].comments.find((c) => c.id === id)!

          expect(commentById('903').author_name).toBe('Anonymous User')
          // Control: same run, same poisoned map, and the readable peer is
          // still masked — the guard refuses one comment, not the map.
          expect(commentById('901').author_name).toMatch(/^Student \d+$/)
        })

        it('does not accumulate a junk key across repeated calls', async () => {
          await runTool()
          await runTool()

          const map = await readCourseMap()

          expect(Object.keys(map.students).sort()).toEqual(['5', '55'])
          expect(map.next_pseudonym_index).toBe(3)
        })
      })
    })
  })

  describe('get_my_activity_stream_summary', () => {
    it('delegates to canvas.activityStream.getSummary without only_active_courses', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_activity_stream_summary')!
      const result = await tool.handler({})
      expect(canvas.activityStream.getSummary).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([{ type: 'Submission', count: 5, unread_count: 2 }])
    })

    it('delegates to canvas.activityStream.getSummary with only_active_courses', async () => {
      const canvas = buildMockCanvas()
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_activity_stream_summary')!
      await tool.handler({ only_active_courses: true })
      expect(canvas.activityStream.getSummary).toHaveBeenCalledWith(true)
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.activityStream.getSummary).mockRejectedValue(
        new CanvasApiError('Unauthorized', 401, '/api/v1/users/self/activity_stream/summary'),
      )
      const tool = studentTools(canvas).find((t) => t.name === 'get_my_activity_stream_summary')!
      await expect(tool.handler({})).rejects.toThrow(CanvasApiError)
    })
  })

  describe('get_my_activity_stream', () => {
    function streamCanvas(items: CanvasActivityStreamEntry[]): CanvasClient {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.activityStream.getStream).mockResolvedValue(items)
      return canvas
    }

    function streamTool(canvas: CanvasClient) {
      return studentTools(canvas).find((t) => t.name === 'get_my_activity_stream')!
    }

    /** `n` plausible common-prefix-only items — enough to exercise the cap. */
    function manyItems(n: number): CanvasActivityStreamEntry[] {
      return Array.from({ length: n }, (_, i) => ({
        ...FIXTURE_CONTEXT_MESSAGE,
        id: String(10_000 + i),
      }))
    }

    type StreamEnvelope = {
      items: CanvasActivityStreamEntry[]
      total_items: number
      truncated: boolean
      truncation_note: string | null
      retention_note: string
    }

    it('reports truncation and caps the items at max_items (AC-11)', async () => {
      const canvas = streamCanvas(manyItems(250))
      const result = (await streamTool(canvas).handler({ max_items: 100 })) as StreamEnvelope

      expect(result.items).toHaveLength(100)
      expect(result.total_items).toBe(100)
      expect(result.truncated).toBe(true)
      expect(result.truncation_note).not.toBeNull()
      expect(result.truncation_note).toContain('max_items')
      expect(result.retention_note).toBeTruthy()
    })

    it('asks the client for one item past the limit, so truncation is knowable at all (AC-11)', async () => {
      // paginate() reports what it accumulated, never whether more was waiting.
      // Asking for exactly `max_items` makes "exactly 100 exist" and "more
      // exist" indistinguishable, and `truncated` would be a guess.
      const canvas = streamCanvas(manyItems(250))
      await streamTool(canvas).handler({ max_items: 100 })

      expect(canvas.activityStream.getStream).toHaveBeenCalledWith({
        onlyActiveCourses: undefined,
        maxItems: 101,
      })
    })

    it('reports no truncation on a short stream, and still carries retention_note (AC-11)', async () => {
      const canvas = streamCanvas(manyItems(10))
      const result = (await streamTool(canvas).handler({})) as StreamEnvelope

      expect(result.items).toHaveLength(10)
      expect(result.total_items).toBe(10)
      expect(result.truncated).toBe(false)
      expect(result.truncation_note).toBeNull()
      // Unconditional: `truncated` answers "did we stop early?", never "did
      // Canvas already forget?" — and the retention horizon is an instance
      // Setting with no API surface, so there is no condition under which a
      // nullable retention note could be set correctly.
      expect(result.retention_note).toContain('stream_items_ttl')
    })

    it('defaults the cap to 100 when max_items is omitted', async () => {
      const canvas = streamCanvas(manyItems(5))
      await streamTool(canvas).handler({})

      expect(canvas.activityStream.getStream).toHaveBeenCalledWith({
        onlyActiveCourses: undefined,
        maxItems: 101,
      })
    })

    it('forwards only_active_courses', async () => {
      const canvas = streamCanvas([])
      await streamTool(canvas).handler({ only_active_courses: true })

      expect(canvas.activityStream.getStream).toHaveBeenCalledWith({
        onlyActiveCourses: true,
        maxItems: 101,
      })
    })

    it('round-trips a group-context item without inventing a course_id (AC-7)', async () => {
      const canvas = streamCanvas([FIXTURE_GROUP_DISCUSSION])
      const result = (await streamTool(canvas).handler({})) as StreamEnvelope

      const item = result.items[0]!
      // Absent, not null: Canvas emits one id key, named after the context type.
      expect(Object.keys(item)).not.toContain('course_id')
      expect(item.course_id).toBeUndefined()
      expect(item.group_id).toBe('7')
      expect(item.context_type).toBe('Group')
    })

    it('round-trips a common-prefix-only ContextMessage item (fixture 1)', async () => {
      const canvas = streamCanvas([FIXTURE_CONTEXT_MESSAGE])
      const result = (await streamTool(canvas).handler({})) as StreamEnvelope

      expect(result.items[0]).toEqual(FIXTURE_CONTEXT_MESSAGE)
      expect(result.truncated).toBe(false)
    })

    it('adds no truncation flag to a message of exactly 4096 characters (fixture 6)', async () => {
      // Canvas cuts `message` at 4096 characters at store time with NO marker,
      // so a cut message and a message that happens to be 4096 characters are
      // indistinguishable. A `message_truncated` heuristic would be a
      // false-positive generator; this test fails the day one is added.
      const canvas = streamCanvas([FIXTURE_MESSAGE_AT_CAP])
      const result = (await streamTool(canvas).handler({})) as StreamEnvelope

      const item = result.items[0]!
      expect((item.message as string).length).toBe(CANVAS_MESSAGE_CHARACTER_CAP)
      expect(Object.keys(item)).toEqual(Object.keys(FIXTURE_MESSAGE_AT_CAP))
      for (const invented of ['message_truncated', 'truncated', 'message_length']) {
        expect(Object.keys(item)).not.toContain(invented)
      }
      // Envelope truncation is about max_items only, never about Canvas's cut.
      expect(result.truncated).toBe(false)
    })

    it('propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.activityStream.getStream).mockRejectedValue(
        new CanvasApiError('Unauthorized', 401, '/api/v1/users/self/activity_stream'),
      )
      await expect(streamTool(canvas).handler({})).rejects.toThrow(CanvasApiError)
    })
  })

  describe('list_my_planner_items', () => {
    function plannerCanvas(items: CanvasPlannerItem[]): CanvasClient {
      const canvas = buildMockCanvas()
      vi.mocked(canvas.planner.listItems).mockResolvedValue(items)
      return canvas
    }

    function plannerTool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
      return studentTools(canvas, pseudonymizer).find((t) => t.name === 'list_my_planner_items')!
    }

    type PlannerEnvelope = {
      items: CanvasPlannerItem[]
      total_items: number
      truncated: boolean
      truncation_note: string | null
      start_date: string
      end_date: string
    }

    // AC-12 — both-or-neither dates reject with a reason.
    it('rejects start_date given alone, naming the ten-year default (AC-12)', async () => {
      const canvas = plannerCanvas([])
      await expect(plannerTool(canvas).handler({ start_date: '2026-10-01' })).rejects.toThrow(
        /10-year|ten-year/i,
      )
      expect(canvas.planner.listItems).not.toHaveBeenCalled()
    })

    it('rejects end_date given alone, naming the ten-year default (AC-12)', async () => {
      const canvas = plannerCanvas([])
      await expect(plannerTool(canvas).handler({ end_date: '2026-10-15' })).rejects.toThrow(
        /10-year|ten-year/i,
      )
      expect(canvas.planner.listItems).not.toHaveBeenCalled()
    })

    it('accepts both dates together and forwards them unchanged (AC-12)', async () => {
      const canvas = plannerCanvas([])
      const result = (await plannerTool(canvas).handler({
        start_date: '2026-10-01',
        end_date: '2026-10-15',
      })) as PlannerEnvelope

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-15' }),
      )
      expect(result.start_date).toBe('2026-10-01')
      expect(result.end_date).toBe('2026-10-15')
    })

    it('accepts neither date and echoes a resolved window (AC-12)', async () => {
      const canvas = plannerCanvas([])
      const result = (await plannerTool(canvas).handler({})) as PlannerEnvelope

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: undefined, endDate: undefined }),
      )
      // Our own ±2-week approximation, not a value read off Canvas's response
      // (it never echoes one) — only that some resolved window is reported.
      expect(result.start_date).toBeTruthy()
      expect(result.end_date).toBeTruthy()
      expect(new Date(result.start_date).getTime()).toBeLessThan(
        new Date(result.end_date).getTime(),
      )
    })

    // AC-13 — context_codes: [] is rejected at the Zod layer; omission is the
    // documented all-contexts behaviour, asserted as a control so the
    // rejection test cannot pass on a tool that is also broken for the valid
    // case. These are schema-level checks (`.min(1)`, `.regex(...)`), so they
    // are exercised through the schema directly rather than the raw handler
    // — calling `tool.handler()` bypasses Zod entirely, following the
    // `appointment-groups.test.ts` "validates scope enum" precedent.
    it('rejects an empty context_codes array at the schema level (AC-13)', () => {
      const schema = z.object(plannerTool(buildMockCanvas()).inputSchema)
      expect(schema.safeParse({ context_codes: [] }).success).toBe(false)
    })

    it('accepts a non-empty, well-formed context_codes array at the schema level (AC-13 control)', () => {
      const schema = z.object(plannerTool(buildMockCanvas()).inputSchema)
      expect(schema.safeParse({ context_codes: ['course_123', 'group_7'] }).success).toBe(true)
    })

    it('rejects a malformed context code at the schema level', () => {
      const schema = z.object(plannerTool(buildMockCanvas()).inputSchema)
      expect(schema.safeParse({ context_codes: ['course_0'] }).success).toBe(false)
    })

    it('sends no context_codes param when the field is omitted — the documented all-contexts case (AC-13 control)', async () => {
      const canvas = plannerCanvas([])
      await plannerTool(canvas).handler({})

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ contextCodes: undefined }),
      )
    })

    it('forwards a non-empty context_codes array', async () => {
      const canvas = plannerCanvas([])
      await plannerTool(canvas).handler({ context_codes: ['course_123', 'group_7'] })

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ contextCodes: ['course_123', 'group_7'] }),
      )
    })

    it('forwards filter', async () => {
      const canvas = plannerCanvas([])
      await plannerTool(canvas).handler({ filter: 'incomplete_items' })

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'incomplete_items' }),
      )
    })

    // AC-14 — submissions: false and submissions: {…} both round-trip with no
    // `undefined` reads.
    it('round-trips an item with submissions: false (AC-14)', async () => {
      const canvas = plannerCanvas([FIXTURE_PLANNER_NOTE])
      const result = (await plannerTool(canvas).handler({})) as PlannerEnvelope

      expect(result.items[0]!.submissions).toBe(false)
    })

    it('round-trips an item with submissions as an object (AC-14)', async () => {
      const graded = FIXTURE_PLANNER_ALL_TYPES[0]! // assignment, submissions is an object
      const canvas = plannerCanvas([graded])
      const result = (await plannerTool(canvas).handler({})) as PlannerEnvelope

      const submissions = result.items[0]!.submissions
      expect(submissions).not.toBe(false)
      expect((submissions as { graded?: boolean }).graded).toBe(true)
    })

    // Fixture 5 — a planner note with no html_url key at all.
    it('round-trips a planner note with no html_url key', async () => {
      const canvas = plannerCanvas([FIXTURE_PLANNER_NOTE])
      const result = (await plannerTool(canvas).handler({})) as PlannerEnvelope

      expect(Object.keys(result.items[0]!)).not.toContain('html_url')
    })

    // AC-15 — the nine-plannable-type fixture contains no user/user_name key,
    // and the anti-vacuity check proves all nine plannable_type values appear.
    it('carries no user or user_name key across all nine plannable types (AC-15)', async () => {
      const canvas = plannerCanvas(FIXTURE_PLANNER_ALL_TYPES)
      const result = (await plannerTool(canvas).handler({})) as PlannerEnvelope

      const types = new Set(result.items.map((item) => item.plannable_type))
      expect(types.size).toBe(9)

      const serialized = JSON.stringify(result.items)
      expect(serialized).not.toContain('"user"')
      expect(serialized).not.toContain('"user_name"')
    })

    // BRU-2878 — the AC-15 guard above only checked `"user"`/`"user_name"`
    // substrings, so it passed clean while `submissions.feedback.author_name`
    // (present on FIXTURE_PLANNER_ASSIGNMENT) shipped a real third-party name
    // unmasked. Assert on the actual field and the actual fixture value, not a
    // generic substring, so a future respelling of the leak cannot hide again.
    describe('feedback author pseudonymization (BRU-2878)', () => {
      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'student-planner-'))
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

      it('passes the real feedback author name through when disabled', async () => {
        const canvas = plannerCanvas([FIXTURE_PLANNER_ASSIGNMENT])
        const result = (await plannerTool(canvas, makePseudonymizer(false)).handler(
          {},
        )) as PlannerEnvelope

        const submissions = result.items[0]!.submissions as { feedback?: { author_name?: string } }
        expect(submissions.feedback?.author_name).toBe('Dr. Lin')
      })

      it('withholds the feedback author name and avatar when enabled', async () => {
        const canvas = plannerCanvas(FIXTURE_PLANNER_ALL_TYPES)
        const result = (await plannerTool(canvas, makePseudonymizer()).handler(
          {},
        )) as PlannerEnvelope

        const assignmentItem = result.items.find((item) => item.plannable_type === 'assignment')!
        const submissions = assignmentItem.submissions as {
          feedback?: { author_name?: string; author_avatar_url?: string | null }
        }
        expect(submissions.feedback?.author_name).toBe(WITHHELD_AUTHOR_NAME)
        expect(submissions.feedback?.author_avatar_url ?? null).toBeNull()

        const serialized = JSON.stringify(result.items)
        expect(serialized).not.toContain('Dr. Lin')
      })
    })

    it('reports truncation and caps items at max_items', async () => {
      const many = Array.from({ length: 150 }, (_, i) => ({
        ...FIXTURE_PLANNER_NOTE,
        plannable_id: String(5000 + i),
      }))
      const canvas = plannerCanvas(many)
      const result = (await plannerTool(canvas).handler({ max_items: 100 })) as PlannerEnvelope

      expect(result.items).toHaveLength(100)
      expect(result.truncated).toBe(true)
      expect(result.truncation_note).toContain('max_items')
    })

    it('asks the client for one item past the limit, so truncation is knowable at all', async () => {
      const canvas = plannerCanvas([])
      await plannerTool(canvas).handler({ max_items: 100 })

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ maxItems: 101 }),
      )
    })

    it('defaults the cap to 100 when max_items is omitted', async () => {
      const canvas = plannerCanvas([])
      await plannerTool(canvas).handler({})

      expect(canvas.planner.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ maxItems: 101 }),
      )
    })

    it('propagates CanvasApiError', async () => {
      const canvas = plannerCanvas([])
      vi.mocked(canvas.planner.listItems).mockRejectedValue(
        new CanvasApiError('Unauthorized', 401, '/api/v1/planner/items'),
      )
      await expect(plannerTool(canvas).handler({})).rejects.toThrow(CanvasApiError)
    })
  })
})
