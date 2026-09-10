/**
 * JSON Schema dialect compatibility for `tools/list` (GitHub issue #341).
 *
 * `@modelcontextprotocol/sdk@1.30.0` converts every registered Zod schema with
 * an unconditional `target: 'draft-7'` (`server/zod-json-schema-compat.js`:
 * `mapMiniTarget(undefined) === 'draft-7'`) and `registerTool` exposes no way
 * to ask for another dialect. Clients whose validator supports JSON Schema
 * 2020-12 *only* — Claude Desktop among them — therefore reject any tool that
 * advertises an `outputSchema`, before the request reaches Canvas:
 *
 *     Tool 'get_page' has an invalid outputSchema: JSON Schema declares an
 *     unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
 *
 * The remedy here is a dialect rewrite rather than a withdrawal of the output
 * contracts, and that is safe because it is *provably* a no-op on the body:
 * `tests/tools/tool-schema-shape.test.ts` asks the SDK's own converter for
 * both dialects and requires the two bodies to be byte-identical for every
 * registered schema, with a tuple schema as the control showing the two
 * targets can genuinely differ. So what goes on the wire is exactly what the
 * SDK would have emitted had `registerTool` accepted a `target` option.
 *
 * This is a v1 compatibility shim. SDK v2 emits 2020-12 natively, at which
 * point the interception below becomes dead weight — see BRU-1925.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

/** The JSON Schema dialect every advertised tool schema declares. */
export const JSON_SCHEMA_DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

/**
 * A copy of `schema` declaring the 2020-12 dialect. Copies rather than
 * mutates: the SDK hands out schema objects it also keeps, and one of them
 * (`EMPTY_OBJECT_JSON_SCHEMA`) is a module-level constant shared by every
 * zero-argument tool.
 */
function withDialect<T extends object>(schema: T): T {
  return { ...schema, $schema: JSON_SCHEMA_DIALECT_2020_12 }
}

/**
 * Re-declare the dialect on every schema in a `tools/list` result. Only the
 * root `$schema` of each schema is touched — the converter emits no nested
 * dialect declarations, which `tool-schema-shape.test.ts` pins separately.
 */
export function applyToolSchemaDialect(result: ListToolsResult): ListToolsResult {
  return {
    ...result,
    tools: result.tools.map((tool) => ({
      ...tool,
      inputSchema: withDialect(tool.inputSchema),
      ...(tool.outputSchema ? { outputSchema: withDialect(tool.outputSchema) } : {}),
    })),
  }
}

type RequestHandlerFn = (request: unknown, extra: unknown) => unknown
type SetRequestHandlerFn = (requestSchema: unknown, handler: RequestHandlerFn) => void

/** Servers already patched, so a second `registerAllTools` call is a no-op. */
const patchedProtocols = new WeakSet<object>()

/**
 * Make `server` advertise 2020-12 on every tool schema.
 *
 * `McpServer` installs its `tools/list` handler lazily, on the first
 * `registerTool` call, and gives no way to read a handler back once installed
 * — so the only seam is to wrap `setRequestHandler` before any tool is
 * registered and decorate the handler as it goes past. **Call this before
 * registering the first tool**; afterwards it silently does nothing, which is
 * exactly the regression `tool-schema-shape.test.ts` fails on.
 */
export function installSchemaDialectCompat(server: McpServer): void {
  // Handler-capture test doubles pass a bare `{ registerTool }` cast to
  // `McpServer`; they carry no protocol object and never answer `tools/list`.
  // Every real server has one, and the wire-level assertions in
  // `tool-schema-shape.test.ts` fail if this ever no-ops on a real server.
  const protocol: McpServer['server'] | undefined = server.server
  if (!protocol) return
  if (patchedProtocols.has(protocol)) return
  patchedProtocols.add(protocol)

  const original = protocol.setRequestHandler.bind(protocol) as unknown as SetRequestHandlerFn
  const patched: SetRequestHandlerFn = (requestSchema, handler) => {
    if (requestSchema !== ListToolsRequestSchema) {
      original(requestSchema, handler)
      return
    }
    original(requestSchema, async (request, extra) =>
      applyToolSchemaDialect((await handler(request, extra)) as ListToolsResult),
    )
  }
  ;(protocol as unknown as { setRequestHandler: SetRequestHandlerFn }).setRequestHandler = patched
}
