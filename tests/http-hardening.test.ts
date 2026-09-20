// Unauthenticated crash paths on the HTTP transport (QA R3, PR #356).
//
// These run against a real `http.Server` and raw sockets, because both
// defects are in what the node HTTP parser hands the handler — a request
// target no `URL` constructor accepts, and a request body that ends with the
// connection. Neither is reachable through the mocked req/res doubles the
// rest of the suite uses.
//
// R3a is a regression against `main`, which compared `req.url` as a string
// and answered 404, so it is exercised in the default `remote_static_token`
// profile as well as `oauth_brokered`.

import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    baseUrl: 'https://canvas.example.com',
    mode: 'http',
    port: 3001,
    allowedOrigin: 'http://localhost:3000',
    authProfile: 'remote_static_token',
  }),
}))

// `src/http.ts` calls `main()` on import. Stub only `createServer` so nothing
// listens on import; `Server` stays real, and is what these tests bind.
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return { ...actual, default: actual, createServer: vi.fn(() => ({ listen: vi.fn() })) }
})

import { Server } from 'node:http'
import { createHttpHandler } from '../src/http'
import { loadOAuthProfileConfig } from '../src/auth/oauth/config'
import { MemoryOAuthStore } from '../src/auth/oauth/store'
import { BASE_ENV, mockCanvas } from './auth/oauth/harness'

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

interface Live {
  port: number
  close(): Promise<void>
}

const CRLF = '\r\n'

function getRequest(target: string): string {
  return `GET ${target} HTTP/1.1${CRLF}Host: 127.0.0.1${CRLF}Connection: close${CRLF}${CRLF}`
}

async function listen(handler: Handler): Promise<Live> {
  const server = new Server(handler as never)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Write a literal request and read whatever comes back before the socket ends. */
function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    const socket = connect(port, '127.0.0.1', () => socket.write(request))
    socket.setTimeout(5000, () => {
      socket.destroy()
      resolve(data)
    })
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('close', () => resolve(data))
    socket.on('error', reject)
  })
}

/** Announce a body, send part of it, then drop the connection. */
function abortMidBody(port: number, path: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `POST ${path} HTTP/1.1${CRLF}` +
          `Host: 127.0.0.1${CRLF}` +
          `Content-Type: application/json${CRLF}` +
          `Content-Length: 1000${CRLF}${CRLF}` +
          '{"redirect_uris"',
      )
      setTimeout(() => {
        socket.destroy()
        resolve()
      }, 50)
    })
    socket.on('error', () => resolve())
  })
}

function staticProfileHandler(): Handler {
  return createHttpHandler({
    token: 'default-token',
    baseUrl: 'https://canvas.example.com',
    allowedOrigin: 'http://localhost:3000',
  }) as Handler
}

function oauthProfileHandler(): Handler {
  const canvas = mockCanvas()
  return createHttpHandler({
    authProfile: 'oauth_brokered',
    oauth: loadOAuthProfileConfig(BASE_ENV),
    oauthStore: new MemoryOAuthStore(),
    fetch: canvas.fetch as unknown as typeof fetch,
    allowedOrigin: 'https://app.example',
  }) as Handler
}

const PROFILES: Array<[string, () => Handler]> = [
  ['remote_static_token', staticProfileHandler],
  ['oauth_brokered', oauthProfileHandler],
]

describe('HTTP transport hardening', () => {
  let rejections: unknown[]
  const onRejection = (reason: unknown) => rejections.push(reason)

  beforeEach(() => {
    rejections = []
    process.on('unhandledRejection', onRejection)
  })
  afterEach(() => {
    process.off('unhandledRejection', onRejection)
  })

  /** Unhandled rejections surface a turn or two after the socket closes. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  }

  for (const [name, build] of PROFILES) {
    describe(name, () => {
      let live: Live

      beforeEach(async () => {
        live = await listen(build())
      })
      afterEach(async () => {
        await live.close()
      })

      it.each(['//a:b', '//'])(
        'answers 4xx for the unparseable request target %s and stays up',
        async (target) => {
          const response = await raw(live.port, getRequest(target))
          expect(response).toMatch(/^HTTP\/1\.1 4\d\d /)
          await settle()
          expect(rejections).toEqual([])

          // The proof that the crash is gone: the server answers what follows.
          const health = await raw(live.port, getRequest('/health'))
          expect(health).toContain('HTTP/1.1 200')
          expect(health).toContain('"status":"ok"')
        },
      )

      it('survives a client that announces a body and drops the connection', async () => {
        await abortMidBody(live.port, name === 'oauth_brokered' ? '/oauth/register' : '/mcp')
        await settle()
        expect(rejections).toEqual([])

        const health = await raw(live.port, getRequest('/health'))
        expect(health).toContain('HTTP/1.1 200')
      })

      it('still routes a well-formed request', async () => {
        const response = await raw(live.port, getRequest('/nope'))
        expect(response).toContain('HTTP/1.1 404')
      })
    })
  }

  // The individual fixes above keep the two known cases from throwing at all.
  // This is the net underneath them: any other error escaping the handler must
  // become a 500, not an unhandled rejection that ends the process. The store
  // failing to accept the pre-registered clients at startup is the cheapest
  // real instance — the rejection is created before the first request and is
  // re-thrown inside the handler on every one.
  it('answers 500 and stays up when an error escapes the handler', async () => {
    const store = new MemoryOAuthStore()
    store.putClient = () => Promise.reject(new Error('store is unwritable'))
    const canvas = mockCanvas()
    const handler = createHttpHandler({
      authProfile: 'oauth_brokered',
      oauth: loadOAuthProfileConfig({
        ...BASE_ENV,
        CANVAS_MCP_OAUTH_CLIENTS: JSON.stringify([
          { client_id: 'mcpcl_seed', redirect_uris: ['http://127.0.0.1/cb'] },
        ]),
      }),
      oauthStore: store,
      fetch: canvas.fetch as unknown as typeof fetch,
    }) as Handler
    const live = await listen(handler)
    try {
      const response = await raw(live.port, getRequest('/mcp'))
      expect(response).toContain('HTTP/1.1 500')
      expect(response).toContain('server_error')
      await settle()
      expect(rejections).toEqual([])
      expect(await raw(live.port, getRequest('/health'))).toContain('HTTP/1.1 200')
    } finally {
      await live.close()
    }
  })

  it('survives an aborted body on every unauthenticated OAuth endpoint that reads one', async () => {
    const live = await listen(oauthProfileHandler())
    try {
      for (const path of [
        '/oauth/register',
        '/oauth/token',
        '/oauth/revoke',
        '/oauth/authorize/continue',
      ]) {
        await abortMidBody(live.port, path)
      }
      await settle()
      expect(rejections).toEqual([])
      const health = await raw(live.port, getRequest('/health'))
      expect(health).toContain('HTTP/1.1 200')
    } finally {
      await live.close()
    }
  })
})
