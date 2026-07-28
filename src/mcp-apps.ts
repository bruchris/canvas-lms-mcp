/**
 * Vendored replacement for @modelcontextprotocol/ext-apps/server.
 *
 * We use exactly three symbols from ext-apps. The helpers are pure
 * pass-through wrappers verified wire-identical to ext-apps@1.7.5 over a
 * live client/server pair (see docs/superpowers/plans/2026-07-28-mcp-sdk-v2-migration.md §1.4).
 *
 * Stays on SDK v1 throughout Phase 0. Retype against @modelcontextprotocol/server in Phase 1.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'

const RESOURCE_URI_META_KEY = 'ui/resourceUri'

export function registerAppTool(
  server: Pick<McpServer, 'registerTool'>,
  name: string,
  config: { _meta?: Record<string, unknown>; [key: string]: unknown },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any,
): void {
  const meta: Record<string, unknown> = config._meta ?? {}
  const ui = meta.ui as { resourceUri?: string } | undefined
  const flat = meta[RESOURCE_URI_META_KEY] as string | undefined
  let out = meta
  if (ui?.resourceUri && !flat) {
    out = { ...meta, [RESOURCE_URI_META_KEY]: ui.resourceUri }
  } else if (flat && !ui?.resourceUri) {
    out = { ...meta, ui: { ...ui, resourceUri: flat } }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, { ...config, _meta: out } as any, handler)
}

export function registerAppResource(
  server: Pick<McpServer, 'registerResource'>,
  name: string,
  uri: string,
  config: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (...args: any[]) => any,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerResource(name, uri, { mimeType: RESOURCE_MIME_TYPE, ...config } as any, callback)
}
