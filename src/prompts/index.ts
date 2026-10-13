import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  GetPromptRequest,
  GetPromptResult,
  ListPromptsRequest,
  ListPromptsResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { buildPromptDefinitions, buildPromptMeta, buildPromptText } from './catalog'
import type { GeneratedSkill, PromptDefinition } from './types'
import type { CanvasRole } from '../tools/types'

export { buildPromptDefinitions, PROMPT_META_KEY } from './catalog'
export type { GeneratedSkill, PromptDefinition } from './types'

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** The two handlers `McpServer` installs for its own prompt registry. */
interface SdkPromptHandlers {
  list: (
    request: ListPromptsRequest,
    extra: Extra,
  ) => ListPromptsResult | Promise<ListPromptsResult>
  get: (request: GetPromptRequest, extra: Extra) => GetPromptResult | Promise<GetPromptResult>
}

/**
 * Renders one skill. Shared by the composed `prompts/get` handler and by the
 * callback left in the SDK registry, so the two cannot answer differently.
 *
 * Note that rejecting an undeclared argument is deliberately *not* here: the
 * SDK parses `arguments` against the declared shape before a callback ever runs,
 * which strips unknown keys, so the only place that check can observe them is
 * the composed handler below.
 */
function renderPrompt(
  definition: PromptDefinition,
  supplied: Readonly<Record<string, string>>,
): GetPromptResult {
  return {
    description: definition.description,
    _meta: buildPromptMeta(definition),
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: buildPromptText(definition, supplied) },
      },
    ],
  }
}

/** One listing entry, shaped by us so the SDK's own derivation cannot drift it. */
function listingEntry(definition: PromptDefinition) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    arguments: definition.arguments,
    _meta: buildPromptMeta(definition),
  }
}

/** Every declared argument is an optional string on the wire. */
function argsShape(definition: PromptDefinition): Record<string, z.ZodOptional<z.ZodString>> {
  return Object.fromEntries(
    definition.arguments.map((argument) => [
      argument.name,
      z.string().optional().describe(argument.description),
    ]),
  )
}

function stringArgs(supplied: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(supplied)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, value]) => [name, value as string]),
  )
}

/**
 * Registers every built-in through the public `McpServer.registerPrompt`, and
 * returns the handlers the SDK installs while doing so.
 *
 * `McpServer` keeps its prompt registry and its `_promptHandlersInitialized`
 * flag private, so there is no public way to read either back. What *is* public
 * is `Server.setRequestHandler` — the method the SDK calls to install those
 * handlers. Wrapping it for the duration of the registration loop records the
 * two handlers on their way in and forwards every call unchanged, so the SDK's
 * own capability assertions still run and nothing is suppressed.
 *
 * Capturing them is what lets the composed handlers below delegate: the SDK's
 * `prompts/list` closes over the live registry, so calling it is how a prompt
 * registered *later* reaches the wire.
 */
function registerThroughSdk(
  server: McpServer,
  definitions: readonly PromptDefinition[],
): SdkPromptHandlers {
  const inner = server.server
  const install = inner.setRequestHandler.bind(inner)
  let list: SdkPromptHandlers['list'] | undefined
  let get: SdkPromptHandlers['get'] | undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observe = (schema: any, handler: any): void => {
    if (schema === ListPromptsRequestSchema) list = handler as SdkPromptHandlers['list']
    if (schema === GetPromptRequestSchema) get = handler as SdkPromptHandlers['get']
    install(schema, handler)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(inner as any).setRequestHandler = observe
  try {
    for (const definition of definitions) {
      server.registerPrompt(
        definition.name,
        {
          title: definition.title,
          description: definition.description,
          argsSchema: argsShape(definition),
        },
        (args: Record<string, unknown>) => renderPrompt(definition, stringArgs(args)),
      )
    }
  } finally {
    // Restore the prototype method rather than leaving a bound own-property.
    Reflect.deleteProperty(inner as object, 'setRequestHandler')
  }

  if (!list || !get) {
    throw new Error(
      'registerAllPrompts must run before any McpServer.registerPrompt call on this server: ' +
        'the SDK installs its prompt handlers once, and they have to be captured as that happens ' +
        'for a later registerPrompt to reach prompts/list.',
    )
  }
  return { list, get }
}

/**
 * Registers the 16 Agent Skills as MCP prompts, composed with the SDK's own
 * prompt registry so an in-process embedder can still call
 * `McpServer.registerPrompt()` afterwards.
 *
 * The built-ins go in through `registerPrompt`, which makes the SDK's registry
 * the single source of truth for which prompt names exist — so a custom prompt
 * cannot silently shadow a Canvas one — and leaves the SDK's own handlers
 * installed and its `prompts` capability declared. The two handlers are then
 * replaced by composing ones that delegate to the captured originals.
 *
 * Owning the handlers is still necessary, and the reasons are measured on SDK
 * 1.32.0 rather than assumed: `registerPrompt`'s config accepts only `title`,
 * `description` and `argsSchema`, and the SDK's `prompts/list` emits no `_meta`
 * per entry — so the namespaced skill metadata this feature exists to publish
 * has nowhere to live. It also silently accepts an argument the prompt never
 * declared, where this server answers `-32602`. Custom prompts keep the SDK's
 * behaviour for both, which is correct: their metadata and their argument
 * schema are the embedder's to define.
 *
 * `tests/prompts/wire.test.ts` pins our behaviour on a Canvas-only server,
 * `tests/prompts/composition.test.ts` pins it on a composed one, and
 * `tests/prompts/sdk-registerprompt-characterisation.test.ts` pins the SDK's.
 *
 * Must run before the server is connected — `registerPrompt` declares the
 * `prompts` capability on the first call, and `registerCapabilities` throws once
 * a transport is attached — and before any other `registerPrompt` call, which
 * the error in `registerThroughSdk` enforces.
 */
export function registerAllPrompts(
  server: McpServer,
  role?: CanvasRole,
  skills?: readonly GeneratedSkill[],
): void {
  const definitions = buildPromptDefinitions(role, skills)
  // No prompts means no `prompts` capability at all, so capability negotiation
  // stays honest rather than advertising an empty surface. It also leaves the
  // surface untouched for an embedder that wants to own it outright.
  if (definitions.length === 0) return

  const byName = new Map<string, PromptDefinition>(
    definitions.map((definition) => [definition.name, definition]),
  )
  const sdk = registerThroughSdk(server, definitions)

  server.server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) => {
    // Our entries are built here rather than decorated from the SDK's output, so
    // their shape and order stay ours; everything else is whatever the embedder
    // registered, passed through untouched.
    const registered = await sdk.list(request, extra)
    return {
      ...registered,
      prompts: [
        ...definitions.map(listingEntry),
        ...registered.prompts.filter((prompt) => !byName.has(prompt.name)),
      ],
    }
  })

  server.server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
    const definition = byName.get(request.params.name)
    // Not ours — including a name nobody registered, which the SDK reports as
    // `-32602 ... not found`, the same answer this handler used to give.
    if (!definition) return sdk.get(request, extra)

    const supplied = request.params.arguments ?? {}
    const declared = new Set(definition.arguments.map((argument) => argument.name))
    const unknown = Object.keys(supplied).filter((name) => !declared.has(name))
    if (unknown.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown argument(s) for prompt ${definition.name}: ${unknown.join(', ')}`,
      )
    }

    return renderPrompt(definition, stringArgs(supplied))
  })
}
