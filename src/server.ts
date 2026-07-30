import { version } from '../package.json'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import { Pseudonymizer } from './pseudonym/pseudonymizer'
import { registerAllTools } from './tools'
import type { CanvasRole, ToolFeatureFlags } from './tools/types'
import { registerAllResources } from './resources'

export interface CanvasMCPServerConfig {
  token: string
  baseUrl: string
  /**
   * Optional pseudonymizer instance. Passed through to the tool layer so the
   * `_meta.pseudonymized` envelope and the `resolve_pseudonym` tool registration
   * are driven by it. Defaults to a fresh instance keyed on `baseUrl` — the
   * default is sufficient for stdio. HTTP transports should construct their own
   * process-wide singleton (one map per host/course on disk) and reuse it
   * across requests.
   */
  pseudonymizer?: Pseudonymizer
  /**
   * Optional Canvas role for role-based tool filtering. When set, only tools
   * visible to that role are registered; when omitted, every tool is registered
   * (the default, backwards-compatible behaviour). The role is a client-side UX
   * filter only — Canvas still enforces real permissions server-side.
   */
  role?: CanvasRole
  /**
   * When true, registers the opt-in assignment submission tools
   * (submit_assignment, upload_submission_file). Controlled by
   * CANVAS_ENABLE_ASSIGNMENT_SUBMISSION env / --enable-assignment-submission flag.
   */
  enableAssignmentSubmission?: boolean
}

export interface CanvasMCPServer {
  server: McpServer
  canvas: CanvasClient
  pseudonymizer: Pseudonymizer
}

export function createCanvasMCPServer(config: CanvasMCPServerConfig): CanvasMCPServer {
  const canvas = new CanvasClient({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const pseudonymizer = config.pseudonymizer ?? new Pseudonymizer({ baseUrl: config.baseUrl })

  const server = new McpServer({
    name: 'canvas-lms-mcp',
    version,
  })

  const features: ToolFeatureFlags = {
    assignmentSubmission: config.enableAssignmentSubmission,
  }
  registerAllTools(server, canvas, pseudonymizer, config.role, features)
  registerAllResources(server, canvas)

  return { server, canvas, pseudonymizer }
}
