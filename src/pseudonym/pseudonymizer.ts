// Pseudonymizer — opt-in, server-side replacement of student PII in tool output.
//
// Tamper-resistant: the on/off decision is made from `process.env` only, never
// from tool arguments, MCP request fields, or HTTP headers.
//
// Stable: each Canvas user_id maps to the same `Student N` for the lifetime of
// the course's pseudonym file. Re-enrollment restores the original pseudonym;
// dropped students are marked `historical` and their slot is NEVER reused.
//
// See `docs/superpowers/specs/2026-05-25-ferpa-pseudonymization.md` for the
// full threat model and rationale.

import type {
  CanvasConversation,
  CanvasConversationDetail,
  CanvasEnrollment,
  CanvasOutcomeResultsResponse,
  CanvasOutcomeRollupsResponse,
  CanvasSubmission,
  CanvasSubmissionComment,
  CanvasUser,
} from '../canvas/types'
import { conversationsFilePath, mapFilePath, normalizeHost, resolvePseudonymDir } from './paths'
import { classifyRole, shouldPseudonymize, type Role } from './roles'
import {
  emptyConversationMap,
  emptyCourseMap,
  loadMap,
  saveMap,
  type ConversationMap,
  type CourseMap,
  type StudentEntry,
} from './store'

export interface PseudonymizerConfig {
  /** Canvas base URL — used to key the per-host map directory. */
  baseUrl: string
  /** Root directory for map files. Defaults to platform/XDG location. */
  rootDir?: string
  /** Env reader; defaults to `process.env`. Injection point for tests. */
  env?: NodeJS.ProcessEnv
  /** Audit log writer for `resolve_pseudonym` calls; defaults to `console.error`. */
  auditLog?: (line: string) => void
}

export interface ReverseLookupResult {
  user_id: number
  pseudonym: string
  status: 'active' | 'historical'
}

/**
 * Result of the pseudonymizer's per-request status check. The fields here are
 * the inputs the tool-response wrapper needs to attach `_meta.pseudonymized`.
 */
export interface PseudonymizationStatus {
  enabled: boolean
  reverseLookupEnabled: boolean
}

const TRUTHY_ENV_VALUES = new Set(['true', '1', 'yes', 'on'])

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
}

/**
 * Single-process pseudonymizer. One instance per running server. Construct
 * once at startup and re-use across requests; an HTTP server that creates a
 * fresh MCP server per request still shares this singleton.
 */
export class Pseudonymizer {
  private readonly host: string | null
  private readonly rootDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly auditLog: (line: string) => void

  // In-memory caches of loaded maps, keyed by `<host>/<courseId>` or
  // `<host>/_conversations`. Loaded lazily; written through on mutation.
  private readonly courseMaps = new Map<string, CourseMap>()
  private readonly conversationMaps = new Map<string, ConversationMap>()

  // Per-target async locks. A second mutator awaits the prior promise so that
  // pseudonym allocation cannot race within a single Node process. Cross-
  // process concurrency falls back to last-writer-wins (documented).
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(config: PseudonymizerConfig) {
    this.host = normalizeHost(config.baseUrl)
    this.rootDir = config.rootDir ?? resolvePseudonymDir({ env: config.env })
    this.env = config.env ?? process.env
    this.auditLog = config.auditLog ?? ((line) => console.error(line))
  }

  /**
   * True when `CANVAS_PSEUDONYMIZE_STUDENTS` is set to a truthy value. Read
   * from env on every call so that test setup can flip the flag mid-process.
   */
  isEnabled(): boolean {
    return isEnvTruthy(this.env.CANVAS_PSEUDONYMIZE_STUDENTS)
  }

  /**
   * True when reverse lookup is enabled. Only meaningful when `isEnabled()`.
   */
  isReverseLookupEnabled(): boolean {
    return this.isEnabled() && isEnvTruthy(this.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP)
  }

