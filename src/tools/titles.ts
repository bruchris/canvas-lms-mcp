// Tool display titles (BRU-1984 / Connectors Directory readiness).
//
// The Anthropic Connectors Directory requires every tool to expose a top-level
// `title`. Rather than hand-write a literal on all 163 tool definitions, titles
// are resolved centrally — mirroring how `audience` defaults from the domain
// (see `tagAudience` in roles.ts). The baseline is mechanical Title Case of the tool name
// (`list_courses` → "List Courses"); the override map below hand-tunes the
// handful of names that Title Case reads badly for (acronyms, prepositions).
//
// This is the single source of truth used by both runtime registration
// (`tagTitle` in getAllTools) and the generated tool manifest (`buildToolManifest`).

import type { ToolDefinition } from './types'

/**
 * Hand-tuned titles for tool names where mechanical Title Case reads badly
 * (initialisms that should stay uppercase, lowercase prepositions mid-title,
 * hyphenated compounds). Keyed by tool name; anything not listed falls through
 * to `deriveTitle`.
 */
export const toolTitleOverrides: Readonly<Record<string, string>> = {
  get_migration_asset_id_mapping: 'Get Migration Asset ID Mapping',
  apply_grading_standard_to_course: 'Apply Grading Standard to Course',
  comment_on_submission: 'Comment on Submission',
  list_sub_accounts: 'List Sub-Accounts',
  get_todo_items: 'Get To-Do Items',
}

/**
 * Mechanical Title Case of a snake_case tool name: split on `_`, capitalise the
 * first letter of each word, join with spaces. `list_courses` → "List Courses".
 */
export function deriveTitle(name: string): string {
  return name
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolve a tool's display title. An explicit `title` on the definition wins,
 * then the override map, then mechanical Title Case. Always returns a non-empty
 * string for any non-empty tool name.
 */
export function resolveTitle(name: string, explicit?: string): string {
  return explicit ?? toolTitleOverrides[name] ?? deriveTitle(name)
}

/**
 * Mapper that fills in the resolved title for any tool that did not declare its
 * own. After mapping, every tool carries a concrete non-empty `title`, which the
 * coverage gate (tests/tools/title-coverage.test.ts) enforces.
 */
export function tagTitle(): (tool: ToolDefinition) => ToolDefinition {
  return (tool) => {
    tool.title = resolveTitle(tool.name, tool.title)
    return tool
  }
}
