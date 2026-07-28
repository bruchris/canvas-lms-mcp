/**
 * Characterisation test — pins the exact wire format produced by
 * registerAppTool and registerAppResource.
 *
 * Written against real @modelcontextprotocol/ext-apps before the shim swap;
 * must stay green unchanged after src/mcp-apps.ts replaces it.
 *
 * Invariants pinned here:
 *   - registerAppTool stamps BOTH _meta.ui.resourceUri AND _meta['ui/resourceUri']
 *     on every UI-bound tool, with byte-identical values.
 *   - registerAppResource passes mimeType 'text/html;profile=mcp-app' to
 *     server.registerResource.
 */
import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools } from '../src/tools'
import { registerCourseStructureUI } from '../src/resources/ui-course-structure'
import type { CanvasClient } from '../src/canvas'

const WIRE_TEST_URI = 'ui://canvas-lms-mcp/wire-test.html'

vi.mock('../src/tools/catalog', () => ({
  toolDomainCatalog: [
    {
      domain: 'wire-test',
      defaultPrimaryAudience: 'shared',
      getTools: () => [
        {
          name: 'wire_test_ui_tool',
          description: 'Wire characterisation tool',
          inputSchema: {},
          annotations: { readOnlyHint: true as const, openWorldHint: true as const },
          handler: async () => undefined,
          ui: { resourceUri: WIRE_TEST_URI },
        },
      ],
    },
  ],
}))

describe('registerAppTool _meta wire characterisation', () => {
  it('stamps both nested ui.resourceUri and flat ui/resourceUri — byte-identical', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const spy = vi.spyOn(server, 'registerTool')
    registerAllTools(server, {} as CanvasClient)

    const call = spy.mock.calls.find((c) => c[0] === 'wire_test_ui_tool')
    expect(call).toBeDefined()
    const config = call![1] as Record<string, unknown>
    const meta = config._meta as Record<string, unknown>

    // Both the nested and flat forms must coexist
    const nested = (meta.ui as { resourceUri: string }).resourceUri
    const flat = meta['ui/resourceUri'] as string

    expect(nested).toBe(WIRE_TEST_URI)
    expect(flat).toBe(WIRE_TEST_URI)
    // They must be byte-identical (the invariant that makes the swap safe)
    expect(flat).toBe(nested)
  })
})

describe('registerAppResource mime-type wire characterisation', () => {
  it('passes the exact string text/html;profile=mcp-app as mimeType to server.registerResource', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const spy = vi.spyOn(server, 'registerResource')
    registerCourseStructureUI(server)

    expect(spy).toHaveBeenCalled()
    // registerResource(name, uri, config, callback) — config is arg index 2
    const config = spy.mock.calls[0][2] as Record<string, unknown>
    expect(config.mimeType).toBe('text/html;profile=mcp-app')
  })
})