  status(): PseudonymizationStatus {
    return {
      enabled: this.isEnabled(),
      reverseLookupEnabled: this.isReverseLookupEnabled(),
    }
  }

  /**
   * Pseudonymize a single user when classified as student/unknown. Staff and
   * unknown-host (unparseable base URL) calls pass through unchanged.
   */
  async anonymizeUser(
    courseId: number | string,
    user: CanvasUser,
    enrollments?: ReadonlyArray<CanvasEnrollment>,
  ): Promise<CanvasUser> {
    if (!this.isEnabled() || !this.host) return user
    const role = classifyRole(user, enrollments)
    if (!shouldPseudonymize(role)) return user
    const entry = await this.assignPseudonym(this.host, courseId, user.id)
    return applyPseudonymToUser(user, entry.pseudonym)
  }

  async anonymizeUsers(
    courseId: number | string,
    users: ReadonlyArray<CanvasUser>,
  ): Promise<CanvasUser[]> {
    if (!this.isEnabled() || !this.host) return [...users]
    const out: CanvasUser[] = []
    for (const u of users) {
      out.push(await this.anonymizeUser(courseId, u))
    }
    return out
  }

  /**
   * Pseudonymize an enrollment in place: scrubs `sis_user_id` and rewrites
   * the embedded `user` when present.
   */
  async anonymizeEnrollment(
    courseId: number | string,
    enrollment: CanvasEnrollment,
  ): Promise<CanvasEnrollment> {
    if (!this.isEnabled() || !this.host) return enrollment
    const role = enrollment.user
      ? classifyRole(enrollment.user, [enrollment])
      : classifyRoleFromEnrollment(enrollment)
    if (!shouldPseudonymize(role)) return enrollment

    const out: CanvasEnrollment = { ...enrollment, sis_user_id: null }
    if (enrollment.user) {
      const entry = await this.assignPseudonym(this.host, courseId, enrollment.user.id)
      out.user = applyPseudonymToUser(enrollment.user, entry.pseudonym)
    }
    return out
  }

  /**
   * Pseudonymize a submission: rewrites `submission.user` and any
   * student-authored `submission_comments` based on the per-course map.
   * Comment authors whose role cannot be inferred fall back to "if we have
   * a pseudonym for this user_id, use it; otherwise pass through" — see
   * design doc, "submission_comments[].author_name when the author is a
   * student (peer feedback)".
   */
  async anonymizeSubmission(
    courseId: number | string,
    submission: CanvasSubmission,
  ): Promise<CanvasSubmission> {
    if (!this.isEnabled() || !this.host) return submission

    const out: CanvasSubmission = { ...submission }

    if (submission.user) {
      const role = classifyRole(submission.user)
      if (shouldPseudonymize(role)) {
        const entry = await this.assignPseudonym(this.host, courseId, submission.user.id)
        out.user = applyPseudonymToUser(submission.user, entry.pseudonym)
      }
    }

    if (submission.submission_comments && submission.submission_comments.length > 0) {
      out.submission_comments = await this.anonymizeSubmissionComments(
        courseId,
        submission.submission_comments,
      )
    }

    return out
  }

  /**
   * Pseudonymize all participants in a conversation. Conversations span
   * courses, so we use a cross-course `_conversations.json` pool keyed only
   * by host — conservative because we cannot reliably classify role without
   * a course context.
   */
  async anonymizeConversation<T extends CanvasConversation | CanvasConversationDetail>(
    conversation: T,
  ): Promise<T> {
    if (!this.isEnabled() || !this.host) return conversation

    const participants = await Promise.all(
      conversation.participants.map(async (p) => {
        const pseudonym = await this.assignConversationPseudonym(this.host as string, p.id)
        return { ...p, name: pseudonym }
      }),
    )

    return { ...conversation, participants } as T
  }

