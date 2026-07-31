import type { z } from 'zod'

/**
 * Internal audience tag on every tool. `'educator'` is the internal name for
 * the teacher-facing audience (the user-facing role is `teacher`; the tag stays
 * `educator` to avoid a wide rename). `'shared'` is an audience, never a role.
 */
export type ToolAudience = 'student' | 'educator' | 'admin' | 'shared'

/**
 * User-facing role values for role-based tool filtering (BRU-1637). Unset =
 * every tool is registered (the default, backwards-compatible behaviour).
 */
export type CanvasRole = 'student' | 'teacher' | 'admin'

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolUiCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
}

export interface ToolUiBinding {
  resourceUri: string
  csp?: ToolUiCsp
}

export interface ToolDefinition {
  name: string
  /**
   * Human-friendly display title surfaced to MCP clients (top-level `title` on
   * the MCP Tool, required for the Anthropic Connectors Directory). When
   * omitted, the title is resolved centrally from the tool name via
   * `resolveTitle` in `titles.ts` (its override map, else mechanical Title
   * Case) — mirroring how `audience` defaults from the domain. Set this only to
   * override the resolved title on a specific tool.
   */
  title?: string
  description: string
  inputSchema: Record<string, z.ZodType>
  annotations: ToolAnnotations
  handler: (params: Record<string, unknown>) => Promise<unknown>
  ui?: ToolUiBinding
  /**
   * Audience this tool is visible to under role-based filtering. When omitted,
   * the tool inherits its domain's `defaultPrimaryAudience` from `catalog.ts`
   * (applied by `tagAudience` in `getAllTools`). Set this only when a tool
   * diverges from its domain default.
   */
  audience?: ToolAudience
}
