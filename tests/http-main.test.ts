// Coverage for the `main()` wiring in src/http.ts (BRU-3148): the grant-store
// open/fail path and the "Grant store: ..." startup line `onListening`
// prints. `createHttpHandler` and the request path already have coverage
// elsewhere (tests/http.test.ts, tests/http-oauth.test.ts) — this file is
// only the part nothing else exercises: the code that assembles them.
//
// Each test does `vi.resetModules()` then dynamically re-imports '../src/http'
// so that its auto-invoked `main()` (a module side effect, same shape as
// tests/stdio.test.ts) runs fresh against that test's own `parseArgs` and
// `FileOAuthStore.open` mocks.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadOAuthProfileConfig } from '../src/auth/oauth/config'
import type { CliConfig } from '../src/cli'
import { BASE_ENV } from './auth/oauth/harness'

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

const parseArgs = vi.fn<(args: string[]) => CliConfig>()
vi.mock('../src/cli', () => ({ parseArgs }))

let listenCallback: (() => void) | undefined
const listen = vi.fn((...args: unknown[]) => {
  listenCallback = args[args.length - 1] as () => void
})
const createServer = vi.fn().mockReturnValue({ listen })
vi.mock('node:http', () => ({ createServer }))

// Defaults to the real implementation so the "encrypted file" / "in-memory"
// tests exercise genuine `FileOAuthStore` behaviour; only the exit-path test
// overrides it, once, to reject.
vi.mock('../src/auth/oauth/file-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/auth/oauth/file-store')>()
  return { ...actual, FileOAuthStore: { open: vi.fn(actual.FileOAuthStore.open) } }
})

function baseCliConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    token: '',
    baseUrl: 'https://canvas.example.com',
    mode: 'http',
    port: 3001,
    allowedOrigin: 'http://localhost:3000',
    authProfile: 'oauth_brokered',
    destructiveTools: 'block',
    ...overrides,
  }
}

describe('http.ts main()', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-mcp-http-main-'))
    vi.resetModules()
    listenCallback = undefined
    parseArgs.mockReset()
    listen.mockClear()
    createServer.mockClear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('logs the error and exits non-zero when the grant store cannot be opened, never starting the server', async () => {
    const { FileOAuthStore } = await import('../src/auth/oauth/file-store')
    vi.mocked(FileOAuthStore.open).mockRejectedValueOnce(new Error('disk full'))

    const oauth = loadOAuthProfileConfig({
      ...BASE_ENV,
      CANVAS_MCP_OAUTH_STORE: join(dir, 'oauth-store.enc'),
      CANVAS_MCP_OAUTH_STORE_KEY: 'a-long-enough-secret-value',
    })
    parseArgs.mockReturnValue(baseCliConfig({ oauth }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Throws on the first call (the catch inside `main()` around
    // `openOAuthStore`) so a deleted `process.exit(1)` there fails this
    // test's assertions instead of silently falling through to
    // `createServer`. Falls back to a no-op on any later call so the outer
    // `main().catch(...)` wrapper — reached only because our stub doesn't
    // really terminate the process, unlike the real `process.exit` — settles
    // normally instead of producing an unhandled rejection.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementationOnce(() => {
        throw new Error('process.exit(1)')
      })
      .mockImplementation(() => undefined as never)

    await import('../src/http')
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled()
    })

    expect(exitSpy).toHaveBeenNthCalledWith(1, 1)
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain('disk full')
    expect(createServer).not.toHaveBeenCalled()
  })

  it('reports the grant store as an encrypted file when a store path is configured', async () => {
    const oauth = loadOAuthProfileConfig({
      ...BASE_ENV,
      CANVAS_MCP_OAUTH_STORE: join(dir, 'oauth-store.enc'),
      CANVAS_MCP_OAUTH_STORE_KEY: 'a-long-enough-secret-value',
    })
    parseArgs.mockReturnValue(baseCliConfig({ oauth }))

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await import('../src/http')
    await vi.waitFor(() => {
      expect(listenCallback).toBeDefined()
    })
    listenCallback?.()

    expect(consoleLogSpy).toHaveBeenCalledWith('Grant store: encrypted file')
  })

  it('reports the grant store as in-memory when no store path is configured', async () => {
    const oauth = loadOAuthProfileConfig(BASE_ENV)
    expect(oauth.store).toBeUndefined()
    parseArgs.mockReturnValue(baseCliConfig({ oauth }))

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await import('../src/http')
    await vi.waitFor(() => {
      expect(listenCallback).toBeDefined()
    })
    listenCallback?.()

    expect(consoleLogSpy).toHaveBeenCalledWith('Grant store: in-memory (grants reset on restart)')
  })
})
