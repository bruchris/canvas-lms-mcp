import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements', 'quizzes'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]

const DEFAULT_CONTENT_SOURCES: ContentSource[] = [
  'pages',
  'assignments',
  'syllabus',
  'announcements',
]

const CLASSIC_QUIZ_TYPES = new Set(['assignment', 'practice_quiz', 'graded_survey', 'survey'])

type AccessibilityRule =
  | 'img_missing_alt'
  | 'img_alt_low_quality'
  | 'link_non_descriptive_text'
  | 'adjacent_duplicate_links'
  | 'heading_skipped_level'
  | 'heading_empty'
  | 'heading_too_long'
  | 'table_missing_header'
  | 'table_header_missing_scope'
  | 'table_missing_caption'

type Severity = 'error' | 'advisory'

const WCAG_BY_RULE: Record<AccessibilityRule, string> = {
  img_missing_alt: '1.1.1',
  img_alt_low_quality: '1.1.1',
  link_non_descriptive_text: '2.4.4',
  adjacent_duplicate_links: '2.4.4',
  heading_skipped_level: '1.3.1',
  heading_empty: '2.4.6',
  heading_too_long: '2.4.6',
  table_missing_header: '1.3.1',
  table_header_missing_scope: '1.3.1',
  table_missing_caption: '1.3.1',
}

const SEVERITY_BY_RULE: Record<AccessibilityRule, Severity> = {
  img_missing_alt: 'error',
  img_alt_low_quality: 'advisory',
  link_non_descriptive_text: 'advisory',
  adjacent_duplicate_links: 'advisory',
  heading_skipped_level: 'advisory',
  heading_empty: 'error',
  heading_too_long: 'advisory',
  table_missing_header: 'advisory',
  table_header_missing_scope: 'advisory',
  table_missing_caption: 'advisory',
}

interface ContentLocation {
  type: ContentSource
  id: number
  title: string
  quiz_engine?: 'classic' | 'new'
  question_id?: number | string
}

interface AccessibilityFinding {
  location: ContentLocation
  rule: AccessibilityRule
  wcag: string
  severity: Severity
  detail: string
}

function makeFinding(
  location: ContentLocation,
  rule: AccessibilityRule,
  detail: string,
): AccessibilityFinding {
  return { location, rule, wcag: WCAG_BY_RULE[rule], severity: SEVERITY_BY_RULE[rule], detail }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

// Image scanning

const IMG_RE = /<img\b([^>]*)>/gi
// Requires whitespace or start-of-attributes before `alt=` to avoid matching `data-alt="..."`.
const ALT_ATTR_RE = /(?:^|\s)alt="([^"]*)"/i
const FILENAME_EXT_RE = /\.(jpe?g|png|gif|svg|webp|bmp|tiff?)$/i
const GENERIC_ALT_WORDS = new Set([
  'image',
  'photo',
  'photograph',
  'picture',
  'img',
  'screenshot',
  'graphic',
])
const CAMERA_FILENAME_RE = /^(img|dsc|photo|image)[\s_-]?\d+$/i

function isLowQualityAlt(alt: string): boolean {
  const normalized = alt.toLowerCase()
  return (
    FILENAME_EXT_RE.test(alt) ||
    GENERIC_ALT_WORDS.has(normalized) ||
    CAMERA_FILENAME_RE.test(normalized)
  )
}

function scanImages(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  IMG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMG_RE.exec(html)) !== null) {
    const attrs = m[1] ?? ''
    const altMatch = attrs.match(ALT_ATTR_RE)
    if (!altMatch) {
      findings.push(makeFinding(location, 'img_missing_alt', 'Image has no alt attribute.'))
      continue
    }
    const alt = decodeHtmlEntities(altMatch[1] ?? '').trim()
    if (!alt) continue // alt="" is a valid decorative-image marker — not a finding.
    if (isLowQualityAlt(alt)) {
      findings.push(
        makeFinding(
          location,
          'img_alt_low_quality',
          `Alt text "${alt}" looks like a filename or generic placeholder.`,
        ),
      )
    }
  }
  return findings
}

// Link scanning

const LINK_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

