import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CanvasToolset } from '../src/tools/toolsets'

// Same mock harness as tests/http.test.ts: the handler is exercised directly,
// with the server factory stubbed so each assertion reads the config the
// request resolved rather than a registered tool list.
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    async handleRequest() {}
    async close() {}
  },
}))

vi.mock('../src/server', () => ({
  createCanvasMCPServer: vi.fn().mockReturnValue({
    server: { connect: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
    canvas: {},
  }),
}))

vi.mock('../src/cli', () => ({
  parseArgs: vi.fn().mockReturnValue({
    token: 'default-token',
    baseUrl: 'https://canvas.example.com/api/v1',
    mode: 'http',
    port: 3001,
    allowedOrigin: 'http://localhost:3000',
  }),
}))

vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
}))

import { createHttpHandler } from '../src/http'

function createMockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { method: 'GET', url: '/', headers: {}, ...overrides } as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & {
  _status: number
  _headers: Record<string, string>
  _body: string
} {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    headersSent: false,
    setHeader(name: string, value: string) {
      res._headers[name.toLowerCase()] = value
    },
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res._headers[k.toLowerCase()] = v
      }
    },
    end(body?: string) {
      if (body) res._body = body
    },
    on: vi.fn(),
  } as unknown as ServerResponse & {
    _status: number
    _headers: Record<string, string>
    _body: string
  }
  return res
}

/** The config the most recent request handed to the server factory. */
async function lastConfig() {
  const { createCanvasMCPServer } = await import('../src/server')
  return vi.mocked(createCanvasMCPServer).mock.calls.at(-1)?.[0]
}

async function clearFactory() {
  const { createCanvasMCPServer } = await import('../src/server')
  vi.mocked(createCanvasMCPServer).mockClear()
}

function set(...toolsets: CanvasToolset[]): ReadonlySet<CanvasToolset> {
  return new Set(toolsets)
}

const BASE = { token: 'test-token', baseUrl: 'https://canvas.example.com/api/v1' }
const plain = createHttpHandler(BASE)
const configured = createHttpHandler({ ...BASE, toolsets: set('grading') })

async function post(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {},
) {
  await clearFactory()
  await handler(createMockReq({ method: 'POST', url: '/mcp', headers }), createMockRes())
  return lastConfig()
}

describe('X-Canvas-Toolsets', () => {
  it('is advertised in the CORS allow-list', async () => {
    const res = createMockRes()
    await plain(createMockReq({ method: 'OPTIONS', url: '/mcp' }), res)

    expect(res._headers['access-control-allow-headers']).toContain('X-Canvas-Toolsets')
    // The pre-existing entries are untouched.
    expect(res._headers['access-control-allow-headers']).toContain('X-Canvas-Role')
    expect(res._headers['access-control-allow-headers']).toContain('X-Canvas-Token')
  })

  it('passes a header selection through to the server factory', async () => {
    expect((await post(plain, { 'x-canvas-toolsets': 'quizzes,people' }))?.toolsets).toEqual(
      set('quizzes', 'people'),
    )
  })

  it('is case-insensitive and trims, like the env and flag surfaces', async () => {
    expect((await post(plain, { 'x-canvas-toolsets': ' GRADING , Quizzes ' }))?.toolsets).toEqual(
      set('grading', 'quizzes'),
    )
  })

  it('is absent by default, preserving the full surface', async () => {
    expect((await post(plain))?.toolsets).toBeUndefined()
  })

  it('falls back to the configured selection when no header is present', async () => {
    expect((await post(configured))?.toolsets).toEqual(set('grading'))
  })

  it('the header overrides the configured selection', async () => {
    expect((await post(configured, { 'x-canvas-toolsets': 'account' }))?.toolsets).toEqual(
      set('account'),
    )
  })

  it('treats "all" as no filter, even over a narrow configured selection', async () => {
    expect((await post(configured, { 'x-canvas-toolsets': 'all' }))?.toolsets).toBeUndefined()
  })

  it('keeps the configured selection and warns when the header value is invalid', async () => {
    // Mirrors X-Canvas-Role: the typo is the client's, and the operator's own
    // configuration is the better fallback. Widening to the full surface here
    // would let a misconfigured client reveal tools the operator narrowed away
    // — which is why this differs from the env/flag surfaces, where there is no
    // operator selection left to fall back to.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect((await post(configured, { 'x-canvas-toolsets': 'grading,bogus' }))?.toolsets).toEqual(
      set('grading'),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown X-Canvas-Toolsets value(s) 'bogus'"),
    )
    warn.mockRestore()
  })

  it('an invalid header on an unconfigured server leaves the full surface', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await post(plain, { 'x-canvas-toolsets': 'bogus' }))?.toolsets).toBeUndefined()
    warn.mockRestore()
  })

  it('changes nothing about token or base-URL handling', async () => {
    const config = await post(plain, {
      'x-canvas-toolsets': 'grading',
      'x-canvas-token': 'per-request',
    })

    expect(config?.token).toBe('per-request')
    expect(config?.baseUrl).toBe('https://canvas.example.com/api/v1')
  })

  it('composes with X-Canvas-Role in the same request', async () => {
    const config = await post(plain, {
      'x-canvas-toolsets': 'grading',
      'x-canvas-role': 'teacher',
    })

    expect(config?.toolsets).toEqual(set('grading'))
    expect(config?.role).toBe('teacher')
  })
})

describe('read-only startup control over HTTP', () => {
  const readOnly = createHttpHandler({ ...BASE, readOnly: true })

  it('passes the operator floor through to the server factory', async () => {
    expect((await post(readOnly))?.readOnly).toBe(true)
  })

  it('is absent by default, preserving the default write surface', async () => {
    expect((await post(plain))?.readOnly).toBeFalsy()
  })

  it('is server config only — there is deliberately no header for it', async () => {
    // Unlike role and toolsets, which narrow only the calling client's own
    // view, this is the operator bounding what any client can do. A header
    // override would defeat it, exactly as it would for destructiveTools.
    expect((await post(readOnly, { 'x-canvas-read-only': 'false' }))?.readOnly).toBe(true)
  })
})
