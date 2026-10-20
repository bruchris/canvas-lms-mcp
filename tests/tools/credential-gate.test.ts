import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCanvasMCPServer } from '../../src/server'
import {
  MISSING_CREDENTIALS_TOOL_CALL_ERROR,
  canvasCredentialGate,
} from '../../src/auth/credential-gate'

/**
 * BRU-3043 / GH #442 — the credentialless tool-call gate's **handler** layer,
 * proven across the whole registered tool surface rather than a sample.
 *
 * This layer lives at the top of `buildHandler` in `src/tools/index.ts`, which
 * is where every registered tool handler comes from (both the `registerTool`
 * branch and the `registerAppTool` branch). That makes "covers every registered
 * tool" a structural property, and this file asserts the arrangement actually
 * holds — including for tools that look locally harmless and never touch
 * Canvas, which are exactly the ones a per-tool convention would miss.
 *
 * Scope, narrowed by BRU-3053: covering every registered *tool* is not the same
 * claim as covering every wire-level `tools/call` *request*. A request the MCP
 * SDK rejects before dispatch — no `params`, a non-string `name`, a non-object
 * `arguments` — never reaches this layer at all. The seam that answers those,
 * and the measurements behind it, are in
 * `tests/auth/credential-gate-wire.test.ts`. Nothing here is weakened by that:
 * this layer is still the only one covering an invocation that never goes over
 * the protocol, which is why both exist.
 */

const CONFIGURED = { token: 'test-token', baseUrl: 'https://canvas.example.com' }

/** Lowest tool count any supported server config can expose. */
const TOOL_COUNT_FLOOR = 150

type RegisteredTools = Record<
  string,
  { handler: (params: Record<string, unknown>) => Promise<unknown> }
>

function registeredTools(server: unknown): RegisteredTools {
  return (server as { _registeredTools: RegisteredTools })._registeredTools
}

function gatedServer() {
  return createCanvasMCPServer({
    token: '',
    baseUrl: '',
    sharedAcrossCallers: false,
    toolCallGate: canvasCredentialGate(),
  }).server
}

function configuredServer() {
  return createCanvasMCPServer({ ...CONFIGURED, sharedAcrossCallers: false }).server
}

