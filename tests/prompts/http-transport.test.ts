/**
 * The HTTP transport builds a FRESH McpServer for every POST and connects it
 * per request, so prompt registration has to survive that construction order:
 * `registerCapabilities` throws once a transport is attached, and
 * `setRequestHandler` refuses a method whose capability was never declared.
 *
 * The rest of tests/http.test.ts mocks createCanvasMCPServer, so nothing there
 * exercises a real protocol round trip. This file drives an actual HTTP server
 * with a real MCP client instead — the server transport is deliberately NOT
 * mocked here.
 *
 * Importing src/http runs its top-level main(), which would bind a port and
 * process.exit(1) when parseArgs finds no credentials. Stubbing parseArgs and
 * the createServer that main() reaches for keeps that startup inert; the test
 * takes the real createServer from vi.importActual.
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

vi.mock('../../src/cli', () => ({
  parseArgs: vi.fn().mockReturnValue({
    token: 'startup-token',
    baseUrl: 'https://canvas.example.com',
    mode: 'http',
    port: 0,
  }),
}))

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http')
  // main() gets an inert server; the tests below use the real createServer.
  return { ...actual, createServer: vi.fn().mockReturnValue({ listen: vi.fn() }) }
})

const { createServer } = await vi.importActual<typeof import('node:http')>('node:http')

const { createHttpHandler } = await import('../../src/http')
const { GENERATED_SKILLS } = await import('../../src/prompts/skills.generated')

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function startServer(role?: 'student' | 'teacher' | 'admin'): Promise<URL> {
  const server = createServer(
    createHttpHandler({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      role,
    }),
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return new URL(`http://127.0.0.1:${port}/mcp`)
}

async function connect(url: URL, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'http-test-client', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }))
  return client
}

describe('prompts over the HTTP transport', () => {
  it('advertises the prompts capability on a per-request server', async () => {
    const client = await connect(await startServer())
    expect(client.getServerCapabilities()?.prompts).toBeDefined()
  })

  it('lists every skill', async () => {
    const client = await connect(await startServer())
    const { prompts } = await client.listPrompts()
    expect(prompts).toHaveLength(GENERATED_SKILLS.length)
  })

  it('serves a prompt body across two separate requests', async () => {
    // listPrompts and getPrompt land on different McpServer instances here.
    // The catalog is static, so the second must answer as well as the first.
    const client = await connect(await startServer())
    await client.listPrompts()
    const result = await client.getPrompt({ name: 'canvas-grading-pass' })
    const content = result.messages[0]?.content as { type: string; text: string }

    expect(content.text).toContain('# Canvas Grading Pass')
  })

  it('narrows prompts by the X-Canvas-Role header', async () => {
    const client = await connect(await startServer(), { 'X-Canvas-Role': 'student' })
    const { prompts } = await client.listPrompts()

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'canvas-student-todo',
      'canvas-week-plan',
    ])
  })

  it('falls back to the configured role when no header is sent', async () => {
    const client = await connect(await startServer('student'))
    const { prompts } = await client.listPrompts()

    expect(prompts).toHaveLength(2)
  })
})
