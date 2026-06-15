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
