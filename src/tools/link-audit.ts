import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements', 'quizzes'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]

// `quizzes` is opt-in — see spec Design unknown §3. It is a valid `include` value
// but is excluded from the default set scanned when `include` is omitted, so the
// existing four sources' default cost and behavior are unchanged.
const DEFAULT_CONTENT_SOURCES: ContentSource[] = [
  'pages',
  'assignments',
  'syllabus',
  'announcements',
]

// Allow-list of Classic quiz_type values, mirroring the convention in
// src/tools/quiz-accommodations.ts. Kept as a local constant (each tool file owns
// its own small constants). Filtering with `.has()` skips listQuestions for any
// quiz whose quiz_type is not a known-Classic value (e.g. the `quizzes.next` stub
// Canvas leaves after a New Quizzes migration, or any future/unrecognized type).
const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

type LinkKind = 'link' | 'image' | 'video'
type FindingReason = 'cross_course_reference' | 'empty_or_malformed'

interface ContentLocation {
  type: ContentSource
  id: number
  title: string
  // Set only when type === 'quizzes'. Classic ids resolve at
  // /courses/:id/quizzes/:id; New Quiz ids are the backing assignment id and
  // resolve at /courses/:id/assignments/:id.
  quiz_engine?: 'classic' | 'new'
  // Set only when the finding is inside a specific question/item, not the quiz's
  // own description. Classic question ids are numeric; New Quiz item ids are
  // Canvas-assigned strings (CanvasNewQuizItem.id: string).
  question_id?: number | string
}

interface LinkFinding {
  location: ContentLocation
  kind: LinkKind
  href: string
  reason: FindingReason
  cross_course_id?: number
}

// Canvas generates predictably structured HTML with double-quoted attributes, so
// regex extraction is accurate here without pulling in a DOM parser. Single-quoted
// attributes are a known v1 limitation (see PR / spec notes).
const HREF_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi
const IMG_SRC_RE = /<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi
const EMBED_SRC_RE = /<(?:iframe|embed|video|source)\b[^>]*\bsrc="([^"]*)"[^>]*>/gi

