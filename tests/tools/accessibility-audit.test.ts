import { describe, it, expect, vi } from 'vitest'
import { accessibilityAuditTools } from '../../src/tools/accessibility-audit'
import type { CanvasClient } from '../../src/canvas'

interface Finding {
  location: {
    type: string
    id: number
    title: string
    quiz_engine?: 'classic' | 'new'
    question_id?: number | string
  }
  rule: string
  wcag: string
  severity: 'error' | 'advisory'
  detail: string
}

interface AuditResult {
  summary: {
    course_id: number
    sources_scanned: string[]
    total_findings: number
    error_count: number
    advisory_count: number
  }
  findings: Finding[]
}

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
          body: '<p>Welcome to the course.</p>',
        },
      ]),
    },
    assignments: {
      list: vi.fn().mockResolvedValue([
        {
          id: 10,
          name: 'Essay',
          description: '<p>Write a good essay.</p>',
          course_id: 100,
          due_at: null,
          points_possible: 10,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
        {
          id: 40,
          name: 'Final (New Quiz)',
          description: null,
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
          description: '<p>Answer all questions.</p>',
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
          question_text: '<p>Choose the correct answer.</p>',
          question_type: 'multiple_choice_question',
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
            item_body: '<p>Pick the correct option.</p>',
            interaction_data: {},
            properties: {},
          },
        },
        {
          id: 'item-3',
          position: 3,
          points_possible: 0,
          entry_type: 'Stimulus',
        },
      ]),
    },
    courses: {
      getSyllabus: vi.fn().mockResolvedValue('<p>See the schedule below.</p>'),
    },
    discussions: {
      listAnnouncements: vi
        .fn()
        .mockResolvedValue([
          { id: 20, title: 'Welcome', message: '<p>Welcome to the course!</p>', posted_at: '' },
        ]),
    },
  } as unknown as CanvasClient
}

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

async function runScan(
  html: string,
  source: 'pages' | 'assignments' | 'syllabus' | 'announcements' = 'pages',
): Promise<AuditResult> {
  let canvas: CanvasClient
  if (source === 'pages') {
    canvas = makeCanvas({
      pages: [{ page_id: 1, url: 'p', title: 'P', published: true, updated_at: '', body: html }],
    })
  } else if (source === 'assignments') {
    canvas = makeCanvas({
      assignments: [
        {
          id: 10,
          name: 'A',
          description: html,
          course_id: 100,
          due_at: null,
          points_possible: 10,
          grading_type: 'points',
          submission_types: [],
          allowed_attempts: -1,
        },
      ],
    })
  } else if (source === 'syllabus') {
    canvas = makeCanvas({ syllabus: html })
  } else {
    canvas = makeCanvas({
      announcements: [{ id: 20, title: 'Ann', message: html, posted_at: '' }],
    })
  }
  const [tool] = accessibilityAuditTools(canvas)
  return (await tool.handler({ course_id: 100, include: [source] })) as AuditResult
}

