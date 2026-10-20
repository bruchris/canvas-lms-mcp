// Credentialless discovery (GH #442, BRU-3043).
//
// MCP directories such as mcp.so launch a package with no environment at all
// and read its `tools/list` to build a listing. Until this module existed the
// stdio entry point exited inside `parseArgs()` before MCP initialization, so
// those directories reported "No tools detected" and the only server that
// scored was one whose build config injected placeholder Canvas credentials.
//
// The answer is to separate *discovery* from *authority*: start, advertise the
// full default surface, and refuse every tool call with one actionable message.
// Nothing here loosens authentication — a gated server holds no usable Canvas
// credential, so there is nothing for it to authorize.

/** Shared by the fatal startup errors and the gated tool-call error. */
export const DOCTOR_HINT = 'Run `canvas-lms-mcp doctor` to check your setup.'

/**
 * The error text every tool call returns while the gate is installed.
 *
 * Stable on purpose: a directory, a client and an acceptance test all read it.
 * It names the token first (so it matches the fatal startup error a configured
 * deployer sees), both configuration surfaces for each credential, and the
 * doctor hint.
 */
export const MISSING_CREDENTIALS_TOOL_CALL_ERROR =
  'Canvas API token required. This server started without Canvas credentials, so Canvas tool ' +
  'calls are unavailable. Set --token or CANVAS_API_TOKEN and --base-url or CANVAS_BASE_URL, ' +
  `then restart the server. ${DOCTOR_HINT}`

/**
 * The single startup notice. One line, stderr only: stdout is the MCP protocol
 * channel on the stdio transport, and one stray byte there breaks the session
 * for every client.
 */
export const CREDENTIALLESS_STDIO_WARNING =
  'Warning: Canvas credentials are absent (CANVAS_API_TOKEN / CANVAS_BASE_URL are unset). ' +
  'canvas-lms-mcp started in discovery-only mode: tools, prompts and resources are listed, but ' +
  `every tool call returns a credential error. ${DOCTOR_HINT}`

/**
 * Installed on a server whose tool calls must all be refused before they run.
 *
 * A value rather than a boolean flag so the refusal message travels with the
 * decision: the tool layer never has to know *why* it is gated, and there is no
 * second place where the message could drift. Absent = no gate, which is every
 * configured deployment byte-for-byte.
 */
export interface ToolCallGate {
  readonly message: string
}

/** The gate for a server started with no Canvas credentials. */
export function canvasCredentialGate(): ToolCallGate {
  return { message: MISSING_CREDENTIALS_TOOL_CALL_ERROR }
}
