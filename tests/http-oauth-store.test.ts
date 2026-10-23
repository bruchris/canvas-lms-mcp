// Direct coverage of `openOAuthStore` (src/http.ts), the whole of the grant
// store decision: memory vs an encrypted file, driven purely by whether
// `config.store` is set. Asserted on real behaviour (round-tripping a grant),
// not `instanceof`, per BRU-3148.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Importing '../src/http' runs its auto-invoked `main()` as a module side
// effect (same shape as tests/stdio.test.ts for the stdio transport). These
// mocks keep that harmless — an unmocked `parseArgs` would read real
// argv/env, which could reject and reach the real `process.exit`.
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
    destructiveTools: 'block',
  }),
}))

vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
}))

import { openOAuthStore } from '../src/http'
import { loadOAuthProfileConfig } from '../src/auth/oauth/config'
import { FileOAuthStore } from '../src/auth/oauth/file-store'
import { MemoryOAuthStore, type Grant } from '../src/auth/oauth/store'
import { BASE_ENV } from './auth/oauth/harness'

const NOW = 1_800_000_000_000

function grant(id: string): Grant {
  return {
    id,
    clientId: 'c1',
    scopes: ['canvas:read', 'canvas:write'],
    resource: 'http://127.0.0.1:3001/mcp',
    canvasUserId: '42',
    canvas: {
      accessToken: 'canvas-access-SECRET',
      refreshToken: 'canvas-refresh-SECRET',
      expiresAt: NOW + 3_600_000,
    },
    createdAt: NOW,
  }
}

describe('openOAuthStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-mcp-http-oauth-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('opens an in-memory store when no store path is configured, so nothing survives a reopen', async () => {
    const config = loadOAuthProfileConfig(BASE_ENV)
    expect(config.store).toBeUndefined()

    const a = await openOAuthStore(config)
    expect(a).toBeInstanceOf(MemoryOAuthStore)
    await a.putGrant(grant('g1'))
    expect(await a.getGrant('g1')).toBeDefined()

    // A fresh call starts from nothing: proves the grant lived only in this
    // process's memory, not anywhere durable.
    const b = await openOAuthStore(config)
    expect(await b.getGrant('g1')).toBeUndefined()
  })

  it('opens an encrypted file store when a store path is configured, and it persists across opens', async () => {
    const path = join(dir, 'oauth-store.enc')
    const config = loadOAuthProfileConfig({
      ...BASE_ENV,
      CANVAS_MCP_OAUTH_STORE: path,
      CANVAS_MCP_OAUTH_STORE_KEY: 'a-long-enough-secret-value',
    })
    expect(config.store).toEqual({ path, keySecret: 'a-long-enough-secret-value' })

    const a = await openOAuthStore(config)
    expect(a).toBeInstanceOf(FileOAuthStore)
    await a.putGrant(grant('g1'))
    await (a as FileOAuthStore).flush()

    // Re-opened through the same entry point `main()` uses at startup, not
    // `FileOAuthStore.open` directly: proves the wiring, not only the class.
    const b = await openOAuthStore(config)
    expect(b).toBeInstanceOf(FileOAuthStore)
    expect(await b.getGrant('g1')).toMatchObject({ canvasUserId: '42' })
  })
})
