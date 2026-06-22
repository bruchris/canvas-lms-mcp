// Role-based tool filtering (BRU-1637 / design BRU-1530).
//
// A role is a client-side UX/context-reduction filter only — Canvas still
// enforces real permissions server-side. Setting `CANVAS_ROLE=admin` does not
// grant admin powers; it only changes which tools appear in `tools/list`.

import type { CanvasRole, ToolAudience, ToolDefinition } from './types'

/**
 * Which audiences each role can see. Note `teacher`/`admin` do NOT see the
 * `student`-only audience in v1 — the `get_my_*` tools are framed around the
 * caller being a student. Flipping this is a one-line change here if we later
 * decide instructors should see them.
 */
export const ROLE_VISIBILITY: Record<CanvasRole, ReadonlySet<ToolAudience>> = {
  student: new Set<ToolAudience>(['shared', 'student']),
  teacher: new Set<ToolAudience>(['shared', 'educator']),
  admin: new Set<ToolAudience>(['shared', 'educator', 'admin']),
}

/**
 * Returns a mapper that fills in the domain default audience for any tool that
 * did not declare its own. After mapping, every tool carries a concrete
 * `audience`, which the coverage gate (tests/tools/audience-coverage.test.ts)
 * enforces.
 */
export function tagAudience(
  defaultPrimaryAudience: ToolAudience,
): (tool: ToolDefinition) => ToolDefinition {
  return (tool) => {
    if (tool.audience === undefined) {
      tool.audience = defaultPrimaryAudience
    }
    return tool
  }
}

/** Whether a tool is visible to the given role. */
export function isVisibleForRole(tool: ToolDefinition, role: CanvasRole): boolean {
  return ROLE_VISIBILITY[role].has(tool.audience ?? 'shared')
}

export interface RoleParseResult {
  /** The canonical role, or undefined for unset / "all" / invalid input. */
  role?: CanvasRole
  /** True only when a non-empty value was supplied that is not a known role. */
  invalid: boolean
}

/**
 * Parse a raw role string (env var, CLI flag, or HTTP header) case-insensitively.
 *
 * - unset / empty / `all` → `{ invalid: false }` (no filter, no warning)
 * - `student` / `teacher` / `admin` (any case, trimmed) → `{ role, invalid: false }`
 * - anything else → `{ invalid: true }` (caller warns to stderr + registers all)
 *
 * Never throws — a config typo must not stop the MCP server from starting.
 */
export function parseRole(raw: string | null | undefined): RoleParseResult {
  if (raw == null) return { invalid: false }
  const value = raw.trim().toLowerCase()
  if (value === '' || value === 'all') return { invalid: false }
  if (value === 'student' || value === 'teacher' || value === 'admin') {
    return { role: value, invalid: false }
  }
  return { invalid: true }
}
