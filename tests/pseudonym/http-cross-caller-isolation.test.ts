// BRU-2511 — cross-caller pseudonym reverse-lookup isolation in the HTTP transport.
//
// The exposure: `createHttpHandler` builds ONE process-wide `Pseudonymizer`
// keyed only on the configured Canvas base URL and hands it to every
// per-request MCP server, whatever `X-Canvas-Token` the caller presented.
// `resolve_pseudonym` reads that shared on-disk map and makes no Canvas call,
// so under `CANVAS_PSEUDONYMIZE_STUDENTS=true` +
// `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true` caller B could recover a real
// `user_id` that only caller A's token could legitimately have produced.
//
// These tests drive the REAL server factory and the REAL pseudonymizer through
// the real `createHttpHandler`; only the transport, `node:http` and `parseArgs`
// are stubbed (the last two because `src/http.ts` calls `main()` at import).
// Every "it is denied" assertion is paired with a control that produces the
// non-denied result from the same on-disk map, so a green run cannot come from
// a broken harness.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CanvasMCPServer, CanvasMCPServerConfig } from '../../src/server'
import type { CanvasUser } from '../../src/canvas/types'

const capture = vi.hoisted(() => ({
  built: [] as Array<{ config: CanvasMCPServerConfig; result: CanvasMCPServer }>,
}))

// A transport complete enough for the REAL `server.connect()` to succeed —
// otherwise every request falls into the handler's 500 branch and the tests
// would be asserting against a server that never finished wiring up.
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    onmessage?: unknown
    onclose?: unknown
    onerror?: unknown
    async start() {}
    async send() {}
    async handleRequest() {}
    async close() {}
  },
}))

vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
}))

vi.mock('../../src/cli', () => ({
  parseArgs: vi.fn().mockReturnValue({ mode: 'http', port: 3001 }),
}))

// Spy-wrap rather than replace: the handler must build a real MCP server with
// the real tool registry, otherwise "the tool is not registered" proves nothing.
vi.mock('../../src/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server')>()
  return {
    ...actual,
    createCanvasMCPServer: (config: CanvasMCPServerConfig) => {
      const result = actual.createCanvasMCPServer(config)
      capture.built.push({ config, result })
      return result
    },
  }
})

import { createHttpHandler } from '../../src/http'
import { createCanvasMCPServer } from '../../src/server'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'

const BASE_URL = 'https://school.instructure.com'
const COURSE_ID = 101
const OTHER_COURSE_ID = 999
const TOKEN_A = 'TOKEN-CALLER-A'
const TOKEN_B = 'TOKEN-CALLER-B-UNRELATED'

const ALICE_ID = 98765
const BOB_ID = 98766

function student(id: number, name: string): CanvasUser {
  return {
    id,
    name,
    sortable_name: name,
    short_name: name.split(' ')[0],
    email: `${name.replace(/\s+/g, '.').toLowerCase()}@example.edu`,
    login_id: name.replace(/\s+/g, '.').toLowerCase(),
    sis_user_id: `SIS-${id}`,
    enrollments: [
      {
        id,
        user_id: id,
        course_id: COURSE_ID,
        type: 'StudentEnrollment',
        enrollment_state: 'active',
        role: 'StudentEnrollment',
        role_id: 1,
      },
    ],
  } as CanvasUser
}

function createMockReq(headers: Record<string, string>): IncomingMessage {
  return { method: 'POST', url: '/mcp', headers } as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & { _status: number } {
  const res = {
    _status: 0,
    headersSent: false,
    setHeader() {},
    writeHead(status: number) {
      res._status = status
    },
    end() {},
    on: vi.fn(),
  } as unknown as ServerResponse & { _status: number }
  return res
}

type Handler = ReturnType<typeof createHttpHandler>

/** Drive one POST /mcp request and return the MCP server the handler built. */
async function callAs(handler: Handler, token: string, extraHeaders: Record<string, string> = {}) {
  const before = capture.built.length
  const res = createMockRes()
  await handler(createMockReq({ 'x-canvas-token': token, ...extraHeaders }), res)
  // 0 = the handler never called writeHead, i.e. neither the 400 credential
  // branch nor the 500 error branch was taken.
  expect(res._status).toBe(0)
  expect(capture.built.length).toBe(before + 1)
  const entry = capture.built[capture.built.length - 1]
  expect(entry.config.token).toBe(token)
  return entry
}

function toolNames(server: CanvasMCPServer['server']): string[] {
  return Object.keys(
    (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
  )
}

async function callTool(
  server: CanvasMCPServer['server'],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const registered = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }> }> }
      >
    }
  )._registeredTools[name]
  if (!registered) throw new Error(`tool ${name} is not registered`)
  const result = await registered.handler(args, {})
  return JSON.parse(result.content[0].text)
}

