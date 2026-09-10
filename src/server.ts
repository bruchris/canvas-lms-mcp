import { version } from '../package.json'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import { Pseudonymizer } from './pseudonym/pseudonymizer'
import { registerAllTools } from './tools'
import type { CanvasRole, ToolFeatureFlags } from './tools/types'
import { resolveDestructiveToolsMode, type DestructiveToolsMode } from './tools/destructive-policy'
import { registerAllResources } from './resources'

export interface CanvasMCPServerConfig {
  token: string
  baseUrl: string
  /**
   * Optional pseudonymizer instance. Passed through to the tool layer so the
   * `_meta.pseudonymized` envelope and the `resolve_pseudonym` tool registration
   * are driven by it. Defaults to a fresh instance keyed on `baseUrl` — the
   * default is sufficient for stdio, where one process serves one user holding
   * one token.
   *
   * A transport or embedder that serves callers with **different** Canvas
   * credentials from one process must construct its own process-wide singleton
   * (one map per host/course on disk) **with `sharedAcrossCallers: true`**, which
   * disables reverse lookup on that instance. Without it, `resolve_pseudonym`
   * would resolve a pseudonym for any caller from a map another caller seeded,
   * with no Canvas-side authorization (BRU-2511). `src/http.ts` does this.
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
  /**
   * Destructive-tool policy (BRU-2444, design BRU-2390 §7).
   *
   * - `allow` (default) — today's behaviour, byte-for-byte.
   * - `block` — the seven irreversible delete tools are not registered at all.
   *
   * When omitted, `CANVAS_DESTRUCTIVE_TOOLS` from the environment is used, so a
   * library embedder that never goes through `parseArgs` still honours the
   * deployer's policy. An unrecognised value on either surface **throws here**
   * rather than falling back to `allow` — a typo'd kill switch must not fail
   * open. `confirm` is reserved by the design but unimplemented, and is
   * rejected with its own message.
   */
  destructiveTools?: DestructiveToolsMode
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
    destructiveTools: resolveDestructiveToolsMode(
      config.destructiveTools,
      process.env.CANVAS_DESTRUCTIVE_TOOLS,
    ),
  }
  registerAllTools(server, canvas, pseudonymizer, config.role, features)
  registerAllResources(server, canvas)

  return { server, canvas, pseudonymizer }
}