const NON_DESCRIPTIVE_LINK_TEXT = new Set([
  '',
  'click here',
  'here',
  'click',
  'read more',
  'more',
  'more info',
  'more information',
  'link',
  'this link',
])

interface ExtractedLink {
  href: string
  accessibleName: string
  start: number
  end: number
}

function linkAccessibleName(innerHtml: string): string {
  const text = stripTags(innerHtml)
  if (text) return text
  // Two-stage: isolate the <img> tag's attribute substring, then apply ALT_ATTR_RE to it.
  // This correctly handles `(?:^|\s)alt="` which anchors to "start of the tag's attributes,"
  // not the start of the entire innerHtml string.
  IMG_RE.lastIndex = 0
  const imgMatch = IMG_RE.exec(innerHtml)
  if (!imgMatch) return ''
  const altMatch = (imgMatch[1] ?? '').match(ALT_ATTR_RE)
  return altMatch ? decodeHtmlEntities(altMatch[1] ?? '').trim() : ''
}

function extractLinks(html: string): ExtractedLink[] {
  const links: ExtractedLink[] = []
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(html)) !== null) {
    links.push({
      href: decodeHtmlEntities(m[1] ?? '').trim(),
      accessibleName: linkAccessibleName(m[2] ?? ''),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return links
}

function scanLinks(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  const links = extractLinks(html)

  for (const link of links) {
    const name = link.accessibleName.toLowerCase()
    if (NON_DESCRIPTIVE_LINK_TEXT.has(name)) {
      findings.push(
        makeFinding(
          location,
          'link_non_descriptive_text',
          link.accessibleName
            ? `Link text "${link.accessibleName}" is not descriptive out of context.`
            : 'Link has no accessible name (no text and no alt text on a contained image).',
        ),
      )
    }
  }

  for (let i = 0; i < links.length - 1; i++) {
    const a = links[i]
    const b = links[i + 1]
    if (!a || !b || !a.href || a.href !== b.href) continue
    if (/^\s*$/.test(html.slice(a.end, b.start))) {
      findings.push(
        makeFinding(
          location,
          'adjacent_duplicate_links',
          `Two adjacent links both point to "${a.href}" — merge into a single link.`,
        ),
      )
    }
  }

  return findings
}

// Heading scanning

const HEADING_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
const MAX_HEADING_LENGTH = 120

interface ExtractedHeading {
  level: number
  text: string
}

function extractHeadings(html: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEADING_RE.exec(html)) !== null) {
    headings.push({ level: parseInt(m[1] ?? '1', 10), text: stripTags(m[2] ?? '') })
  }
  return headings
}

function scanHeadings(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  const headings = extractHeadings(html)

  for (const h of headings) {
    if (!h.text) {
      findings.push(makeFinding(location, 'heading_empty', `Empty <h${h.level}> heading.`))
    } else if (h.text.length > MAX_HEADING_LENGTH) {
      findings.push(
        makeFinding(
          location,
          'heading_too_long',
          `Heading is ${h.text.length} characters (recommended max ${MAX_HEADING_LENGTH}): "${h.text.slice(0, 60)}..."`,
        ),
      )
    }
  }

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]
    const curr = headings[i]
    if (!prev || !curr) continue
    if (curr.level > prev.level + 1) {
      findings.push(
        makeFinding(
          location,
          'heading_skipped_level',
          `Heading level jumps from <h${prev.level}> to <h${curr.level}> — skips level(s) in between.`,
        ),
      )
    }
  }

  return findings
}

// Table scanning

const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
const TH_TAG_RE = /<th\b[^>]*>/gi
const SCOPE_ATTR_RE = /(?:^|\s)scope="[^"]*"/i
const CAPTION_RE = /<caption\b[^>]*>/i

function scanTables(html: string, location: ContentLocation): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = []
  TABLE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TABLE_RE.exec(html)) !== null) {
    const inner = m[1] ?? ''
    const thTags = inner.match(TH_TAG_RE) ?? []

    if (thTags.length === 0) {
      findings.push(makeFinding(location, 'table_missing_header', 'Table has no <th> cells.'))
    } else if (!thTags.some((tag) => SCOPE_ATTR_RE.test(tag))) {
      findings.push(
        makeFinding(
          location,
          'table_header_missing_scope',
          'Table has header cells but none declare a scope attribute.',
        ),
      )
    }

    if (!CAPTION_RE.test(inner)) {
      findings.push(makeFinding(location, 'table_missing_caption', 'Table has no <caption>.'))
    }
  }
  return findings
}