let tmpRoot: string
let fetchSpy: ReturnType<typeof vi.fn>
const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  capture.built.length = 0
  tmpRoot = await mkdtemp(join(tmpdir(), 'http-xcaller-'))
  process.env.CANVAS_PSEUDONYM_DIR = tmpRoot
  process.env.CANVAS_PSEUDONYMIZE_STUDENTS = 'true'
  process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP = 'true'
  delete process.env.CANVAS_PSEUDONYM_AUDIT_LOG

  // Canvas is stubbed: `list_students` is the only endpoint any test reaches.
  fetchSpy = vi.fn(async () =>
    Object.assign(
      {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [student(ALICE_ID, 'Alice Smith'), student(BOB_ID, 'Bob Jones')],
      },
      {},
    ),
  )
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const key of [
    'CANVAS_PSEUDONYM_DIR',
    'CANVAS_PSEUDONYMIZE_STUDENTS',
    'CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP',
  ]) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function httpHandler(overrides: Partial<Parameters<typeof createHttpHandler>[0]> = {}) {
  return createHttpHandler({ baseUrl: BASE_URL, ...overrides })
}

/**
 * A stdio-shaped server over the SAME on-disk map: one process, one token, a
 * pseudonymizer that is not shared across callers. This is the control for
 * every denial assertion — and it is also the pre-fix behaviour of the HTTP
 * path, i.e. the exact thing the report measured.
 */
function soloServer(token: string) {
  return createCanvasMCPServer({
    token,
    baseUrl: BASE_URL,
    pseudonymizer: new Pseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot }),
  })
}

/** Seed the shared map as caller A by listing the course roster. */
async function seedAsCallerA(handler: Handler) {
  const { result } = await callAs(handler, TOKEN_A)
  const users = (await callTool(result.server, 'list_students', {
    course_id: COURSE_ID,
  })) as CanvasUser[]
  expect(users.map((u) => u.name)).toEqual(['Student 1', 'Student 2'])
  return result
}