  /**
   * Pseudonymize the `linked.users` array of an outcome results / rollups
   * response.
   */
  async anonymizeOutcomeResults<
    T extends CanvasOutcomeResultsResponse | CanvasOutcomeRollupsResponse,
  >(courseId: number | string, response: T): Promise<T> {
    if (!this.isEnabled() || !this.host) return response
    if (!response.linked?.users || response.linked.users.length === 0) return response

    const users = await this.anonymizeUsers(courseId, response.linked.users)
    return { ...response, linked: { ...response.linked, users } } as T
  }

  /**
   * Look up the real user_id behind a pseudonym. Returns `null` when reverse
   * lookup is disabled, the host is invalid, or the pseudonym is unknown.
   * Audit-logs every successful and failed lookup.
   */
  async reverseLookup(
    courseId: number | string,
    pseudonym: string,
  ): Promise<ReverseLookupResult | null> {
    if (!this.isReverseLookupEnabled() || !this.host) return null

    const map = await this.loadCourseMap(this.host, courseId)
    if (!map) {
      this.audit(`reverse_lookup miss course=${courseId} pseudonym=${pseudonym} reason=no-map`)
      return null
    }

    for (const [userIdStr, entry] of Object.entries(map.students)) {
      if (entry.pseudonym === pseudonym) {
        const userId = Number(userIdStr)
        this.audit(
          `reverse_lookup hit course=${courseId} pseudonym=${pseudonym} status=${entry.status}`,
        )
        return { user_id: userId, pseudonym: entry.pseudonym, status: entry.status }
      }
    }

    this.audit(`reverse_lookup miss course=${courseId} pseudonym=${pseudonym} reason=not-found`)
    return null
  }

  // --- Internals --------------------------------------------------------------

  /**
   * Allocate (or restore) the pseudonym for a given (host, courseId, userId).
   * Holds an in-memory async lock on the target so two concurrent allocations
   * cannot collide on `next_pseudonym_index`.
   */
  private async assignPseudonym(
    host: string,
    courseId: number | string,
    userId: number,
  ): Promise<StudentEntry> {
    const key = `${host}/${courseId}`
    return this.withLock(key, async () => {
      const map = (await this.loadCourseMap(host, courseId)) ?? emptyCourseMap(host, courseId)
      const userKey = String(userId)
      const existing = map.students[userKey]

      if (existing) {
        // Re-enrollment: restore historical entries to active without changing
        // the assigned pseudonym.
        if (existing.status === 'historical') {
          const restored: StudentEntry = {
            ...existing,
            status: 'active',
          }
          delete restored.marked_historical_at
          map.students[userKey] = restored
          await this.persistCourseMap(host, courseId, map)
          return restored
        }
        return existing
      }

      const entry: StudentEntry = {
        pseudonym: `Student ${map.next_pseudonym_index}`,
        status: 'active',
        first_seen: new Date().toISOString(),
      }
      map.students[userKey] = entry
      map.next_pseudonym_index += 1
      await this.persistCourseMap(host, courseId, map)
      return entry
    })
  }

  private async assignConversationPseudonym(host: string, userId: number): Promise<string> {
    const key = `${host}/_conversations`
    return this.withLock(key, async () => {
      const map = (await this.loadConversationMap(host)) ?? emptyConversationMap(host)
      const userKey = String(userId)
      const existing = map.participants[userKey]
      if (existing) return existing.pseudonym

      const entry: StudentEntry = {
        pseudonym: `Person ${map.next_pseudonym_index}`,
        status: 'active',
        first_seen: new Date().toISOString(),
      }
      map.participants[userKey] = entry
      map.next_pseudonym_index += 1
      await this.persistConversationMap(host, map)
      return entry.pseudonym
    })
  }

