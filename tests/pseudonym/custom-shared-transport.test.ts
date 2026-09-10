// BRU-2515 — the *custom* shared-transport path through the public factory.
//
// `tests/pseudonym/http-cross-caller-isolation.test.ts` covers the built-in
// HTTP transport, which owns its own construction site. This file covers the
// case the integration guide advertises but the built-in transport does not
// reach: an embedder calling `createCanvasMCPServer` and connecting it to a
// transport of their own that serves callers with different Canvas
// credentials. Before BRU-2515 that embedder had no way to say so — the
// factory always built a non-shared `Pseudonymizer`, and the class was not
// reachable from the package root at all.
//
// Every denial assertion is paired with a control that produces the
// non-denied result from the *same on-disk map*, so a green run cannot come
// from an empty map, a missing directory, or a broken harness.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCanvasMCPServer,
  createSharedPseudonymizer,
  type CanvasMCPServer,
} from '../../src/server'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import type { CanvasUser } from '../../src/canvas/types'

const BASE_URL = 'https://school.instructure.com'
const COURSE_ID = 101
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
const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'custom-shared-'))
  process.env.CANVAS_PSEUDONYM_DIR = tmpRoot
  process.env.CANVAS_PSEUDONYMIZE_STUDENTS = 'true'
  process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP = 'true'

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [student(ALICE_ID, 'Alice Smith'), student(BOB_ID, 'Bob Jones')],
    })),
  )
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

describe('createSharedPseudonymizer — the public safe construction', () => {
  it('is reachable from the package root entry and yields a shared instance', () => {
    const pseudonymizer = createSharedPseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot })

    expect(pseudonymizer.sharedAcrossCallers).toBe(true)
    // Both env flags are on for this suite, so a non-shared instance would
    // report true here. This is the policy the construction derives.
    expect(pseudonymizer.isEnabled()).toBe(true)
    expect(pseudonymizer.isReverseLookupEnabled()).toBe(false)
  })

  it('cannot be talked out of being shared by an untyped caller', () => {
    // A JavaScript embedder (no compiler to stop them) passing the field
    // through must not be able to downgrade the instance.
    const forged = { baseUrl: BASE_URL, rootDir: tmpRoot, sharedAcrossCallers: false }
    const pseudonymizer = createSharedPseudonymizer(
      forged as unknown as Parameters<typeof createSharedPseudonymizer>[0],
    )

    expect(pseudonymizer.sharedAcrossCallers).toBe(true)
    expect(pseudonymizer.isReverseLookupEnabled()).toBe(false)
  })

  it('routes denial audit lines to the injected writer', async () => {
    const lines: string[] = []
    const pseudonymizer = createSharedPseudonymizer({
      baseUrl: BASE_URL,
      rootDir: tmpRoot,
      auditLog: (line) => lines.push(line),
    })

    await pseudonymizer.reverseLookup(COURSE_ID, 'Student 1')

    // Whole-line match past the timestamp prefix: a substring assertion would
    // also pass on a line that merely mentioned the pseudonym.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\[[^\\]]+\\] canvas-lms-mcp pseudonym reverse_lookup denied course=${COURSE_ID} pseudonym=Student 1 reason=shared-instance$`,
      ),
    )
  })
})

describe('createCanvasMCPServer({ sharedAcrossCallers })', () => {
  it('withholds resolve_pseudonym when the embedder declares a shared deployment', () => {
    const shared = createCanvasMCPServer({
      token: TOKEN_A,
      baseUrl: BASE_URL,
      sharedAcrossCallers: true,
    })
    const single = createCanvasMCPServer({
      token: TOKEN_A,
      baseUrl: BASE_URL,
      sharedAcrossCallers: false,
    })

    // The control is what makes the assertion mean anything: the same factory,
    // the same environment, the same flags — only the declared deployment
    // shape differs, and the tool count differs by exactly this one tool.
    expect(toolNames(single.server)).toContain('resolve_pseudonym')
    expect(toolNames(shared.server)).not.toContain('resolve_pseudonym')
    expect(shared.pseudonymizer.sharedAcrossCallers).toBe(true)
    expect(single.pseudonymizer.sharedAcrossCallers).toBe(false)
  })

  it('withholds resolve_pseudonym when handed an instance from createSharedPseudonymizer', () => {
    const pseudonymizer = createSharedPseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot })

    const { server } = createCanvasMCPServer({
      token: TOKEN_A,
      baseUrl: BASE_URL,
      pseudonymizer,
    })

    expect(toolNames(server)).not.toContain('resolve_pseudonym')
  })

  it('refuses a shared declaration carrying a non-shared pseudonymizer', () => {
    const nonShared = new Pseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot })

    expect(() =>
      createCanvasMCPServer({
        token: TOKEN_A,
        baseUrl: BASE_URL,
        sharedAcrossCallers: true,
        pseudonymizer: nonShared,
      }),
    ).toThrow(/sharedAcrossCallers/)
  })

  it('accepts a shared pseudonymizer without a declaration — the instance is stricter', () => {
    const pseudonymizer = createSharedPseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot })

    const { server } = createCanvasMCPServer({
      token: TOKEN_A,
      baseUrl: BASE_URL,
      sharedAcrossCallers: false,
      pseudonymizer,
    })

    expect(toolNames(server)).not.toContain('resolve_pseudonym')
  })
})