describe('HTTP transport pseudonym isolation (BRU-2511)', () => {
  describe('control — the harness can observe a successful reverse lookup', () => {
    it('a non-shared pseudonymizer over the same map resolves a pseudonym seeded via HTTP', async () => {
      await seedAsCallerA(httpHandler())

      const { server } = soloServer(TOKEN_B)
      expect(toolNames(server)).toContain('resolve_pseudonym')
      expect(
        await callTool(server, 'resolve_pseudonym', {
          course_id: COURSE_ID,
          pseudonym: 'Student 1',
        }),
      ).toMatchObject({ found: true, user_id: ALICE_ID, status: 'active' })
    })

    it('negative control: an unknown pseudonym in a seeded course does not resolve', async () => {
      await seedAsCallerA(httpHandler())
      const { server } = soloServer(TOKEN_B)
      expect(
        await callTool(server, 'resolve_pseudonym', {
          course_id: COURSE_ID,
          pseudonym: 'Student 99',
        }),
      ).toMatchObject({ found: false })
    })

    it('negative control: a known pseudonym in an unseeded course does not resolve', async () => {
      await seedAsCallerA(httpHandler())
      const { server } = soloServer(TOKEN_B)
      expect(
        await callTool(server, 'resolve_pseudonym', {
          course_id: OTHER_COURSE_ID,
          pseudonym: 'Student 1',
        }),
      ).toMatchObject({ found: false })
    })
  })

  describe('the fix — reverse lookup is denied at the HTTP boundary', () => {
    it('does not register resolve_pseudonym for any HTTP caller, with both flags set', async () => {
      const handler = httpHandler()
      const a = await callAs(handler, TOKEN_A)
      const b = await callAs(handler, TOKEN_B)

      // The reference set: the same tools, registered against a non-shared
      // pseudonymizer. Asserting the set difference (rather than a count or a
      // single `not.toContain`) proves the denial removed `resolve_pseudonym`
      // and nothing else — a fix that disabled pseudonymization wholesale, or
      // tripped some other registration, would fail here.
      const soloNames = toolNames(soloServer(TOKEN_A).server)
      expect(soloNames).toContain('resolve_pseudonym')

      for (const entry of [a, b]) {
        const names = toolNames(entry.result.server)
        expect(names).not.toContain('resolve_pseudonym')
        expect(soloNames.filter((n) => !names.includes(n))).toEqual(['resolve_pseudonym'])
        expect(names.filter((n) => !soloNames.includes(n))).toEqual([])
      }
    })

    it('caller B cannot reverse-resolve a mapping caller A seeded', async () => {
      const handler = httpHandler()
      await seedAsCallerA(handler)

      const { config, result } = await callAs(handler, TOKEN_B)
      expect(toolNames(result.server)).not.toContain('resolve_pseudonym')

      // Even reaching past the registry — the instance itself refuses, so a
      // future re-registration cannot resurrect the exposure on its own.
      const shared = config.pseudonymizer
      expect(shared).toBeDefined()
      expect(shared?.sharedAcrossCallers).toBe(true)
      expect(await shared?.reverseLookup(COURSE_ID, 'Student 1')).toBeNull()
    })

    it('the shared instance is the SAME object across callers (the map really is shared)', async () => {
      const handler = httpHandler()
      const a = await callAs(handler, TOKEN_A)
      const b = await callAs(handler, TOKEN_B)
      // Without this, "B cannot resolve A's mapping" would also pass if the
      // handler had simply given B a different, empty pseudonymizer.
      expect(b.config.pseudonymizer).toBe(a.config.pseudonymizer)
    })

    it('never falls back to the factory-default pseudonymizer', async () => {
      // `createCanvasMCPServer` builds its own non-shared instance when none is
      // passed. If the handler ever stopped passing one, reverse lookup would
      // silently come back.
      const { config, result } = await callAs(httpHandler(), TOKEN_A)
      expect(config.pseudonymizer).toBeDefined()
      expect(result.pseudonymizer).toBe(config.pseudonymizer)
      expect(result.pseudonymizer.sharedAcrossCallers).toBe(true)
    })

    it('a reverse-lookup attempt makes no Canvas call', async () => {
      const handler = httpHandler()
      await seedAsCallerA(handler)
      const { config } = await callAs(handler, TOKEN_B)
      fetchSpy.mockClear()
      await config.pseudonymizer?.reverseLookup(COURSE_ID, 'Student 1')
      // The denial is local, so nothing hits Canvas — and nothing about the
      // result can be attributed to a stubbed Canvas response.
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('the protection cannot be bypassed from the client side', () => {
    it.each([
      ['x-canvas-role', 'teacher'],
      ['x-canvas-role', 'admin'],
      ['x-canvas-role', 'all'],
      ['x-canvas-pseudonymize-reverse-lookup', 'true'],
      ['x-canvas-pseudonymize-students', 'false'],
    ])('%s: %s does not re-enable resolve_pseudonym', async (header, value) => {
      const handler = httpHandler({ role: 'teacher' })
      const { result } = await callAs(handler, TOKEN_B, { [header]: value })
      expect(toolNames(result.server)).not.toContain('resolve_pseudonym')
    })

    it('an admin-role caller still sees the rest of the admin tool set', async () => {
      // Anti-vacuity for the bypass table: `X-Canvas-Role: admin` really is
      // honoured, so the missing tool is the denial and not a dead header.
      const { result } = await callAs(httpHandler({ role: 'student' }), TOKEN_B, {
        'x-canvas-role': 'admin',
      })
      const names = toolNames(result.server)
      expect(names).toContain('list_account_users')
      expect(names).not.toContain('resolve_pseudonym')
    })
  })

  describe('everything else about FERPA mode is unchanged over HTTP', () => {
    it('still pseudonymizes student PII in tool output', async () => {
      const { result } = await callAs(httpHandler(), TOKEN_A)
      const users = (await callTool(result.server, 'list_students', {
        course_id: COURSE_ID,
      })) as CanvasUser[]
      expect(users.map((u) => u.name)).toEqual(['Student 1', 'Student 2'])
      expect(users[0].sis_user_id).toBeNull()
    })

    it('reports enabled: true, reverseLookupEnabled: false', async () => {
      const { config } = await callAs(httpHandler(), TOKEN_A)
      expect(config.pseudonymizer?.status()).toEqual({
        enabled: true,
        reverseLookupEnabled: false,
      })
    })

    it('warns once at startup when reverse lookup was configured but is denied', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      httpHandler()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP')
      expect(warn.mock.calls[0][0]).toContain('resolve_pseudonym')
      warn.mockRestore()
    })

    it('does not warn when reverse lookup was never requested', () => {
      delete process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      httpHandler()
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('stdio behaviour is preserved', () => {
    it('registers resolve_pseudonym when the deployment is declared single-caller', () => {
      // `sharedAcrossCallers: false` is what `src/stdio.ts` passes. Since
      // BRU-2515 the factory refuses to *guess* the deployment shape while
      // reverse lookup is requested, so modelling stdio means saying so.
      const { server } = createCanvasMCPServer({
        token: TOKEN_A,
        baseUrl: BASE_URL,
        sharedAcrossCallers: false,
      })
      expect(toolNames(server)).toContain('resolve_pseudonym')
    })

    it('does not register it when only CANVAS_PSEUDONYMIZE_STUDENTS is set', () => {
      delete process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP
      const { server } = createCanvasMCPServer({ token: TOKEN_A, baseUrl: BASE_URL })
      expect(toolNames(server)).not.toContain('resolve_pseudonym')
    })
  })
})
