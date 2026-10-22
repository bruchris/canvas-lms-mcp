// Opt-in toolset filtering (GH #442 Phase 1, BRU-3128).
//
// A toolset is a coarse grouping of tool *domains*, so a client that only needs
// grading can ask for a smaller `tools/list` instead of all of them. Like
// `CANVAS_ROLE` (see `roles.ts`) this is a client-side UX/context-reduction
// filter only: Canvas still enforces real permissions server-side, and asking
// for a toolset grants nothing.
//
// Unset — and the explicit value `all` — register every tool, which is today's
// behaviour byte-for-byte. There is deliberately no default narrowing: flipping
// the default surface is a breaking change reserved for a major release.

/**
 * The nine toolsets, in the order they are documented.
 *
 * Every domain in `toolDomainCatalog` maps to exactly **one** of these, which
 * is what makes a selection a partition rather than an overlapping set of tags.
 * `tests/tools/toolset-coverage.test.ts` fails if any toolset here has no
 * domain, and the required `toolset` field on `ToolDomainRegistration` makes a
 * missing assignment a compile error.
 */
export const CANVAS_TOOLSETS = [
  'core',
  'grading',
  'quizzes',
  'people',
  'communication',
  'outcomes',
  'course_ops',
  'account',
  'student',
] as const

export type CanvasToolset = (typeof CANVAS_TOOLSETS)[number]

/** One-line summary per toolset, for `--help` and the docs table. */
export const TOOLSET_SUMMARIES: Record<CanvasToolset, string> = {
  core: 'Courses, assignments, modules, pages, files, health check',
  grading: 'Submissions, rubrics, peer reviews, gradebook history, grade explanations, analytics',
  quizzes: 'Classic and New Quizzes, quiz responses, quiz accommodations',
  people: 'Users, groups, enrollments, cross-course student search',
  communication: 'Discussions, announcements, conversations',
  outcomes: 'Outcomes, outcome groups, rollups, mastery',
  course_ops:
    'Course setup, content exports/migrations, calendar, appointments, link and a11y audits',
  account: 'Account and sub-account administration',
  student: 'The caller-is-a-student surface: my courses, grades, submissions, planner, dashboard',
}

const TOOLSET_SET: ReadonlySet<string> = new Set<string>(CANVAS_TOOLSETS)

function isCanvasToolset(value: string): value is CanvasToolset {
  return TOOLSET_SET.has(value)
}

export interface ToolsetParseResult {
  /**
   * The selected toolsets, or `undefined` for *no filter* — which is unset,
   * empty, `all`, and (deliberately) any value carrying an unknown name.
   *
   * Never an empty set. A caller receiving a set can rely on it narrowing
   * something, so "no filter" has exactly one representation.
   */
  toolsets?: ReadonlySet<CanvasToolset>
  /**
   * Supplied names that are not toolsets, in input order, deduped. Non-empty
   * means the caller should warn; `toolsets` is then `undefined`.
   */
  unknown: readonly string[]
}

/**
 * Parse a raw toolset list (env var, CLI flag, or HTTP header), case-insensitively.
 *
 * - unset / empty / `all` → `{ unknown: [] }` (no filter, no warning)
 * - a comma-separated list of known names → `{ toolsets, unknown: [] }`
 * - a list containing **any** unknown name → `{ unknown: [...] }`, i.e. no filter
 *
 * That last rule is the one worth stating out loud: a typo discards the *whole*
 * selection rather than silently honouring the names that happened to parse.
 * Both halves matter. It matches `parseRole`, where an unrecognised value
 * registers everything; and it fails in the direction that never hides a tool
 * the operator asked for — honouring the parseable remainder would quietly
 * serve a *narrower* surface than the operator typed, which is the one outcome
 * a misconfigured client cannot detect from the result.
 *
 * `all` anywhere in the list wins outright, for the same reason: the widest
 * reading of an ambiguous request cannot hide anything.
 *
 * Never throws — a config typo must not stop the MCP server from starting.
 */
export function parseToolsets(raw: string | null | undefined): ToolsetParseResult {
  if (raw == null) return { unknown: [] }

  const parts = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')

  if (parts.length === 0) return { unknown: [] }
  if (parts.includes('all')) return { unknown: [] }

  const unknown = [...new Set(parts.filter((part) => !isCanvasToolset(part)))]
  if (unknown.length > 0) return { unknown }

  return { toolsets: new Set(parts.filter(isCanvasToolset)), unknown: [] }
}

/**
 * The stderr warning for an unparseable toolset list. Names the offending
 * values and says what the server did instead, so the operator can tell a typo
 * from a surface they actually asked for.
 */
export function unknownToolsetWarning(source: string, unknown: readonly string[]): string {
  return (
    `Unknown ${source} value${unknown.length > 1 ? 's' : ''} ` +
    `'${unknown.join("', '")}'; ignoring and registering all tools. ` +
    `Known toolsets: ${CANVAS_TOOLSETS.join(', ')}.`
  )
}