describe('undeclared deployment shape', () => {
  it('refuses to build when reverse lookup is requested but the shape is undeclared', () => {
    expect(() => createCanvasMCPServer({ token: TOKEN_A, baseUrl: BASE_URL })).toThrow(
      /sharedAcrossCallers/,
    )
  })

  it('builds normally when reverse lookup is not requested', () => {
    process.env.CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP = 'false'

    const { server, pseudonymizer } = createCanvasMCPServer({ token: TOKEN_A, baseUrl: BASE_URL })

    expect(toolNames(server)).not.toContain('resolve_pseudonym')
    // Undeclared means unknown, and unknown must not be treated as private.
    expect(pseudonymizer.sharedAcrossCallers).toBe(true)
  })

  it('builds normally when pseudonymization itself is off', () => {
    process.env.CANVAS_PSEUDONYMIZE_STUDENTS = 'false'

    expect(() => createCanvasMCPServer({ token: TOKEN_A, baseUrl: BASE_URL })).not.toThrow()
  })
})

describe('a custom transport sharing one pseudonymizer across callers', () => {
  it('denies caller B a pseudonym caller A seeded, before the map is read', async () => {
    const lines: string[] = []
    const pseudonymizer = createSharedPseudonymizer({
      baseUrl: BASE_URL,
      rootDir: tmpRoot,
      auditLog: (line) => lines.push(line),
    })

    // Caller A: their own credentials, their own MCP server, the shared map.
    const callerA = createCanvasMCPServer({ token: TOKEN_A, baseUrl: BASE_URL, pseudonymizer })
    const roster = (await callTool(callerA.server, 'list_students', {
      course_id: COURSE_ID,
    })) as Array<{ name: string }>
    const seeded = roster.map((s) => s.name)
    expect(seeded).toEqual(['Student 1', 'Student 2'])

    // Caller B: unrelated credentials, same process, same shared instance.
    const callerB = createCanvasMCPServer({ token: TOKEN_B, baseUrl: BASE_URL, pseudonymizer })
    expect(toolNames(callerB.server)).not.toContain('resolve_pseudonym')

    // Direct reverse lookup — the path a re-registration or a direct embedder
    // call would take if the tool ever came back.
    await expect(callerB.pseudonymizer.reverseLookup(COURSE_ID, seeded[0])).resolves.toBeNull()
    expect(
      lines.filter((line) =>
        line.endsWith(
          `reverse_lookup denied course=${COURSE_ID} pseudonym=${seeded[0]} reason=shared-instance`,
        ),
      ),
    ).toHaveLength(1)
    // No miss reason was computed, so the denial cannot become an oracle that
    // distinguishes "no such pseudonym" from "not allowed".
    expect(lines.some((line) => line.includes('reason=no-map'))).toBe(false)
    expect(lines.some((line) => line.includes('reason=not-found'))).toBe(false)

    // ANTI-VACUITY: the pseudonym really is resolvable from that on-disk map.
    // A non-shared instance over the same directory recovers Alice's real id,
    // so the denial above is a policy decision and not an empty map.
    const privateInstance = new Pseudonymizer({ baseUrl: BASE_URL, rootDir: tmpRoot })
    await expect(privateInstance.reverseLookup(COURSE_ID, seeded[0])).resolves.toEqual({
      user_id: ALICE_ID,
      pseudonym: seeded[0],
      status: 'active',
    })
  })
})

describe('public package surface', () => {
  it('exports the safe construction from the entry the exports map publishes', () => {
    // A source-level import proves the symbol exists; this proves the symbol
    // is on the module a package consumer actually resolves. Without it the
    // export could sit in a file no entry point reaches (which is exactly the
    // state Pseudonymizer was in before BRU-2515).
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      exports: Record<string, { import: string; types: string }>
    }
    const tsup = readFileSync('tsup.config.ts', 'utf8')

    expect(pkg.exports['.'].import).toBe('./dist/server.js')
    expect(pkg.exports['.'].types).toBe('./dist/server.d.ts')
    expect(tsup).toContain("server: 'src/server.ts'")
    expect(typeof createSharedPseudonymizer).toBe('function')
  })
})