describe('credentialless tool-call gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('the gate message carries every documented substring', () => {
    // The acceptance criteria name these literally: a directory listing, a
    // client error surface and the doctor workflow all read this string.
    it.each([
      ['Canvas API token required', 'Canvas API token required'],
      ['the --token flag', '--token'],
      ['the CANVAS_API_TOKEN variable', 'CANVAS_API_TOKEN'],
      ['the base URL flag', '--base-url'],
      ['the CANVAS_BASE_URL variable', 'CANVAS_BASE_URL'],
      ['the doctor hint', 'canvas-lms-mcp doctor'],
    ])('names %s', (_label, needle) => {
      expect(MISSING_CREDENTIALS_TOOL_CALL_ERROR).toContain(needle)
    })

    it('is a single line, so it survives any client that renders one', () => {
      expect(MISSING_CREDENTIALS_TOOL_CALL_ERROR).not.toContain('\n')
    })
  })

  describe('discovery surface', () => {
    it('exposes exactly the same tools as a configured server', () => {
      const gatedNames = Object.keys(registeredTools(gatedServer())).sort()
      const configuredNames = Object.keys(registeredTools(configuredServer())).sort()

      expect(gatedNames).toEqual(configuredNames)
      // Anti-vacuity: two empty registries would also be "equal".
      expect(gatedNames.length).toBeGreaterThan(TOOL_COUNT_FLOOR)
    })

    it('registers prompts and resources too', () => {
      const server = gatedServer() as unknown as {
        _registeredPrompts: Record<string, unknown>
        _registeredResources: Record<string, unknown>
      }

      expect(Object.keys(server._registeredPrompts).length).toBeGreaterThan(10)
      expect(Object.keys(server._registeredResources).length).toBeGreaterThan(0)
    })

    it('answers tools/list, prompts/list and resources/list over a real client', async () => {
      const client = new Client({ name: 'gate-test', version: '0.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([client.connect(clientTransport), gatedServer().connect(serverTransport)])

      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const tools = await client.listTools()
      const prompts = await client.listPrompts()
      const resources = await client.listResources()

      expect(tools.tools.length).toBeGreaterThan(TOOL_COUNT_FLOOR)
      expect(prompts.prompts.length).toBeGreaterThan(10)
      expect(resources.resources.length).toBeGreaterThan(0)
      // AC: discovery makes no Canvas request.
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('every registered tool is refused', () => {
    let names: string[]
    let results: { name: string; text: string; isError: boolean; structured: boolean }[]
    let fetchCalls: number

    beforeAll(async () => {
      const fetchSpy = vi.fn(() => {
        throw new Error('a gated tool reached the network')
      })
      vi.stubGlobal('fetch', fetchSpy)
      try {
        const tools = registeredTools(gatedServer())
        names = Object.keys(tools)
        results = []
        for (const name of names) {
          // `{}` is deliberate: the gate returns before input is read, so no
          // per-tool argument fixture is needed and none can mask a miss.
          const raw = (await tools[name].handler({})) as {
            content: { text: string }[]
            isError?: boolean
            structuredContent?: unknown
          }
          results.push({
            name,
            text: raw.content[0]?.text ?? '',
            isError: raw.isError === true,
            structured: raw.structuredContent !== undefined,
          })
        }
      } finally {
        fetchCalls = fetchSpy.mock.calls.length
        vi.unstubAllGlobals()
      }
    })

    it('covers the full surface, not a sample', () => {
      expect(names.length).toBeGreaterThan(TOOL_COUNT_FLOOR)
      expect(results).toHaveLength(names.length)
    })

    it('returns the credential error from every one of them', () => {
      const wrong = results.filter((r) => r.text !== MISSING_CREDENTIALS_TOOL_CALL_ERROR)
      expect(wrong.map((r) => `${r.name}: ${r.text.slice(0, 80)}`)).toEqual([])
    })

    it('marks every refusal isError, with no structured payload', () => {
      expect(results.filter((r) => !r.isError).map((r) => r.name)).toEqual([])
      expect(results.filter((r) => r.structured).map((r) => r.name)).toEqual([])
    })

    it('made no network request at all', () => {
      expect(fetchCalls).toBe(0)
    })
  })

  describe('control: the same sweep on an ungated server does reach the network', () => {
    // Without this the gated sweep proves little: a server broken for any
    // unrelated reason would also "refuse" every call. Here the only variable
    // is the gate.
    it('calls fetch for many tools and never returns the credential error', async () => {
      const fetchSpy = vi.fn(() => Promise.reject(new Error('probe: network blocked')))
      vi.stubGlobal('fetch', fetchSpy)
      // The tool boundary logs every non-CanvasApiError it catches, and this
      // sweep deliberately drives ~180 handlers into their error paths.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const tools = registeredTools(configuredServer())
      const texts: string[] = []
      for (const name of Object.keys(tools)) {
        const raw = (await tools[name].handler({})) as { content: { text: string }[] }
        texts.push(raw.content[0]?.text ?? '')
      }

      errorSpy.mockRestore()
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(50)
      expect(texts.filter((t) => t === MISSING_CREDENTIALS_TOOL_CALL_ERROR)).toEqual([])
    })
  })

  describe('through a real MCP client, with the output validator armed', () => {
    // `listTools()` first on purpose: that is what populates the client output
    // schema validator cache. `list_pages` declares a structured output
    // contract, so this is the shape that would fail if the gated error were
    // returned as a success result.
    it('list_pages returns the credential error, not a validation failure', async () => {
      const client = new Client({ name: 'gate-test', version: '0.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([client.connect(clientTransport), gatedServer().connect(serverTransport)])

      const listed = await client.listTools()
      expect(listed.tools.find((t) => t.name === 'list_pages')?.outputSchema).toBeDefined()

      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const result = (await client.callTool({
        name: 'list_pages',
        arguments: { course_id: '1' },
      })) as { content: { text: string }[]; isError?: boolean }

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe(MISSING_CREDENTIALS_TOOL_CALL_ERROR)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('a configured server is unchanged', () => {
    it('does not install a gate, so a tool call runs and hits Canvas', async () => {
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
      )
      vi.stubGlobal('fetch', fetchSpy)

      const tools = registeredTools(configuredServer())
      const raw = (await tools.list_pages.handler({ course_id: '1' })) as {
        content: { text: string }[]
        isError?: boolean
      }

      expect(raw.isError).toBeUndefined()
      expect(raw.content[0]?.text).not.toBe(MISSING_CREDENTIALS_TOOL_CALL_ERROR)
      expect(fetchSpy).toHaveBeenCalled()
    })
  })
})
