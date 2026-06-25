import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

const CONTENT_SOURCES = ['pages', 'assignments', 'syllabus', 'announcements'] as const
type ContentSource = (typeof CONTENT_SOURCES)[number]
type LinkKind = 'link' | 'image' | 'video'
type FindingReason = 'cross_course_reference' | 'empty_or_malformed'

interface ContentLocation {
  type: ContentSource
  id: number
  title: string
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

export function linkAuditTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'audit_course_links',
      description:
        "Scan a course's content (pages, assignments, syllabus, announcements) for broken or " +
        'outdated links and images. Returns structured findings: cross-course references (links ' +
        'that still point at a previous copy of the course — the canonical stale-copy failure ' +
        'after a course import) and empty/malformed URLs. Structural checks only — no outbound ' +
        'HTTP requests. Requires instructor permissions in the course.',
      inputSchema: {
        course_id: z.number().int().positive().describe('Canvas course ID'),
        include: z
          .array(z.enum(['pages', 'assignments', 'syllabus', 'announcements']))
          .optional()
          .describe(
            'Content sources to scan. Omit to scan all four. ' +
              'Valid values: pages, assignments, syllabus, announcements.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const activeInclude = new Set<ContentSource>(
          (params.include as ContentSource[] | undefined) ?? [...CONTENT_SOURCES],
        )

        const [pages, assignments, syllabus, announcements] = await Promise.all([
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