  private async anonymizeSubmissionComments(
    courseId: number | string,
    comments: ReadonlyArray<CanvasSubmissionComment>,
  ): Promise<CanvasSubmissionComment[]> {
    const map = this.host ? ((await this.loadCourseMap(this.host, courseId)) ?? null) : null
    const out: CanvasSubmissionComment[] = []
    for (const c of comments) {
      const pseudonym = map?.students[String(c.author_id)]?.pseudonym
      if (pseudonym) {
        out.push({ ...c, author_name: pseudonym })
      } else {
        out.push({ ...c })
      }
    }
    return out
  }

  private async loadCourseMap(host: string, courseId: number | string): Promise<CourseMap | null> {
    const cacheKey = `${host}/${courseId}`
    const cached = this.courseMaps.get(cacheKey)
    if (cached) return cached
    const path = mapFilePath(this.rootDir, host, courseId)
    const loaded = await loadMap<CourseMap>(path)
    if (loaded) this.courseMaps.set(cacheKey, loaded)
    return loaded
  }

  private async persistCourseMap(
    host: string,
    courseId: number | string,
    map: CourseMap,
  ): Promise<void> {
    const path = mapFilePath(this.rootDir, host, courseId)
    map.generated_at = new Date().toISOString()
    await saveMap(path, map)
    this.courseMaps.set(`${host}/${courseId}`, map)
  }

  private async loadConversationMap(host: string): Promise<ConversationMap | null> {
    const cacheKey = `${host}/_conversations`
    const cached = this.conversationMaps.get(cacheKey)
    if (cached) return cached
    const path = conversationsFilePath(this.rootDir, host)
    const loaded = await loadMap<ConversationMap>(path)
    if (loaded) this.conversationMaps.set(cacheKey, loaded)
    return loaded
  }

  private async persistConversationMap(host: string, map: ConversationMap): Promise<void> {
    const path = conversationsFilePath(this.rootDir, host)
    map.generated_at = new Date().toISOString()
    await saveMap(path, map)
    this.conversationMaps.set(`${host}/_conversations`, map)
  }

  /**
   * Serialize work on a per-key basis. Each new task chains off the previous
   * one so that callers naturally observe FIFO ordering and do not race on
   * `next_pseudonym_index`.
   */
  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.then(task, task)
    this.locks.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  private audit(line: string): void {
    const stamped = `[${new Date().toISOString()}] canvas-lms-mcp pseudonym ${line}`
    try {
      this.auditLog(stamped)
    } catch (err) {
      // Never let a logging failure tear down a tool response.
      console.error('pseudonym audit log failed:', err)
    }
    const filePath = this.env.CANVAS_PSEUDONYM_AUDIT_LOG
    if (filePath) {
      // Best-effort append; failures are stderr-logged and swallowed.
      void appendAuditFile(filePath, stamped)
    }
  }
}

function classifyRoleFromEnrollment(enrollment: CanvasEnrollment): Role {
  return classifyRole({}, [enrollment])
}

function applyPseudonymToUser(user: CanvasUser, pseudonym: string): CanvasUser {
  const out: CanvasUser = {
    ...user,
    name: pseudonym,
    short_name: pseudonym,
    sortable_name: pseudonym,
  }

  if (user.email !== undefined) {
    const slug = pseudonym.toLowerCase().replace(/\s+/g, '-')
    out.email = `${slug}@anon.invalid`
  }
  if (user.login_id !== undefined) {
    out.login_id = pseudonym.toLowerCase().replace(/\s+/g, '-')
  }

  // Explicit null-out — these would otherwise leak identity.
  out.sis_user_id = null
  out.integration_id = null
  if (user.avatar_url !== undefined) out.avatar_url = undefined
  if (user.bio !== undefined) out.bio = null
  if (user.pronouns !== undefined) out.pronouns = null
  if (user.last_login !== undefined) out.last_login = null

  return out
}

async function appendAuditFile(filePath: string, line: string): Promise<void> {
  try {
    const { appendFile, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await appendFile(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.error('pseudonym audit file append failed:', err)
  }
}
