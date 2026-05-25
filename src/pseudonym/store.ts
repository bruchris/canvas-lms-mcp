// Filesystem read/write for pseudonym maps.
//
// On-disk shape (file per <host>/<course_id>.json):
//
// {
//   "version": 1,
//   "host": "school.instructure.com",
//   "course_id": 12345,
//   "generated_at": "2026-05-25T14:00:00Z",
//   "next_pseudonym_index": 28,
//   "students": {
//     "98765": { "pseudonym": "Student 1", "status": "active",     "first_seen": "2026-02-03T..." },
//     "98770": { "pseudonym": "Student 3", "status": "historical", "first_seen": "2026-02-10T...",
//                "marked_historical_at": "2026-05-01T..." }
//   }
// }
//
// Writes are atomic: write to <file>.tmp-<rand> then rename over the target.
// Directory created 0o700, file created 0o600 (best-effort on Windows).

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { dirname } from 'node:path'

export const CURRENT_MAP_VERSION = 1

export type StudentStatus = 'active' | 'historical'

export interface StudentEntry {
  pseudonym: string
  status: StudentStatus
  first_seen: string
  marked_historical_at?: string
}

export interface CourseMap {
  version: number
  host: string
  course_id: number | string
  generated_at: string
  next_pseudonym_index: number
  /** Keyed by Canvas user_id as a string. */
  students: Record<string, StudentEntry>
}

export interface ConversationMap {
  version: number
  host: string
  generated_at: string
  next_pseudonym_index: number
  participants: Record<string, StudentEntry>
}

/** Create an empty CourseMap for a fresh allocation cycle. */
export function emptyCourseMap(host: string, courseId: number | string): CourseMap {
  return {
    version: CURRENT_MAP_VERSION,
    host,
    course_id: courseId,
    generated_at: new Date().toISOString(),
    next_pseudonym_index: 1,
    students: {},
  }
}

/** Create an empty cross-course conversations map. */
export function emptyConversationMap(host: string): ConversationMap {
  return {
    version: CURRENT_MAP_VERSION,
    host,
    generated_at: new Date().toISOString(),
    next_pseudonym_index: 1,
    participants: {},
  }
}

/**
 * Load a JSON map from disk. Returns `null` when the file does not exist.
 * Throws on permission errors or malformed JSON — those are operator-fixable
 * misconfigurations and silent fallback would mask them.
 */
export async function loadMap<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if (isNoEntError(err)) return null
    throw err
  }
}

/**
 * Write a JSON map to disk atomically. Creates parent directories with 0o700
 * and writes the file with 0o600. On Windows these modes are best-effort —
 * `fs.chmod` succeeds but POSIX semantics do not apply; documented in the
 * design doc.
 */
export async function saveMap(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const json = JSON.stringify(data, null, 2)

  await writeFile(tmpPath, json, { encoding: 'utf8', mode: 0o600 })
  // Best-effort tighten in case the umask widened the mode. Ignore failures.
  try {
    await chmod(tmpPath, 0o600)
  } catch {
    // Windows or restricted FS — fall through; mode is best-effort.
  }
  await rename(tmpPath, filePath)
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  )
}
