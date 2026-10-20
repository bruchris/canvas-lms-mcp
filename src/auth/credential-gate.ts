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
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js'

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

/** The refusal, in `CallToolResult` shape. */
// A `type`, not an `interface`: only a type alias gets the implicit index
// signature that makes it assignable to the SDK's `CallToolResult`, whose
// schema is loose and so carries `[x: string]: unknown`.
export type GatedToolCallResult = {
  content: { type: 'text'; text: string }[]
  isError: true
}

/**
 * The one refusal value. Both gate layers return *this*, so the message, the
 * `isError` flag and the absence of `structuredContent` cannot drift apart
 * between a well-formed call and a malformed one.
 *
 * `isError: true` rather than a JSON-RPC error: a tool-level error is what the
 * MCP spec reserves for "the tool ran and failed", it reaches the model as
 * readable text in every client, and it carries no structured payload that
 * could satisfy a tool's success schema.
 */
export function gatedToolCallResult(gate: ToolCallGate): GatedToolCallResult {
  return { content: [{ type: 'text', text: gate.message }], isError: true }
}

/**
 * The `tools/call` method name, taken from the SDK's own schema rather than
 * retyped, so a gate and a dispatcher can never name different methods.
 */
export const CALL_TOOL_METHOD: string = CallToolRequestSchema.shape.method.value

/**
 * Make **every** `tools/call` request answer with the gate refusal.
 *
 * This is the wire-level half of the gate. The other half is the early return
 * in `buildHandler` (`src/tools/index.ts`), which covers a tool invoked through
 * a path that never goes over the protocol — an embedder calling
 * `tool.handler` directly, or a server whose protocol object is a test double.
 * Neither layer shadows the other: this one answers requests that never reach a
 * registered handler, that one answers invocations that never reach dispatch.
 *
 * ## Why the registration path cannot be used
 *
 * A `tools/call` request is validated **twice** before any registered handler
 * runs, and both rejections happen inside the SDK:
 *
 * 1. `Protocol.setRequestHandler` wraps the handler in
 *    `requestSchema.safeParse(request)` and rethrows the `ZodError`, so with
 *    the SDK's `CallToolRequestSchema` a request with no `params`, a
 *    non-string `name` or a non-object `arguments` is answered with a raw Zod
 *    dump under JSON-RPC `-32603`.
 * 2. `Server.setRequestHandler` **overrides** that method and, for
 *    `tools/call` specifically, wraps *any* handler — whatever schema it was
 *    registered under — in an unconditional
 *    `safeParse(CallToolRequestSchema, request)` that throws
 *    `McpError(InvalidParams, 'Invalid tools/call request: …')`.
 *
 * Layer 2 means re-registering under a permissive schema does not work: it was
 * measured, and it only changed `-32603` to `-32602`. There is no option to
 * disable it (`ServerOptions` has no such flag), and the SDK exposes no way to
 * read a registered handler back.
 *
 * ## The seam used instead
 *
 * `Protocol._onrequest` resolves a handler as
 * `this._requestHandlers.get(method) ?? this.fallbackRequestHandler` and calls
 * the fallback with the **raw** request — no schema parse, and outside
 * `Server`'s `tools/call` wrapper, which only decorates handlers passed to
 * `setRequestHandler`. Both `removeRequestHandler` and
 * `fallbackRequestHandler` are public, documented API, so this patches
 * nothing and reaches into no private internals.
 *
 * Removing the entry rather than shadowing it is the stronger arrangement: the
 * dispatch table then holds *no* `tools/call` handler at all, so there is no
 * path from a request to a tool handler to a Canvas request. The cost is that
 * installing a fallback replaces `Protocol`'s built-in "Method not found"
 * branch for every other unhandled method, so this reproduces it exactly.
 *
 * This loosens no validation that protects anything: a gated server registers
 * no usable Canvas credential and can run no tool, so there is no execution
 * for argument validation to guard. A configured server is untouched — the
 * gate object does not exist in its config.
 *
 * ## Ordering
 *
 * Called from `registerAllTools` after the registration loop, because
 * `McpServer.setToolRequestHandlers` runs on the first `registerTool` and is
 * what installs the handler this removes. Its `_toolHandlersInitialized` latch
 * means later `registerTool` calls do not reinstall it, so an embedder may
 * still add tools afterwards without reopening the hole.
 */
export function installToolCallGateHandler(server: McpServer, gate: ToolCallGate): void {
  // Handler-capture test doubles pass a bare `{ registerTool }` cast to
  // `McpServer` and carry no protocol object; they never answer a request, so
  // `buildHandler`'s early return is the whole gate for them.
  const protocol: McpServer['server'] | undefined = server.server
  if (!protocol) return

  protocol.removeRequestHandler(CALL_TOOL_METHOD)
  protocol.fallbackRequestHandler = async (request): Promise<ServerResult> => {
    if (request.method === CALL_TOOL_METHOD) return gatedToolCallResult(gate)
    // Byte-for-byte the response from the branch in `Protocol._onrequest` that
    // installing a fallback at all has just displaced. Deliberately not an
    // `McpError`: its constructor rewrites `message` to
    // `MCP error -32601: Method not found`, which a client would see as a
    // changed string on a path this feature must not touch. `_onrequest`
    // reads only `error.code` and `error.message`.
    throw Object.assign(new Error('Method not found'), { code: ErrorCode.MethodNotFound })
  }
}
