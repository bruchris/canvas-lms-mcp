import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Mock dependencies before importing handler
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
  return {
    method: 'GET',
    url: '/',
    headers: {},
    ...overrides,
  } as unknown as IncomingMessage
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
        for (const [k, v] of Object.entries(headers)) {
          res._headers[k.toLowerCase()] = v
        }
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

describe('createHttpHandler', () => {
  const handler = createHttpHandler({
    token: 'test-token',
    baseUrl: 'https://canvas.example.com/api/v1',
    allowedOrigin: 'https://myapp.example.com',
  })

  describe('CORS', () => {
    it('sets CORS headers with configured origin', async () => {
      const req = createMockReq({ url: '/health' })
      const res = createMockRes()
      await handler(req, res)
      expect(res._headers['access-control-allow-origin']).toBe('https://myapp.example.com')
      expect(res._headers['access-control-allow-methods']).toBe('GET, POST, DELETE, OPTIONS')
      expect(res._headers['access-control-allow-headers']).toContain('X-Canvas-Token')
      expect(res._headers['access-control-allow-headers']).toContain('X-Canvas-Base-URL')
    })

    it('defaults CORS origin to localhost when not configured', async () => {
      const defaultHandler = createHttpHandler({ token: 'tok', baseUrl: 'https://canvas.example.com' })
      const req = createMockReq({ url: '/health' })
      const res = createMockRes()
      await defaultHandler(req, res)
      expect(res._headers['access-control-allow-origin']).toBe('http://localhost:3000')
    })

    it('responds 204 to OPTIONS preflight', async () => {
      const req = createMockReq({ method: 'OPTIONS', url: '/mcp' })
      const res = createMockRes()
      await handler(req, res)
      expect(res._status).toBe(204)
    })
  })

  describe('/health', () => {
    it('returns 200 with status ok', async () => {
      const req = createMockReq({ url: '/health' })
      const res = createMockRes()
      await handler(req, res)
      expect(res._status).toBe(200)
      expect(JSON.parse(res._body)).toEqual({ status: 'ok' })
    })
  })

  describe('routing', () => {
    it('returns 404 for unknown paths', async () => {
      const req = createMockReq({ url: '/unknown' })
      const res = createMockRes()
      await handler(req, res)
      expect(res._status).toBe(404)
      expect(JSON.parse(res._body)).toEqual({ error: 'Not found' })
    })

    it('returns 405 for non-POST to /mcp', async () => {
      const req = createMockReq({ method: 'GET', url: '/mcp' })
      const res = createMockRes()
      await handler(req, res)
      expect(res._status).toBe(405)
      const body = JSON.parse(res._body)
      expect(body.error.message).toBe('Method not allowed.')
    })
  })

  describe('credential extraction', () => {
    it('returns 400 when no credentials available', async () => {
      const noConfigHandler = createHttpHandler({})
      const req = createMockReq({ method: 'POST', url: '/mcp', headers: {} })
      const res = createMockRes()
      await noConfigHandler(req, res)
      expect(res._status).toBe(400)
      expect(JSON.parse(res._body).error).toContain('Missing Canvas credentials')
    })

    it('returns 400 for invalid base URL', async () => {
      const noConfigHandler = createHttpHandler({})
      const req = createMockReq({
        method: 'POST',
        url: '/mcp',
        headers: {
          'x-canvas-token': 'tok',
          'x-canvas-base-url': 'not-a-url',
        },
      })
      const res = createMockRes()
      await noConfigHandler(req, res)
      expect(res._status).toBe(400)
      expect(JSON.parse(res._body).error).toContain('Invalid X-Canvas-Base-URL')
    })

    it('rejects private IP addresses in base URL', async () => {
      const noConfigHandler = createHttpHandler({})
      for (const privateUrl of [
        'https://127.0.0.1/api/v1',
        'https://10.0.0.1/api/v1',
        'https://172.16.0.1/api/v1',
        'https://192.168.1.1/api/v1',
        'https://169.254.1.1/api/v1',
        'https://localhost/api/v1',
      ]) {
        const req = createMockReq({
          method: 'POST',
          url: '/mcp',
          headers: { 'x-canvas-token': 'tok', 'x-canvas-base-url': privateUrl },
        })
        const res = createMockRes()
        await noConfigHandler(req, res)
        expect(res._status).toBe(400)
      }
    })

    it('uses default config when headers not provided', async () => {
      const req = createMockReq({ method: 'POST', url: '/mcp' })
      const res = createMockRes()
      await handler(req, res)
      // Should not return 400 since handler has default config
      expect(res._status).not.toBe(400)
    })
  })

  describe('MCP request handling', () => {
    it('creates fresh MCP server per POST /mcp request', async () => {
      const { createCanvasMCPServer } = await import('../src/server')
      const req = createMockReq({ method: 'POST', url: '/mcp' })
      const res = createMockRes()
      await handler(req, res)
      expect(createCanvasMCPServer).toHaveBeenCalledWith({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com/api/v1',
      })
    })
  })
})