// Aggregator

function scanContentAccessibility(
  html: string | null | undefined,
  location: ContentLocation,
): AccessibilityFinding[] {
  if (!html) return []
  return [
    ...scanImages(html, location),
    ...scanLinks(html, location),
    ...scanHeadings(html, location),
    ...scanTables(html, location),
  ]
}

async function scanQuizzesAccessibility(
  canvas: CanvasClient,
  courseId: number,
): Promise<AccessibilityFinding[]> {
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
      const findings = scanContentAccessibility(quiz.description, location)
      const questions = await canvas.quizzes.listQuestions(courseId, quiz.id)
      for (const question of questions) {
        findings.push(
          ...scanContentAccessibility(question.question_text, {
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
      return items.flatMap((item) =>
        scanContentAccessibility(item.entry?.item_body, { ...location, question_id: item.id }),
      )
    }),
  )

  return [...classicFindings.flat(), ...newQuizFindings.flat()]
}

export function accessibilityAuditTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'audit_course_accessibility',
      description:
        "Scan a course's content (pages, assignments, syllabus, announcements, and optionally " +
        'quizzes) for structurally-detectable WCAG 2.1 accessibility problems: images missing ' +
        'alt text or with low-quality (filename/generic) alt text, non-descriptive link text ' +
        '("click here"), adjacent duplicate links, skipped/empty/overlong headings, and tables ' +
        'missing headers, header scope, or captions. Each finding carries a WCAG success ' +
        'criterion and a severity (error = unambiguous failure, advisory = needs human review). ' +
        'Structural checks only — no color-contrast checking (requires rendered theme CSS this ' +
        'tool cannot see) and no list-misuse detection in this version. Pass "quizzes" in ' +
        '`include` to also scan Classic quiz descriptions/questions and New Quiz item stems ' +
        "(opt-in, off by default). Complements — does not replace — Canvas's own in-app " +
        'Accessibility Checker (course navigation → Accessibility → Scan Course), which covers ' +
        'the same WCAG areas plus rendered color contrast and offers in-UI remediation. ' +
        'Requires instructor permissions in the course.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        include: z
          .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements', 'quizzes']))
          .optional()
          .describe(
            'Content sources to scan. Omit to scan the default four: pages, assignments, ' +
              'syllabus, announcements. `quizzes` is opt-in — pass it explicitly to also scan ' +
              'Classic quiz descriptions/questions and New Quiz item stems.',
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
            ? scanQuizzesAccessibility(canvas, courseId)
            : Promise.resolve([] as AccessibilityFinding[]),
        ])

        const findings: AccessibilityFinding[] = []

        if (activeInclude.has('pages')) {
          for (const page of pages) {
            findings.push(
              ...scanContentAccessibility(page.body, {
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
              ...scanContentAccessibility(a.description, {
                type: 'assignments',
                id: a.id,
                title: a.name,
              }),
            )
          }
        }

        if (activeInclude.has('syllabus') && syllabus) {
          findings.push(
            ...scanContentAccessibility(syllabus, {
              type: 'syllabus',
              id: courseId,
              title: 'Syllabus',
            }),
          )
        }

        if (activeInclude.has('announcements')) {
          for (const ann of announcements) {
            findings.push(
              ...scanContentAccessibility(ann.message, {
                type: 'announcements',
                id: ann.id,
                title: ann.title,
              }),
            )
          }
        }

        findings.push(...quizFindings)

        const errorCount = findings.filter((f) => f.severity === 'error').length

        return {
          summary: {
            course_id: courseId,
            sources_scanned: CONTENT_SOURCES.filter((s) => activeInclude.has(s)),
            total_findings: findings.length,
            error_count: errorCount,
            advisory_count: findings.length - errorCount,
          },
          findings,
        }
      },
    },
  ]
}