function extractUrls(html: string | null | undefined): Array<{ kind: LinkKind; raw: string }> {
  if (!html) return []
  const results: Array<{ kind: LinkKind; raw: string }> = []
  let m: RegExpExecArray | null
  // Each regex carries the `g` flag and maintains `lastIndex` across calls; reset
  // before scanning a new HTML string so prior state cannot skip the first match.
  // The capture group `([^"]*)` always matches (possibly empty) when the overall
  // pattern matches, so `m[1]` is never undefined at runtime; `?? ''` satisfies
  // the compiler's `noUncheckedIndexedAccess` without changing behaviour.
  HREF_RE.lastIndex = 0
  while ((m = HREF_RE.exec(html)) !== null) results.push({ kind: 'link', raw: m[1] ?? '' })
  IMG_SRC_RE.lastIndex = 0
  while ((m = IMG_SRC_RE.exec(html)) !== null) results.push({ kind: 'image', raw: m[1] ?? '' })
  EMBED_SRC_RE.lastIndex = 0
  while ((m = EMBED_SRC_RE.exec(html)) !== null) results.push({ kind: 'video', raw: m[1] ?? '' })
  return results
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function classifyUrl(
  raw: string,
  courseId: number,
): { reason: FindingReason; crossCourseId?: number } | null {
  const href = decodeHtmlEntities(raw).trim()
  if (!href || href === '#' || href.startsWith('javascript:')) {
    return { reason: 'empty_or_malformed' }
  }
  const crossCourseId = href.match(/\/courses\/(\d+)\//)?.[1]
  if (crossCourseId) {
    const refId = parseInt(crossCourseId, 10)
    if (refId !== courseId) {
      return { reason: 'cross_course_reference', crossCourseId: refId }
    }
  }
  return null
}

function scanHtml(
  html: string | null | undefined,
  courseId: number,
  location: ContentLocation,
): LinkFinding[] {
  const findings: LinkFinding[] = []
  for (const { kind, raw } of extractUrls(html)) {
    const result = classifyUrl(raw, courseId)
    if (!result) continue
    const finding: LinkFinding = { location, kind, href: raw, reason: result.reason }
    if (result.crossCourseId !== undefined) finding.cross_course_id = result.crossCourseId
    findings.push(finding)
  }
  return findings
}

async function scanQuizzes(canvas: CanvasClient, courseId: number): Promise<LinkFinding[]> {
  // `assignments` here is a separate, locally-scoped fetch from the outer
  // handler's `assignments` variable — the two never share state. When both the
  // `assignments` and `quizzes` sources are active, canvas.assignments.list is
  // called twice, concurrently (each inside its own Promise.all branch) — an
  // accepted v1 inefficiency, not a bug (see spec Design unknown §1).
  const [quizzes, assignments] = await Promise.all([
    canvas.quizzes.list(courseId),
    canvas.assignments.list(courseId),
  ])

  const classicQuizzes = quizzes.filter((quiz) => CLASSIC_QUIZ_TYPES.has(quiz.quiz_type))
  const classicFindings = await Promise.all(
    classicQuizzes.map(async (quiz) => {
      const location: ContentLocation = {
        type: 'quizzes',
        id: quiz.id,
        title: quiz.title,
        quiz_engine: 'classic',
      }
      const findings = scanHtml(quiz.description, courseId, location)
      const questions = await canvas.quizzes.listQuestions(courseId, quiz.id)
      for (const question of questions) {
        findings.push(
          ...scanHtml(question.question_text, courseId, {
            ...location,
            question_id: question.id,
          }),
        )
      }
      return findings
    }),
  )

  const newQuizAssignments = assignments.filter((a) => a.is_quiz_lti_assignment === true)
  const newQuizFindings = await Promise.all(
    newQuizAssignments.map(async (assignment) => {
      const location: ContentLocation = {
        type: 'quizzes',
        id: assignment.id,
        title: assignment.name,
        quiz_engine: 'new',
      }
      const items = await canvas.newQuizzes.listItems(courseId, assignment.id)
      // `entry` is optional-chained defensively: New Quizzes list items include
      // Stimulus blocks and other entry shapes, and a malformed/entry-less item
      // would otherwise throw a raw TypeError that aborts the whole audit. A
      // missing body is treated as "no links" by extractUrls' null-guard.
      return items.flatMap((item) =>
        scanHtml(item.entry?.item_body, courseId, { ...location, question_id: item.id }),
      )
    }),
  )

  return [...classicFindings.flat(), ...newQuizFindings.flat()]
}

export function linkAuditTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'audit_course_links',
      description:
        "Scan a course's content (pages, assignments, syllabus, announcements, and optionally " +
        'quizzes) for broken or outdated links and images. Returns structured findings: ' +
        'cross-course references (links that still point at a previous copy of the course — the ' +
        'canonical stale-copy failure after a course import) and empty/malformed URLs. Pass ' +
        '"quizzes" in `include` to also scan Classic quiz descriptions/questions and New Quiz ' +
        'item stems — these break silently for students while still rendering in the ' +
        'instructor’s own preview. `quizzes` is opt-in (off by default). Structural checks ' +
        'only — no outbound HTTP requests. Requires instructor permissions in the course.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        include: z
          .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements', 'quizzes']))
          .optional()
          .describe(
            'Content sources to scan. Omit to scan the default four: pages, assignments, ' +
              'syllabus, announcements. `quizzes` is opt-in — pass it explicitly to also scan ' +
              'Classic quiz descriptions/questions and New Quiz item stems; it issues one extra ' +
              'Canvas API call per quiz/New Quiz in the course.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const activeInclude = new Set<ContentSource>(
          (params.include as ContentSource[] | undefined) ?? DEFAULT_CONTENT_SOURCES,
        )

        const [pages, assignments, syllabus, announcements, quizFindings] = await Promise.all([
          activeInclude.has('pages') ? canvas.pages.listWithBodies(courseId) : Promise.resolve([]),
          activeInclude.has('assignments')
            ? canvas.assignments.list(courseId)
            : Promise.resolve([]),
          activeInclude.has('syllabus')
            ? canvas.courses.getSyllabus(courseId)
            : Promise.resolve(null),
          activeInclude.has('announcements')
            ? canvas.discussions.listAnnouncements(courseId)
            : Promise.resolve([]),
          activeInclude.has('quizzes')
            ? scanQuizzes(canvas, courseId)
            : Promise.resolve([] as LinkFinding[]),
        ])

        const findings: LinkFinding[] = []

        if (activeInclude.has('pages')) {
          for (const page of pages) {
            findings.push(
              ...scanHtml(page.body, courseId, {
                type: 'pages',
                id: page.page_id,
                title: page.title,
              }),
            )
          }
        }

        if (activeInclude.has('assignments')) {
          for (const a of assignments) {
            findings.push(
              ...scanHtml(a.description, courseId, {
                type: 'assignments',
                id: a.id,
                title: a.name,
              }),
            )
          }
        }

        if (activeInclude.has('syllabus') && syllabus) {
          findings.push(
            ...scanHtml(syllabus, courseId, { type: 'syllabus', id: courseId, title: 'Syllabus' }),
          )
        }

        if (activeInclude.has('announcements')) {
          for (const ann of announcements) {
            findings.push(
              ...scanHtml(ann.message, courseId, {
                type: 'announcements',
                id: ann.id,
                title: ann.title,
              }),
            )
          }
        }

        findings.push(...quizFindings)

        return {
          summary: {
            course_id: courseId,
            sources_scanned: CONTENT_SOURCES.filter((s) => activeInclude.has(s)),
            total_findings: findings.length,
          },
          findings,
        }
      },
    },
  ]
}
