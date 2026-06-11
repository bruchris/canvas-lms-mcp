import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { registerCourseStructureUI } from '../../src/resources/ui-course-structure'

const RESOURCE_URI = 'ui://canvas-lms-mcp/course-structure.html'

describe('registerCourseStructureUI', () => {
  function captureHandler() {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    const spy = vi.spyOn(server, 'registerResource')
    registerCourseStructureUI(server)
    const call = spy.mock.calls[0]
    // server.registerResource(name, uri, config, callback) — callback is last
    return call[call.length - 1] as (
      uri: URL,
      extra: Record<string, unknown>,
    ) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>
  }

  it('registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    expect(() => registerCourseStructureUI(server)).not.toThrow()
  })

  it('returns content with the MCP Apps mime type', async () => {
    const handler = captureHandler()
    const result = await handler(new URL(RESOURCE_URI), {})
    expect(result.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE)
  })

  it('returns HTML content at the expected URI', async () => {
    const handler = captureHandler()
    const result = await handler(new URL(RESOURCE_URI), {})
    expect(result.contents[0].uri).toBe(RESOURCE_URI)
    expect(result.contents[0].text).toMatch(/<!doctype html>/i)
  })

  it('preserves the multi-sink data injection probe', async () => {
    const handler = captureHandler()
    const result = await handler(new URL(RESOURCE_URI), {})
    const html = result.contents[0].text
    // The widget must probe window.openai.toolResult first, then a fallback sink.
    expect(html).toContain('window.openai')
    expect(html).toContain('window.__MCP_TOOL_RESULT__')
  })

  it('renders module and item chrome that the payload will populate', async () => {
    const handler = captureHandler()
    const result = await handler(new URL(RESOURCE_URI), {})
    const html = result.contents[0].text
    // Sanity check the widget surfaces the expected UI affordances.
    expect(html).toContain('modules')
    expect(html).toContain('items')
  })
})
