import { version } from '../package.json'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient } from './canvas'
import { Pseudonymizer } from './pseudonym/pseudonymizer'
import { isEnvTruthy } from './env'
import { registerAllTools } from './tools'
import type { CanvasRole, ToolFeatureFlags } from './tools/types'
import { resolveDestructiveToolsMode, type DestructiveToolsMode } from './tools/destructive-policy'
import { registerAllResources } from './resources'

// Public pseudonym surface. `createSharedPseudonymizer` is exported as a value
// because it is the supported safe construction for a shared deployment; the
// class itself is exported as a **type only**, so the one public way to obtain
// an instance other than `createCanvasMCPServer` is the safe one (BRU-2515).
export { createSharedPseudonymizer } from './pseudonym/pseudonymizer'
export type {
  Pseudonymizer,
  PseudonymizationStatus,
  ReverseLookupResult,
  SharedPseudonymizerConfig,
} from './pseudonym/pseudonymizer'

export interface CanvasMCPServerConfig {
  token: string
  baseUrl: string
  /**
   * Optional pseudonymizer instance. Passed through to the tool layer so the
   * `_meta.pseudonymized` envelope and the `resolve_pseudonym` tool registration
   * are driven by it.
   *
   * Supply one when several servers in the same process must share one map —
   * a custom transport that builds a fresh server per request, for example.
   * Build it with `createSharedPseudonymizer({ baseUrl })`, which is the only
   * public construction and is shared-by-construction. When omitted, the
   * factory builds one from {@link sharedAcrossCallers}.
   */
  pseudonymizer?: Pseudonymizer
  /**
   * Whether one process serves callers that authenticate with **different**
   * Canvas credentials. A statement of fact about the deployment, decided by
   * the server operator — never derived from a request header, a role, an
   * audience, or any other caller-supplied metadata.
   *
   * - `true` — a hosted service, a multi-tenant gateway, or any custom
   *   transport reusing one process across users. Reverse lookup is disabled,
   *   so `resolve_pseudonym` is not registered.
   * - `false` — one process, one user, one token (stdio). Reverse lookup
   *   follows `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP` as before.
   * - omitted — undeclared. Treated as unknown, which cannot be treated as
   *   private: the pseudonymizer this factory builds is marked shared, and if
   *   the environment actually asks for reverse lookup the factory **throws**
   *   rather than guess. See {@link createCanvasMCPServer}.
   */
  sharedAcrossCallers?: boolean
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

/**
 * True when the environment asks for `resolve_pseudonym`. Read from
 * `process.env` here, as `destructiveTools` already is, so a library embedder
 * that never goes through `parseArgs` still sees the deployer's intent.
 */
function reverseLookupRequestedFromEnv(): boolean {
  return (
    isEnvTruthy(process.env.CANVAS_PSEUDONYMIZE_STUDENTS) &&
    isEnvTruthy(process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP)
  )
}

/**
 * Resolve the pseudonymizer for one server, refusing every arrangement in
 * which `resolve_pseudonym` could read a map that a *different* caller seeded.
 */
function resolvePseudonymizer(config: CanvasMCPServerConfig): Pseudonymizer {
  if (config.pseudonymizer) {
    // A caller-supplied instance carries its own answer. Honour it, but never
    // let the two disagree in the dangerous direction: a shared declaration
    // with a private instance is the exact BRU-2511 arrangement.
    if (config.sharedAcrossCallers === true && !config.pseudonymizer.sharedAcrossCallers) {
      throw new Error(
        'createCanvasMCPServer: sharedAcrossCallers is true but the supplied pseudonymizer was ' +
          'not built for shared use, so reverse lookup would stay enabled on a map that every ' +
          'caller reads and writes. Build it with createSharedPseudonymizer({ baseUrl }).',
      )
    }
    return config.pseudonymizer
  }

  if (config.sharedAcrossCallers === undefined && reverseLookupRequestedFromEnv()) {
    throw new Error(
      'createCanvasMCPServer: CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP is enabled but this server did ' +
        'not declare whether it is shared across callers. resolve_pseudonym performs no ' +
        'Canvas-side authorization, so on a shared transport it resolves pseudonyms from a map ' +
        'another caller seeded. Set sharedAcrossCallers: true when one process serves callers ' +
        'with different Canvas credentials, or sharedAcrossCallers: false when one process ' +
        'serves exactly one caller identity (stdio).',
    )
  }

  return new Pseudonymizer({
    baseUrl: config.baseUrl,
    // Undeclared means unknown, and unknown must not be treated as private.
    // The guard above has already proved reverse lookup cannot be on in that
    // case; marking the instance shared is what keeps it safe if the embedder
    // passes it back into a later `createCanvasMCPServer` call.
    sharedAcrossCallers: config.sharedAcrossCallers ?? true,
  })
}

export function createCanvasMCPServer(config: CanvasMCPServerConfig): CanvasMCPServer {
  const canvas = new CanvasClient({
    token: config.token,
    baseUrl: config.baseUrl,
  })

  const pseudonymizer = resolvePseudonymizer(config)

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
