import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { buildPromptDefinitions, buildPromptMeta, buildPromptText } from './catalog'
import type { GeneratedSkill, PromptDefinition } from './types'
import type { CanvasRole } from '../tools/types'

export { buildPromptDefinitions, PROMPT_META_KEY } from './catalog'
export type { GeneratedSkill, PromptDefinition } from './types'

/**
 * Registers the prompt surface directly on the underlying `Server` rather than
 * through `McpServer.registerPrompt`.
 *
 * The reason is concrete, and measured on SDK 1.32.0: `registerPrompt`'s config
 * accepts only `title`, `description` and `argsSchema`, and the SDK's
 * `prompts/list` handler emits no `_meta` per entry — so the namespaced skill
 * metadata this feature exists to publish has nowhere to live. It also silently
 * accepts an argument the prompt never declared, where this handler answers
 * `-32602`. Owning the handlers is what lets this server advertise arguments,
 * publish `_meta` on both `prompts/list` and `prompts/get`, and reject typos.
 * `tests/prompts/wire.test.ts` pins our behaviour;
 * `tests/prompts/sdk-registerprompt-characterisation.test.ts` pins the SDK's.
 *
 * Historical note: on SDK 1.30.0 `registerPrompt` additionally rejected a
 * `prompts/get` that omitted `arguments` — spec-legal, and what the SDK's own
 * client sends by default. That was the original justification; 1.32.0 fixed it,
 * and the characterisation test now guards against the regression.
 *
 * Must run before the server is connected: `registerCapabilities` throws once a
 * transport is attached, and `setRequestHandler` refuses a method whose
 * capability has not been declared — hence the ordering below.
 */
export function registerAllPrompts(
  server: McpServer,
  role?: CanvasRole,
  skills?: readonly GeneratedSkill[],
): void {
  const definitions = buildPromptDefinitions(role, skills)
  // No prompts means no `prompts` capability at all, so capability negotiation
  // stays honest rather than advertising an empty surface.
  if (definitions.length === 0) return

  const byName = new Map<string, PromptDefinition>(
    definitions.map((definition) => [definition.name, definition]),
  )

  server.server.registerCapabilities({ prompts: { listChanged: false } })

  server.server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: definitions.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      arguments: definition.arguments,
      _meta: buildPromptMeta(definition),
    })),
  }))

  server.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const definition = byName.get(request.params.name)
    if (!definition) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`)
    }

    const supplied = request.params.arguments ?? {}
    const declared = new Set(definition.arguments.map((argument) => argument.name))
    const unknown = Object.keys(supplied).filter((name) => !declared.has(name))
    if (unknown.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown argument(s) for prompt ${definition.name}: ${unknown.join(', ')}`,
      )
    }

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
  })
}
