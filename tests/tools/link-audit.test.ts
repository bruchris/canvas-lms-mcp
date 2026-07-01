import { describe, it, expect, vi } from 'vitest'
import { linkAuditTools } from '../../src/tools/link-audit'
import type { CanvasClient } from '../../src/canvas'

interface Finding {
  location: {
    type: string
    id: number
    title: string
    quiz_engine?: 'classic' | 'new'
    question_id?: number | string
  }
  kind: string
  href: string
  reason: string
  cross_course_id?: number
}

interface AuditResult {
  summary: { course_id: number; sources_scanned: string[]; total_findings: number }
  findings: Finding[]
}

/**
 * Default mock with course id = 100. Provides one cross-course finding per
 * source type plus same-course (no-finding) controls.
 */
function buildMockCanvas(): CanvasClient {
  return {
    pages: {
      listWithBodies: vi.fn().mockResolvedValue([
        {
          page_id: 1,
          url: 'intro',
          title: 'Introduction',
          published: true,
          updated_at: '',
          body: '<p>Read more at <a href="/courses/100/pages/foo">here</a></p>',
        },
        {
          page_id: 2,
          url: 'week1',
          title: 'Week 1',
          published: true,
          updated_at: '',
          body: '<p>See <img src="/courses/999/files/42/download"> for details.</p>',
        },
      ]),
    },
    assignments: {
      list: vi.fn().mockResolvedValue([
        {
          id: 10,
          name: 'Essay',
          description: '<p>Submit via <a href="/courses/100/assignments/5">Canvas</a></p>',
          course_id: 100,
          due_at: null,
          points_possible: 10,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
        {
          id: 11,
          name: 'Quiz',
          description: null,
          course_id: 100,
          due_at: null,
          points_possible: 5,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
        {
          id: 40,
          name: 'Final (New Quiz)',
          description: null, // no href here — keeps existing assignments-source finding counts unaffected
          course_id: 100,
          due_at: null,
          points_possible: 20,
          grading_type: 'points',
          submission_types: ['external_tool'],
          allowed_attempts: -1,
          is_quiz_lti_assignment: true,
        },
      ]),
    },
    quizzes: {
      list: vi.fn().mockResolvedValue([
        {
          id: 30,
          title: 'Midterm',
          quiz_type: 'assignment',
          description: '<p>Read <a href="/courses/999/pages/notes">notes</a> first.</p>',
          points_possible: 20,
          question_count: 2,
          due_at: null,
          published: true,
        },
        {
          id: 31,
          title: 'Migrated Stub',
          quiz_type: 'quizzes.next',
          description: null,
          points_possible: 0,
          question_count: 0,
          due_at: null,
          published: true,
        },
      ]),
      listQuestions: vi.fn().mockResolvedValue([
        {
          id: 300,
          quiz_id: 30,
          position: 1,
          question_text: '<p>See <img src="/courses/999/files/1/download"> above.</p>',
          question_type: 'multiple_choice_question',
          points_possible: 10,
        },
        {
          id: 301,
          quiz_id: 30,
          position: 2,
          question_text: '<p>No links here.</p>',
          question_type: 'true_false_question',
          points_possible: 10,
        },
      ]),
    },
    newQuizzes: {
      listItems: vi.fn().mockResolvedValue([
        {
          id: 'item-1',
          position: 1,
          points_possible: 5,
          entry_type: 'Item',
          entry: {
            interaction_type_slug: 'choice',
            item_body: '<p>Pick the diagram: <img src="/courses/999/files/2/download"></p>',
            interaction_data: {},
            properties: {},
          },
        },
      ]),
    },
    courses: {
      getSyllabus: vi
        .fn()
        .mockResolvedValue('<p>Week 1: <a href="/courses/50/pages/overview">Old link</a></p>'),
    },
    discussions: {
      listAnnouncements: vi
        .fn()
        .mockResolvedValue([
          { id: 20, title: 'Welcome', message: '<p>See <img src=""> for info.</p>', posted_at: '' },
        ]),
    },
  } as unknown as CanvasClient
}

/** Minimal mock builder for classification edge cases. */
function makeCanvas(opts: {
  pages?: unknown[]
  assignments?: unknown[]
  syllabus?: string | null
  announcements?: unknown[]
}): CanvasClient {
  return {
    pages: { listWithBodies: vi.fn().mockResolvedValue(opts.pages ?? []) },
    assignments: { list: vi.fn().mockResolvedValue(opts.assignments ?? []) },
    courses: { getSyllabus: vi.fn().mockResolvedValue(opts.syllabus ?? null) },
    discussions: { listAnnouncements: vi.fn().mockResolvedValue(opts.announcements ?? []) },
  } as unknown as CanvasClient
}

describe('linkAuditTools', () => {
  it('returns exactly one tool definition', () => {
    const tools = linkAuditTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
  })

  it('defines the audit_course_links tool with read-only annotations', () => {
    const [tool] = linkAuditTools(buildMockCanvas())
    expect(tool.name).toBe('audit_course_links')
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  describe('full scan (all sources)', () => {
    async function runFullScan(): Promise<AuditResult> {
      const [tool] = linkAuditTools(buildMockCanvas())
      return (await tool.handler({ course_id: 100 })) as AuditResult
    }

    it('flags a cross-course image reference in a page', async () => {
      const result = await runFullScan()
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: { type: 'pages', id: 2, title: 'Week 1' },
          kind: 'image',
          reason: 'cross_course_reference',
          cross_course_id: 999,
        }),
      )
    })

    it('does not flag a same-course page link', async () => {
      const result = await runFullScan()
      expect(result.findings.some((f) => f.href.includes('/courses/100/pages/foo'))).toBe(false)
    })

    it('does not flag a same-course assignment link', async () => {
      const result = await runFullScan()
      expect(
        result.findings.some((f) => f.location.type === 'assignments' && f.location.id === 10),
      ).toBe(false)
    })

    it('does not flag an assignment with a null description', async () => {
      const result = await runFullScan()
      expect(
        result.findings.some((f) => f.location.type === 'assignments' && f.location.id === 11),
      ).toBe(false)
    })

    it('flags a cross-course syllabus link', async () => {
      const result = await runFullScan()
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: { type: 'syllabus', id: 100, title: 'Syllabus' },
          kind: 'link',
          reason: 'cross_course_reference',
          cross_course_id: 50,
        }),
      )
    })

    it('flags an empty image src in an announcement without a cross_course_id', async () => {
      const result = await runFullScan()
      const finding = result.findings.find((f) => f.location.type === 'announcements')
      expect(finding).toMatchObject({
        location: { type: 'announcements', id: 20, title: 'Welcome' },
        kind: 'image',
        reason: 'empty_or_malformed',
      })
      expect(finding).not.toHaveProperty('cross_course_id')
    })

    it('reports total_findings equal to findings.length', async () => {
      const result = await runFullScan()
      expect(result.summary.total_findings).toBe(result.findings.length)
    })

    it('emits exactly the three expected findings (no over- or under-counting)', async () => {
      // page 2 cross-course image + syllabus cross-course link + announcement empty img.
      // The same-course page/assignment links and the null assignment description
      // must NOT contribute, so this absolute count guards against a dropped source
      // loop, double-counting, or accidental same-course findings.
      const result = await runFullScan()
      expect(result.findings).toHaveLength(3)
      expect(result.summary.total_findings).toBe(3)
    })

    it('lists all four sources in stable order', async () => {
      const result = await runFullScan()
      expect(result.summary.sources_scanned).toEqual([
        'pages',
        'assignments',
        'syllabus',
        'announcements',
      ])
    })
  })

  describe('include filter', () => {
    it('fetches only the syllabus when include is ["syllabus"]', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)

      const result = (await tool.handler({
        course_id: 100,
        include: ['syllabus'],
      })) as AuditResult

      expect(canvas.pages.listWithBodies).not.toHaveBeenCalled()
      expect(canvas.assignments.list).not.toHaveBeenCalled()
      expect(canvas.discussions.listAnnouncements).not.toHaveBeenCalled()
      expect(canvas.courses.getSyllabus).toHaveBeenCalled()
      expect(result.summary.sources_scanned).toEqual(['syllabus'])
    })

    it('fetches only the requested multi-source subset', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)

      const result = (await tool.handler({
        course_id: 100,
        include: ['pages', 'announcements'],
      })) as AuditResult

      expect(canvas.pages.listWithBodies).toHaveBeenCalled()
      expect(canvas.discussions.listAnnouncements).toHaveBeenCalled()
      expect(canvas.assignments.list).not.toHaveBeenCalled()
      expect(canvas.courses.getSyllabus).not.toHaveBeenCalled()
      expect(
        result.findings.every(
          (f) => f.location.type === 'pages' || f.location.type === 'announcements',
        ),
      ).toBe(true)
    })
  })

  describe('classification edge cases', () => {
    it('classifies a javascript: href as empty_or_malformed', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="javascript:void(0)">click</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({ kind: 'link', reason: 'empty_or_malformed' })
      expect(result.findings[0]).not.toHaveProperty('cross_course_id')
    })

    it('classifies a pure # anchor as empty_or_malformed', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="#">top</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({ kind: 'link', reason: 'empty_or_malformed' })
    })

    it('decodes HTML entities before classifying a cross-course URL', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="/courses/999/pages/foo?a=1&amp;b=2">x</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({
        reason: 'cross_course_reference',
        cross_course_id: 999,
      })
      // href reports the RAW, un-decoded attribute value; decoding is applied only
      // to the value used for classification, not to what is surfaced.
      expect(result.findings[0].href).toBe('/courses/999/pages/foo?a=1&amp;b=2')
    })

    it('classifies an iframe src as a video kind', async () => {
      const canvas = makeCanvas({
        assignments: [
          {
            id: 10,
            name: 'Media',
            description: '<iframe src="/courses/999/media_objects/m1"></iframe>',
            course_id: 100,
            due_at: null,
            points_possible: 0,
            grading_type: 'points',
            submission_types: [],
            allowed_attempts: -1,
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['assignments'],
      })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({
        kind: 'video',
        reason: 'cross_course_reference',
        cross_course_id: 999,
      })
    })

    it('classifies a <source> inside a <video> as a video kind', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<video controls><source src="/courses/999/media_objects/m2"></video>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({
        kind: 'video',
        reason: 'cross_course_reference',
        cross_course_id: 999,
      })
    })

    it('does not flag an external link with no /courses/ segment', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="https://external.com/docs">docs</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(0)
    })

    it('emits no findings for an empty page body', async () => {
      const canvas = makeCanvas({
        pages: [{ page_id: 1, url: 'p', title: 'P', published: true, updated_at: '', body: '' }],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(0)
    })

    it('emits no syllabus findings and does not throw when the syllabus is null', async () => {
      const canvas = makeCanvas({ syllabus: null })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['syllabus'] })) as AuditResult

      expect(result.findings.some((f) => f.location.type === 'syllabus')).toBe(false)
    })

    it('emits no findings and does not throw for a page with an undefined body', async () => {
      const canvas = makeCanvas({
        pages: [{ page_id: 1, url: 'p', title: 'P', published: true, updated_at: '' }],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(0)
    })

    it('emits a finding per flaggable URL when one body contains several', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="/courses/2/pages/a">x</a><img src="/courses/3/files/b">',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(2)
      expect(result.findings.map((f) => f.cross_course_id).sort()).toEqual([2, 3])
    })

    it('classifies an empty href on a link as empty_or_malformed', async () => {
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="">x</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toMatchObject({ kind: 'link', reason: 'empty_or_malformed' })
    })

    it('does not flag a /courses/{id} reference that lacks a trailing slash', async () => {
      // v1 boundary: the cross-course regex requires a trailing slash after the
      // course id, so a bare course-landing link is intentionally not flagged.
      const canvas = makeCanvas({
        pages: [
          {
            page_id: 1,
            url: 'p',
            title: 'P',
            published: true,
            updated_at: '',
            body: '<a href="/courses/55">other course</a>',
          },
        ],
      })
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult

      expect(result.findings).toHaveLength(0)
    })
  })

  describe('quizzes source', () => {
    // 27
    it('does not scan quizzes by default (opt-in)', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)

      const result = (await tool.handler({ course_id: 100 })) as AuditResult

      expect(canvas.quizzes.list).not.toHaveBeenCalled()
      expect(canvas.newQuizzes.listItems).not.toHaveBeenCalled()
      expect(result.summary.sources_scanned).toEqual([
        'pages',
        'assignments',
        'syllabus',
        'announcements',
      ])
    })

    // 28
    it('flags a cross-course link in a Classic quiz description without a question_id', async () => {
      const [tool] = linkAuditTools(buildMockCanvas())
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      const finding = result.findings.find(
        (f) => f.location.type === 'quizzes' && f.location.id === 30 && f.kind === 'link',
      )
      expect(finding).toBeDefined()
      expect(finding?.location).toEqual({
        type: 'quizzes',
        id: 30,
        title: 'Midterm',
        quiz_engine: 'classic',
      })
      expect(finding?.location).not.toHaveProperty('question_id')
      expect(finding).toMatchObject({ reason: 'cross_course_reference', cross_course_id: 999 })
    })

    // 29
    it('flags a cross-course image in a Classic quiz question with a question_id', async () => {
      const [tool] = linkAuditTools(buildMockCanvas())
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: {
            type: 'quizzes',
            id: 30,
            title: 'Midterm',
            quiz_engine: 'classic',
            question_id: 300,
          },
          kind: 'image',
          reason: 'cross_course_reference',
          cross_course_id: 999,
        }),
      )
    })

    // 30
    it('emits no finding for a Classic quiz question with no links', async () => {
      const [tool] = linkAuditTools(buildMockCanvas())
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(result.findings.some((f) => f.location.question_id === 301)).toBe(false)
    })

    // 31
    it('skips a migrated stub Classic quiz (quiz_type quizzes.next)', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(canvas.quizzes.listQuestions).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.listQuestions).toHaveBeenCalledWith(100, 30)
      expect(result.findings.some((f) => f.location.id === 31)).toBe(false)
    })

    // 32
    it('flags a cross-course image in a New Quiz item', async () => {
      const [tool] = linkAuditTools(buildMockCanvas())
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: {
            type: 'quizzes',
            id: 40,
            title: 'Final (New Quiz)',
            quiz_engine: 'new',
            question_id: 'item-1',
          },
          kind: 'image',
          reason: 'cross_course_reference',
          cross_course_id: 999,
        }),
      )
    })

    // 33
    it('scans items only for the New-Quiz-flagged assignment', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)
      await tool.handler({ course_id: 100, include: ['quizzes'] })

      expect(canvas.newQuizzes.listItems).toHaveBeenCalledTimes(1)
      expect(canvas.newQuizzes.listItems).toHaveBeenCalledWith(100, 40)
    })

    // 34
    it('reports sources_scanned as ["quizzes"] and skips other sources when only quizzes is opted in', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(result.summary.sources_scanned).toEqual(['quizzes'])
      expect(canvas.pages.listWithBodies).not.toHaveBeenCalled()
      expect(canvas.courses.getSyllabus).not.toHaveBeenCalled()
      expect(canvas.discussions.listAnnouncements).not.toHaveBeenCalled()
      // assignments.list is still needed for New Quiz discovery
      expect(canvas.assignments.list).toHaveBeenCalled()
    })

    // 35
    it('fetches assignments twice for the accepted double-fetch when both assignments and quizzes are included', async () => {
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['assignments', 'quizzes'],
      })) as AuditResult

      expect(canvas.assignments.list).toHaveBeenCalledTimes(2)
      expect(result.summary.sources_scanned).toEqual(['assignments', 'quizzes'])
    })
  })

  describe('empty include array', () => {
    it('scans nothing when include is an explicit empty array', async () => {
      // `[] ?? [...CONTENT_SOURCES]` does not fall back (an empty array is not
      // nullish), so an explicit empty selection scans no sources. Only omitting
      // `include` entirely scans all four.
      const canvas = buildMockCanvas()
      const [tool] = linkAuditTools(canvas)

      const result = (await tool.handler({ course_id: 100, include: [] })) as AuditResult

      expect(canvas.pages.listWithBodies).not.toHaveBeenCalled()
      expect(canvas.assignments.list).not.toHaveBeenCalled()
      expect(canvas.courses.getSyllabus).not.toHaveBeenCalled()
      expect(canvas.discussions.listAnnouncements).not.toHaveBeenCalled()
      expect(result.summary.sources_scanned).toEqual([])
      expect(result.summary.total_findings).toBe(0)
      expect(result.findings).toHaveLength(0)
    })
  })
})