describe('accessibilityAuditTools', () => {
  // Suite-level checks (1-3)
  it('returns exactly one tool definition', () => {
    const tools = accessibilityAuditTools(buildMockCanvas())
    expect(tools).toHaveLength(1)
  })

  it('tool name is audit_course_accessibility', () => {
    const [tool] = accessibilityAuditTools(buildMockCanvas())
    expect(tool.name).toBe('audit_course_accessibility')
  })

  it('has readOnlyHint: true and openWorldHint: true', () => {
    const [tool] = accessibilityAuditTools(buildMockCanvas())
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  // Image rule cases (4-10)
  describe('image rules', () => {
    it('4: img with no alt attribute → img_missing_alt error', async () => {
      const result = await runScan('<img src="photo.jpg">')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'img_missing_alt', severity: 'error', wcag: '1.1.1' }),
      )
    })

    it('5: img with alt="" → no finding (decorative image marker)', async () => {
      const result = await runScan('<img src="photo.jpg" alt="">')
      expect(result.findings).toHaveLength(0)
    })

    it('6: img with filename extension alt → img_alt_low_quality', async () => {
      const result = await runScan('<img src="photo.jpg" alt="photo.jpg">')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'img_alt_low_quality' }),
      )
    })

    it('7: img with generic word alt → img_alt_low_quality', async () => {
      const result = await runScan('<img src="photo.jpg" alt="Screenshot">')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'img_alt_low_quality' }),
      )
    })

    it('8: img with camera filename alt → img_alt_low_quality', async () => {
      const result = await runScan('<img src="photo.jpg" alt="IMG_0042">')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'img_alt_low_quality' }),
      )
    })

    it('9: img with descriptive alt → no finding', async () => {
      const result = await runScan(
        '<img src="diagram.jpg" alt="Diagram of the water cycle showing evaporation and condensation">',
      )
      expect(result.findings).toHaveLength(0)
    })

    it('10: data-alt attribute must not be mistaken for alt (regression for (?:^|\\s)alt= fix)', async () => {
      // data-alt should NOT trigger img_missing_alt; the img truly has no real alt
      const result = await runScan('<div data-alt="foo"><img src="x.jpg" alt="Diagram"></div>')
      // The img has a good alt="Diagram" — no finding expected
      expect(result.findings).toHaveLength(0)
    })

    it('10b: data-alt on the img tag itself must not be mistaken for real alt', async () => {
      // If an img has data-alt but no real alt, it should fire img_missing_alt
      const result = await runScan('<img src="x.jpg" data-alt="caption">')
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: 'img_missing_alt' }))
    })
  })

  // Link rule cases (11-17)
  describe('link rules', () => {
    it('11: link with "click here" text → link_non_descriptive_text', async () => {
      const result = await runScan('<a href="/x">Click here</a>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'link_non_descriptive_text' }),
      )
    })

    it('12: link with descriptive text → no finding', async () => {
      const result = await runScan('<a href="/x">Read more about photosynthesis</a>')
      expect(result.findings).toHaveLength(0)
    })

    it('13: image-only link with good alt text → no finding (accessible name via img alt)', async () => {
      const result = await runScan('<a href="/x"><img alt="Course syllabus PDF"></a>')
      expect(result.findings).toHaveLength(0)
    })

    it('14: image-only link with no alt → two findings: img_missing_alt + link_non_descriptive_text', async () => {
      const result = await runScan('<a href="/x"><img src="icon.png"></a>')
      const rules = result.findings.map((f) => f.rule)
      expect(rules).toContain('img_missing_alt')
      expect(rules).toContain('link_non_descriptive_text')
    })

    it('15: adjacent identical hrefs separated by whitespace → adjacent_duplicate_links', async () => {
      const result = await runScan('<a href="/x">A</a> <a href="/x">B</a>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'adjacent_duplicate_links' }),
      )
    })

    it('16: same href with content between → no adjacent_duplicate_links', async () => {
      const result = await runScan('<a href="/x">A</a><p>text</p><a href="/x">B</a>')
      expect(result.findings.some((f) => f.rule === 'adjacent_duplicate_links')).toBe(false)
    })

    it('17: different hrefs adjacent → no adjacent_duplicate_links', async () => {
      const result = await runScan('<a href="/x">A</a> <a href="/y">B</a>')
      expect(result.findings.some((f) => f.rule === 'adjacent_duplicate_links')).toBe(false)
    })
  })

  // Heading rule cases (18-22)
  describe('heading rules', () => {
    it('18: h2 followed by h4 → heading_skipped_level', async () => {
      const result = await runScan('<h2>Week 1</h2><h4>Details</h4>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'heading_skipped_level' }),
      )
    })

    it('19: h2 followed by h3 → no heading_skipped_level', async () => {
      const result = await runScan('<h2>Week 1</h2><h3>Details</h3>')
      expect(result.findings.some((f) => f.rule === 'heading_skipped_level')).toBe(false)
    })

    it('20a: empty h2 → heading_empty error', async () => {
      const result = await runScan('<h2></h2>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'heading_empty', severity: 'error' }),
      )
    })

    it('20b: whitespace-only h2 → heading_empty error', async () => {
      const result = await runScan('<h2>   </h2>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'heading_empty', severity: 'error' }),
      )
    })

    it('21: heading with 130-character text → heading_too_long', async () => {
      const longText = 'A'.repeat(130)
      const result = await runScan(`<h2>${longText}</h2>`)
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: 'heading_too_long' }))
    })

    it('22: heading with exactly 120-character text → no heading_too_long (boundary: > 120)', async () => {
      const exactText = 'A'.repeat(120)
      const result = await runScan(`<h2>${exactText}</h2>`)
      expect(result.findings.some((f) => f.rule === 'heading_too_long')).toBe(false)
    })
  })

  // Table rule cases (23-27)
  describe('table rules', () => {
    it('23: table with no th → table_missing_header but NOT table_header_missing_scope (mutual exclusivity)', async () => {
      const result = await runScan('<table><tr><td>a</td></tr></table>')
      const rules = result.findings.map((f) => f.rule)
      expect(rules).toContain('table_missing_header')
      expect(rules).not.toContain('table_header_missing_scope')
    })

    it('24: table with th but no scope → table_header_missing_scope but NOT table_missing_header', async () => {
      const result = await runScan('<table><tr><th>Name</th></tr></table>')
      const rules = result.findings.map((f) => f.rule)
      expect(rules).toContain('table_header_missing_scope')
      expect(rules).not.toContain('table_missing_header')
    })

    it('25: table with th and scope → no header-related finding', async () => {
      const result = await runScan('<table><tr><th scope="col">Name</th></tr></table>')
      const rules = result.findings.map((f) => f.rule)
      expect(rules).not.toContain('table_missing_header')
      expect(rules).not.toContain('table_header_missing_scope')
    })

    it('26: table with th+scope but no caption → table_missing_caption (additive, not exclusive)', async () => {
      const result = await runScan('<table><tr><th scope="col">Name</th></tr></table>')
      expect(result.findings).toContainEqual(
        expect.objectContaining({ rule: 'table_missing_caption' }),
      )
    })

    it('27: table with caption → no table_missing_caption', async () => {
      const result = await runScan(
        '<table><caption>Grades</caption><tr><th scope="col">Name</th></tr></table>',
      )
      expect(result.findings.some((f) => f.rule === 'table_missing_caption')).toBe(false)
    })
  })

  // Aggregation / summary cases (28-32)
  describe('aggregation and summary', () => {
    it('28: total_findings equals findings.length', async () => {
      const result = await runScan('<img src="x.jpg"><a href="#">here</a>')
      expect(result.summary.total_findings).toBe(result.findings.length)
    })

    it('29: error_count + advisory_count equals total_findings', async () => {
      const result = await runScan('<img src="x.jpg"><a href="#">here</a>')
      expect(result.summary.error_count + result.summary.advisory_count).toBe(
        result.summary.total_findings,
      )
    })

    it('30: error_count counts only img_missing_alt and heading_empty findings', async () => {
      // img_missing_alt (error) + heading_empty (error) + link_non_descriptive_text (advisory)
      const result = await runScan('<img src="x.jpg"><h2></h2><a href="#">here</a>')
      expect(result.summary.error_count).toBe(2)
      expect(result.summary.advisory_count).toBeGreaterThanOrEqual(1)
    })

    it('31: sources_scanned uses stable CONTENT_SOURCES order', async () => {
      const canvas = buildMockCanvas()
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100 })) as AuditResult
      expect(result.summary.sources_scanned).toEqual([
        'pages',
        'assignments',
        'syllabus',
        'announcements',
      ])
    })

    it('32a: null page body → no findings and no error', async () => {
      const canvas = makeCanvas({
        pages: [{ page_id: 1, url: 'p', title: 'P', published: true, updated_at: '', body: null }],
      })
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['pages'] })) as AuditResult
      expect(result.findings).toHaveLength(0)
    })

    it('32b: undefined description on assignment → no findings and no error', async () => {
      const canvas = makeCanvas({
        assignments: [
          {
            id: 10,
            name: 'A',
            description: undefined,
            course_id: 100,
            due_at: null,
            points_possible: 10,
            grading_type: 'points',
            submission_types: [],
            allowed_attempts: -1,
          },
        ],
      })
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['assignments'],
      })) as AuditResult
      expect(result.findings).toHaveLength(0)
    })

    it('32c: null syllabus → no findings and no error', async () => {
      const canvas = makeCanvas({ syllabus: null })
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100, include: ['syllabus'] })) as AuditResult
      expect(result.findings).toHaveLength(0)
    })
  })

  // include filter cases (33-35)
  describe('include filter', () => {
    it('33: include:["syllabus"] only → only getSyllabus called', async () => {
      const canvas = buildMockCanvas()
      const [tool] = accessibilityAuditTools(canvas)
      await tool.handler({ course_id: 100, include: ['syllabus'] })

      expect(canvas.pages.listWithBodies).not.toHaveBeenCalled()
      expect(canvas.assignments.list).not.toHaveBeenCalled()
      expect(canvas.discussions.listAnnouncements).not.toHaveBeenCalled()
      expect(canvas.courses.getSyllabus).toHaveBeenCalled()
    })

    it('34: omitting include does not scan quizzes', async () => {
      const canvas = buildMockCanvas()
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({ course_id: 100 })) as AuditResult

      expect(canvas.quizzes.list).not.toHaveBeenCalled()
      expect(result.summary.sources_scanned).toEqual([
        'pages',
        'assignments',
        'syllabus',
        'announcements',
      ])
    })

    it('35: include:["quizzes"] scans classic quiz description, questions, and new quiz items', async () => {
      const quizCanvas = {
        pages: { listWithBodies: vi.fn().mockResolvedValue([]) },
        assignments: {
          list: vi.fn().mockResolvedValue([
            {
              id: 40,
              name: 'Final (New Quiz)',
              description: null,
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
              description: '<img src="midterm.jpg">',
              points_possible: 20,
              question_count: 1,
              due_at: null,
              published: true,
            },
          ]),
          listQuestions: vi.fn().mockResolvedValue([
            {
              id: 300,
              quiz_id: 30,
              position: 1,
              question_text: '<a href="#">click here</a>',
              question_type: 'multiple_choice_question',
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
                item_body: '<img src="item.png">',
                interaction_data: {},
                properties: {},
              },
            },
          ]),
        },
        courses: { getSyllabus: vi.fn().mockResolvedValue(null) },
        discussions: { listAnnouncements: vi.fn().mockResolvedValue([]) },
      } as unknown as CanvasClient

      const [tool] = accessibilityAuditTools(quizCanvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      // Classic quiz description: img_missing_alt
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({ type: 'quizzes', id: 30, quiz_engine: 'classic' }),
          rule: 'img_missing_alt',
        }),
      )

      // Classic quiz question: link_non_descriptive_text
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({
            type: 'quizzes',
            id: 30,
            quiz_engine: 'classic',
            question_id: 300,
          }),
          rule: 'link_non_descriptive_text',
        }),
      )

      // New Quiz item: img_missing_alt
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({
            type: 'quizzes',
            id: 40,
            quiz_engine: 'new',
            question_id: 'item-1',
          }),
          rule: 'img_missing_alt',
        }),
      )

      expect(result.summary.sources_scanned).toEqual(['quizzes'])
    })
  })

  describe('quizzes source', () => {
    it('skips a migrated stub quiz (quizzes.next type)', async () => {
      const canvas = buildMockCanvas()
      const [tool] = accessibilityAuditTools(canvas)
      const result = (await tool.handler({
        course_id: 100,
        include: ['quizzes'],
      })) as AuditResult

      expect(canvas.quizzes.listQuestions).toHaveBeenCalledTimes(1)
      expect(canvas.quizzes.listQuestions).toHaveBeenCalledWith(100, 30)
      expect(result.findings.some((f) => f.location.id === 31)).toBe(false)
    })

    it('skips an entry-less New Quiz item without throwing', async () => {
      const canvas = buildMockCanvas()
      const [tool] = accessibilityAuditTools(canvas)
      // item-3 in the mock has no entry field — should not throw
      await expect(tool.handler({ course_id: 100, include: ['quizzes'] })).resolves.toBeDefined()
    })
  })
})
