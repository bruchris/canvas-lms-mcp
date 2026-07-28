import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasApiError } from '../../src/canvas/client'
import { registerAllTools } from '../../src/tools'
import type { CanvasClient } from '../../src/canvas'
import type { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

// Hoisted mocks — must be defined before vi.mock factories evaluate
const { mockToolHandler, mockUiToolHandler, registerAppToolSpy } = vi.hoisted(() => ({
  mockToolHandler: vi.fn(),
  mockUiToolHandler: vi.fn(),
  registerAppToolSpy: vi.fn(),
}))

vi.mock('../../src/mcp-apps', () => ({
  registerAppTool: registerAppToolSpy,
}))

// Replace the full domain catalog with two controlled fake tools:
//   - test_plain_tool  (no .ui — goes through server.tool)
//   - test_ui_tool     (.ui set — goes through registerAppTool)
vi.mock('../../src/tools/catalog', () => ({
  toolDomainCatalog: [
    {
      domain: 'test',
      defaultPrimaryAudience: 'shared',
      getTools: () => [
        {
          name: 'test_plain_tool',
          description: 'Plain test tool without UI',
          inputSchema: {},
          annotations: { readOnlyHint: true, openWorldHint: true },
          handler: mockToolHandler,
        },
        {
          name: 'test_ui_tool',
          description: 'UI test tool',
          inputSchema: {},
          annotations: { readOnlyHint: true, openWorldHint: true },
          handler: mockUiToolHandler,
          ui: { resourceUri: 'ui://test/tool.html' },
        },
      ],
    },
  ],
}))

const PSEUDONYM_META_NOTE =
  'Student names and contact info in this response have been replaced with stable pseudonyms (CANVAS_PSEUDONYMIZE_STUDENTS=true). Real names are not available to this tool.'

function buildMockServer() {
  return { tool: vi.fn() } as unknown as McpServer
}

function buildMockCanvas(): CanvasClient {
  return {} as unknown as CanvasClient
}

function buildMockPseudonymizer(enabled: boolean): Pseudonymizer {
  return {
    isEnabled: () => enabled,
    isReverseLookupEnabled: () => false,
  } as unknown as Pseudonymizer
}

/**
 * Calls registerAllTools on a fresh mock server and returns the handler
 * captured by server.tool for the given tool name.
 */
function captureServerToolHandler(
  toolName: string,
  pseudonymizer?: Pseudonymizer,
): (params: Record<string, unknown>) => Promise<unknown> {
  const server = buildMockServer()
  registerAllTools(server, buildMockCanvas(), pseudonymizer)
  const calls = (server.tool as ReturnType<typeof vi.fn>).mock.calls
  const call = calls.find((c) => c[0] === toolName)
  if (!call) throw new Error(`"${toolName}" was not registered via server.tool`)
  return call[4]
}

describe('buildHandler — success path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps a resolved result in the MCP content envelope', async () => {
    const result = { status: 'ok', data: [1, 2, 3] }
    mockToolHandler.mockResolvedValue(result)
    const handler = captureServerToolHandler('test_plain_tool')
    const response = await handler({})
    expect(response).toEqual({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    })
  })

  it('returns "Operation completed successfully." when handler resolves undefined', async () => {
    mockToolHandler.mockResolvedValue(undefined)
    const handler = captureServerToolHandler('test_plain_tool')
    const response = await handler({})
    expect(response).toEqual({
      content: [{ type: 'text', text: 'Operation completed successfully.' }],
    })
  })
})

describe('buildHandler — error path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats a CanvasApiError and does NOT call console.error', async () => {
    const error = new CanvasApiError('Unauthorized', 401, '/api/v1/users')
    mockToolHandler.mockRejectedValue(error)
    const handler = captureServerToolHandler('test_plain_tool')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handler({})
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(response).toEqual({
      content: [{ type: 'text', text: 'Canvas token is invalid or expired' }],
      isError: true,
    })
    consoleSpy.mockRestore()
  })

  it('calls console.error for a non-CanvasApiError and still returns isError: true', async () => {
    const error = new Error('Something went wrong internally')
    mockToolHandler.mockRejectedValue(error)
    const handler = captureServerToolHandler('test_plain_tool')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handler({})
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test_plain_tool'), error)
    expect(response).toEqual({
      content: [{ type: 'text', text: 'Something went wrong internally' }],
      isError: true,
    })
    consoleSpy.mockRestore()
  })
})

describe('buildHandler — pseudonymizer _meta tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds _meta when pseudonymizer.isEnabled() is true', async () => {
    const result = { items: [] }
    mockToolHandler.mockResolvedValue(result)
    const handler = captureServerToolHandler('test_plain_tool', buildMockPseudonymizer(true))
    const response = await handler({})
    expect(response).toEqual({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      _meta: { pseudonymized: true, note: PSEUDONYM_META_NOTE },
    })
  })

  it('omits _meta when pseudonymizer.isEnabled() is false', async () => {
    mockToolHandler.mockResolvedValue({ items: [] })
    const handler = captureServerToolHandler('test_plain_tool', buildMockPseudonymizer(false))
    const response = await handler({})
    expect(response).not.toHaveProperty('_meta')
  })

  it('omits _meta when no pseudonymizer is provided', async () => {
    mockToolHandler.mockResolvedValue({ items: [] })
    const handler = captureServerToolHandler('test_plain_tool')
    const response = await handler({})
    expect(response).not.toHaveProperty('_meta')
  })
})

describe('registerAllTools — dispatch to server.tool vs registerAppTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls server.tool for a tool without .ui', () => {
    const server = buildMockServer()
    registerAllTools(server, buildMockCanvas())
    const registeredNames = (server.tool as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(registeredNames).toContain('test_plain_tool')
  })

  it('does NOT call server.tool for a tool with .ui', () => {
    const server = buildMockServer()
    registerAllTools(server, buildMockCanvas())
    const registeredNames = (server.tool as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(registeredNames).not.toContain('test_ui_tool')
  })

  it('calls registerAppTool for a tool with .ui, passing the resourceUri in _meta', () => {
    const server = buildMockServer()
    registerAllTools(server, buildMockCanvas())
    expect(registerAppToolSpy).toHaveBeenCalledWith(
      server,
      'test_ui_tool',
      expect.objectContaining({
        _meta: { ui: { resourceUri: 'ui://test/tool.html' } },
      }),
      expect.any(Function),
    )
  })

  it('does NOT call registerAppTool for a tool without .ui', () => {
    const server = buildMockServer()
    registerAllTools(server, buildMockCanvas())
    const appToolNames = registerAppToolSpy.mock.calls.map((c) => c[1])
    expect(appToolNames).not.toContain('test_plain_tool')
  })
})
