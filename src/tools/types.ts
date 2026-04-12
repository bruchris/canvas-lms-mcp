import type { z } from 'zod'

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  annotations: ToolAnnotations
  handler: (params: Record<string, unknown>) => Promise<unknown>
}
