import { z } from 'zod'
import { CanvasApiError } from '../canvas'
import type { CanvasClient } from '../canvas'
import type { CanvasCourse, CanvasUser } from '../canvas/types'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const INSTRUCTOR_ENROLLMENT_TYPES = new Set(['TeacherEnrollment', 'TaEnrollment'])

interface FindStudentMatchedCourse {
  course_id: number
  course_name: string
  term: string | null
  enrollment_state: string
  last_activity_at: string | null
  user_name: string
}

interface FindStudentMatch {
  user_id: number
  matched_courses: FindStudentMatchedCourse[]
}

export function studentSearchTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'find_student_across_courses',
      description:
        "Search the caller's teaching courses — active and, by default, concluded (past-term) " +
        'ones — for a student by name, login, or email, and report every matching course with ' +
        "the student's enrollment state and last activity. Set `include_concluded: false` to " +
        "only search current courses. `max_courses` bounds how many of the caller's courses are " +
        'scanned (most recent term first); when exceeded, `truncated: true` is set rather than ' +
        'silently dropping courses. A course that errors during the scan is skipped and reported ' +
        'in `courses_failed` rather than failing the whole call.',
      inputSchema: {
        search_term: z
          .string()
          .min(2)
          .describe('Student name, login, or email to search for (at least 2 characters)'),
        include_concluded: z
          .boolean()
          .optional()
          .describe('Also search courses with a concluded (completed) enrollment. Default true.'),
        max_courses: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Cap on the number of teaching courses scanned, most recent term first. Default 200.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const searchTerm = params.search_term as string
        const includeConcluded = (params.include_concluded as boolean | undefined) ?? true
        const maxCourses = (params.max_courses as number | undefined) ?? 200

        // 1. Enumerate teaching courses.
        const activeCourses = await canvas.courses.list({})
        const concludedCourses = includeConcluded
          ? await canvas.courses.list({ enrollment_state: 'completed' })
          : []

        const byId = new Map<number, CanvasCourse>()
        for (const c of [...activeCourses, ...concludedCourses]) {
          const existing = byId.get(c.id)
          if (!existing) {
            byId.set(c.id, c)
          } else {
            byId.set(c.id, {
              ...existing,
              enrollments: [...(existing.enrollments ?? []), ...(c.enrollments ?? [])],
            })
          }
        }

        // Filter to teaching courses; include on missing enrollments (defensive fallback).
        const teachingCourses = [...byId.values()].filter(
          (c) =>
            (c.enrollments ?? []).length === 0 ||
            c.enrollments!.some((e) => INSTRUCTOR_ENROLLMENT_TYPES.has(e.type)),
        )

        // 2. Bound the fan-out, most-recent-term first; undated courses sort last.
        const coursesFound = teachingCourses.length
        const sorted = [...teachingCourses].sort((a, b) => {
          const aTime = a.term?.start_at ? new Date(a.term.start_at).getTime() : -Infinity
          const bTime = b.term?.start_at ? new Date(b.term.start_at).getTime() : -Infinity
          return bTime - aTime
        })
        const truncated = coursesFound > maxCourses
        const coursesToScan = truncated ? sorted.slice(0, maxCourses) : sorted

        // 3. Fan out per-course search with per-course failure tolerance.
        const coursesFailed: Array<{ course_id: number; status: number | null; message: string }> =
          []
        const perCourseMatches: Array<{ course: CanvasCourse; users: CanvasUser[] }> = []

        const results = await Promise.all(
          coursesToScan.map(async (course) => {
            try {
              const users = await canvas.users.listCourseUsers(course.id, {
                search_term: searchTerm,
                enrollment_type: ['student'],
                enrollment_state: ['active', 'completed', 'inactive', 'invited', 'rejected'],
                include: ['enrollments'],
              })
              return { ok: true as const, course, users }
            } catch (err) {
              return { ok: false as const, course, err }
            }
          }),
        )

        for (const r of results) {
          if (r.ok) {
            perCourseMatches.push({ course: r.course, users: r.users })
          } else {
            coursesFailed.push({
              course_id: r.course.id,
              status: r.err instanceof CanvasApiError ? r.err.status : null,
              message: r.err instanceof CanvasApiError ? r.err.message : String(r.err),
            })
          }
        }

        // 4. Pseudonymize per course (per-course map, never hoisted).
        const resolvedByCourse = new Map<number, CanvasUser[]>()
        for (const { course, users } of perCourseMatches) {
          resolvedByCourse.set(
            course.id,
            pseudonymizer?.isEnabled()
              ? await pseudonymizer.anonymizeUsers(course.id, users)
              : users,
          )
        }

        // 5. Group by real user_id across courses.
        const byUser = new Map<number, FindStudentMatch>()
        for (const { course, users: rawUsers } of perCourseMatches) {
          const resolved = resolvedByCourse.get(course.id)!
          rawUsers.forEach((rawUser, i) => {
            const resolvedUser = resolved[i] ?? rawUser
            const enrollment =
              rawUser.enrollments?.find((e) => e.type === 'StudentEnrollment') ??
              rawUser.enrollments?.[0]
            const entry = byUser.get(rawUser.id) ?? {
              user_id: rawUser.id,
              matched_courses: [],
            }
            entry.matched_courses.push({
              course_id: course.id,
              course_name: course.name,
              term: course.term?.name ?? null,
              enrollment_state: enrollment?.enrollment_state ?? 'unknown',
              last_activity_at: enrollment?.last_activity_at ?? null,
              user_name: resolvedUser.name,
            })
            byUser.set(rawUser.id, entry)
          })
        }

        const matches = [...byUser.values()]

        return {
          include_concluded: includeConcluded,
          courses_found: coursesFound,
          courses_scanned: coursesToScan.length,
          truncated,
          courses_failed: coursesFailed,
          matches_count: matches.length,
          matches,
        }
      },
    },
  ]
}
