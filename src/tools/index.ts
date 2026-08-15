import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppTool } from '../mcp-apps'
import type { CanvasClient } from '../canvas'
import { CanvasApiError } from '../canvas/client'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import {
  UNTRUSTED_CONTENT_META_NOTE,
  applyFencing,
  findMarkerBearingParam,
} from '../provenance/apply'
import { isProvenanceFencingEnabled, markerRejectionMessage } from '../provenance/markers'
import type { CanvasRole, ToolDefinition, ToolFeatureFlags } from './types'
import { toolDomainCatalog } from './catalog'
import { formatError } from './errors'
import { pseudonymTools } from './pseudonym'
import { isVisibleForRole, tagAudience } from './roles'
import { tagTitle } from './titles'

const PSEUDONYM_META_NOTE =
  'Student names and contact info in this response have been replaced with stable pseudonyms (CANVAS_PSEUDONYMIZE_STUDENTS=true). Real names are not available to this tool.'

/**
 * Build the tool set. Every returned tool carries a resolved `audience` (its own
 * or its domain default). When `role` is set, the set is filtered to the
 * audiences that role can see; when unset, every tool is returned (the default,
 * backwards-compatible behaviour). Domains with a `gate` are excluded unless the
 * corresponding flag is enabled in `features`.
 */
export function getAllTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
  role?: CanvasRole,
  features?: ToolFeatureFlags,
): ToolDefinition[] {
  const domainTools = toolDomainCatalog
    .filter((registration) => !registration.gate || features?.[registration.gate])
    .flatMap((registration) =>
      registration
        .getTools(canvas, pseudonymizer)
        .map(tagAudience(registration.defaultPrimaryAudience)),
    )
  const conditional = pseudonymizer ? pseudonymTools(pseudonymizer) : []
  const all = [...domainTools, ...conditional].map(tagTitle())
  if (!role) return all
  return all.filter((tool) => isVisibleForRole(tool, role))
}

type ToolResponse = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
  _meta?: Record<string, unknown>
}

function buildHandler(
  tool: ToolDefinition,
  pseudonymizer: Pseudonymizer | undefined,
): (params: Record<string, unknown>, extra?: unknown) => Promise<ToolResponse> {
  return async (params) => {
    try {
      // Provenance fencing (BRU-2104 §4). This is the single output boundary:
      // every one of the registered tools is wrapped here, so the fence is a
      // property of the server rather than a per-tool convention. It is also
      // downstream of every write path — write tools take their content from
      // `params`, and no tool consumes another tool's output — so a fenced value
      // cannot round-trip into Canvas from inside the server.
      const fencingEnabled = isProvenanceFencingEnabled()

      // §6: reject marker-bearing input on every destructive tool, generically,
      // so a new write tool is covered the day it lands. Rejected before the
      // handler runs, so nothing reaches Canvas.
      if (fencingEnabled && tool.annotations.destructiveHint === true) {
        const offendingParam = findMarkerBearingParam(params)
        if (offendingParam !== undefined) {
          return {
            content: [{ type: 'text' as const, text: markerRejectionMessage(offendingParam) }],
            isError: true,
          }
        }
      }

      const result = await tool.handler(params)
      const { value, fencedFields } = fencingEnabled
        ? applyFencing(tool.name, result)
        : { value: result, fencedFields: [] as string[] }
      const text =
        value === undefined ? 'Operation completed successfully.' : JSON.stringify(value, null, 2)
      const response: ToolResponse = {
        content: [{ type: 'text' as const, text }],
      }
      if (pseudonymizer?.isEnabled()) {
        response._meta = { pseudonymized: true, note: PSEUDONYM_META_NOTE }
      }
      if (fencedFields.length > 0) {
        response._meta = {
          ...response._meta,
          untrusted_content: { fields: fencedFields, note: UNTRUSTED_CONTENT_META_NOTE },
        }
      }
      return response
    } catch (error) {
      if (!(error instanceof CanvasApiError)) {
        console.error(`Unexpected error in tool "${tool.name}":`, error)
      }
      return {
        content: [{ type: 'text' as const, text: formatError(error) }],
        isError: true,
      }
    }
  }
}

export function registerAllTools(
  server: McpServer,
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
  role?: CanvasRole,
  features?: ToolFeatureFlags,
): void {
  const tools = getAllTools(canvas, pseudonymizer, role, features)
  for (const tool of tools) {
    const handler = buildHandler(tool, pseudonymizer)
    if (tool.ui) {
      registerAppTool(
        server,
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          _meta: { ui: { resourceUri: tool.ui.resourceUri } },
        },
        handler,
      )
    } else {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        handler,
      )
    }
  }
}
export { formatError } from './errors'
