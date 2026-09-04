import { describe, expect, it, afterEach, beforeAll, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CanvasClient } from '../../src/canvas'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'
import { toolDomainCatalog } from '../../src/tools/catalog'
import { GATED_DESTRUCTIVE_TOOLS, UNGATED_DELETE_TOOLS } from '../../src/tools/destructive-policy'
import type { CanvasRole, ToolFeatureFlags } from '../../src/tools/types'

/**
 * Policy-gate coverage for `CANVAS_DESTRUCTIVE_TOOLS=block` (BRU-2444, design
 * BRU-2390 §7 / §8.1 / §8.13).
 *
 * `block` is the only control in the BRU-2390 design that offers a *hard*
 * guarantee: the seven irreversible delete tools are never registered, so no
 * amount of model confusion or prompt injection can reach them. These tests
 * therefore assert names rather than counts — a count assertion is satisfied by
 * removing the wrong seven tools.
 */

const TEST_TOKEN = 'test-token'
const TEST_BASE_URL = 'https://canvas.example.com'

function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

/**
 * Every boolean feature gate declared by the catalog, all switched on. Derived
 * from the catalog rather than hard-coded so a future gated domain is covered
 * the day it lands — a guard built only from the default config is blind to
 * exactly the tools an opt-in flag adds.
 */
const ALL_GATES: ToolFeatureFlags = Object.fromEntries(
  toolDomainCatalog.flatMap((registration) =>
    registration.gate ? [[registration.gate, true] as const] : [],
  ),
)

const ROLES: readonly (CanvasRole | undefined)[] = [undefined, 'student', 'teacher', 'admin']

function pseudonymizerOn(): Pseudonymizer {
  return new Pseudonymizer({
    baseUrl: TEST_BASE_URL,
    env: {
      CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
      CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
    },
  })
}

interface FactoryConfig {
  label: string
  role?: CanvasRole
  features: ToolFeatureFlags
  pseudonymizer?: Pseudonymizer
}

/** Every configuration the tool factory can be driven into. */
function factoryConfigs(): FactoryConfig[] {
  const configs: FactoryConfig[] = []
  for (const role of ROLES) {
    for (const gatesOn of [false, true]) {
      configs.push({
        label: `role=${role ?? 'all'} gates=${gatesOn}`,
        role,
        features: gatesOn ? { ...ALL_GATES } : {},
      })
    }
  }
  configs.push({
    label: 'role=all gates=true pseudonymizer=on',
    features: { ...ALL_GATES },
    pseudonymizer: pseudonymizerOn(),
  })
  return configs
}

function namesFor(config: FactoryConfig, mode: 'allow' | 'block' | undefined): string[] {
  const features: ToolFeatureFlags =
    mode === undefined ? config.features : { ...config.features, destructiveTools: mode }
  return getAllTools(mockCanvas(), config.pseudonymizer, config.role, features).map((t) => t.name)
}

/**
 * Measured against `origin/main` @ d8a0afd: `delete_discussion` and
 * `delete_file` both override their domain's `shared` default with
 * `audience: 'educator'`, so the student role sees none of the seven and
 * `block` is a no-op there. Pinning that here means a future audience change
 * that exposes a delete tool to students shows up as a failure in *this* file,
 * next to the policy it affects.
 */
const EXPECTED_REMOVED_BY_ROLE: Record<string, string[]> = {
  all: [
    'delete_appointment_group',
    'delete_assignment',
    'delete_discussion',
    'delete_file',
    'delete_new_quiz',
    'delete_new_quiz_item',
    'delete_page',
  ],
  student: [],
  teacher: [
    'delete_appointment_group',
    'delete_assignment',
    'delete_discussion',
    'delete_file',
    'delete_new_quiz',
    'delete_new_quiz_item',
    'delete_page',
  ],
  admin: [
    'delete_appointment_group',
    'delete_assignment',
    'delete_discussion',
    'delete_file',
    'delete_new_quiz',
    'delete_new_quiz_item',
    'delete_page',
  ],
}

describe('destructive-tools policy gate (catalog level)', () => {
  it.each(factoryConfigs())('$label: block removes exactly the gated set', (config) => {
    const allowed = namesFor(config, 'allow')
    const blocked = namesFor(config, 'block')

    // Anti-vacuity: a factory config that produced nothing would satisfy every
    // set assertion below.
    expect(allowed.length).toBeGreaterThan(50)

    const removed = allowed.filter((n) => !blocked.includes(n)).sort()
    const added = blocked.filter((n) => !allowed.includes(n))

    expect(removed).toEqual(EXPECTED_REMOVED_BY_ROLE[config.role ?? 'all'])
    expect(added).toEqual([])
    // The exclusion is the whole point of §3's argument — assert it survives
    // wherever it is visible at all.
    expect(blocked.includes('delete_peer_review')).toBe(allowed.includes('delete_peer_review'))
  })

  it.each(factoryConfigs())('$label: allow and unset produce an identical tool list', (config) => {
    // `allow` is the v1 default and must be byte-for-byte today's behaviour;
    // ordering matters because it is the order tools reach `tools/list`.
    expect(namesFor(config, 'allow')).toEqual(namesFor(config, undefined))
  })
})

describe('delete_* coverage guard', () => {
  /**
   * A future `delete_*` tool must land inside the registry or inside the
   * documented exclusion list — never silently ungated. `delete_peer_review` is
   * the single deliberate exclusion (design §3: it is the only delete in the
   * set this server can itself undo, via `create_peer_review`).
   *
   * Scope note: this guard keys on the `delete_` name prefix, which is how the
   * design bounds Band A. A destructive tool that removes data under some other
   * name (Band B, e.g. `remove_enrollment`) is out of scope for Phase 1 and is
   * not caught here.
   */
  it('every delete_* tool the server can register is either gated or explicitly excluded', () => {
    const union = new Set<string>()
    for (const config of factoryConfigs()) {
      for (const name of namesFor(config, 'allow')) union.add(name)
    }

    // Anti-vacuity: prove the union actually walked the registry before
    // trusting a set-difference over it.
    expect(union.size).toBeGreaterThan(150)

    const discovered = [...union].filter((n) => n.startsWith('delete_')).sort()
    const accountedFor = [...GATED_DESTRUCTIVE_TOOLS, ...UNGATED_DELETE_TOOLS].sort()

    expect(discovered.length).toBeGreaterThanOrEqual(8)
    expect(discovered).toEqual(accountedFor)
  })
})

describe('destructive-tools policy gate (MCP wire level)', () => {
  const fetchSpy = vi.fn(async () => {
    throw new Error('no test may reach the network')
  })

  beforeAll(() => {
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    fetchSpy.mockClear()
  })

  async function connect(destructiveTools?: 'allow' | 'block'): Promise<Client> {
    const { server } = createCanvasMCPServer({
      token: TEST_TOKEN,
      baseUrl: TEST_BASE_URL,
      destructiveTools,
    })
    const client = new Client({ name: 'destructive-gate-test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return client
  }

  it('block: the gated tools are absent from tools/list', async () => {
    const client = await connect('block')
    const names = (await client.listTools()).tools.map((t) => t.name)

    expect(names.filter((n) => GATED_DESTRUCTIVE_TOOLS.has(n))).toEqual([])
    expect(names).toContain('delete_peer_review')
    expect(names).toContain('list_courses')
    await client.close()
  })

  const DELETE_CALL = {
    name: 'delete_assignment',
    arguments: { course_id: 1, assignment_id: 2 },
  } as const

  it('block: calling a gated tool is refused at the protocol layer with no Canvas call', async () => {
    const client = await connect('block')
    // listTools first: the client resolves tool metadata from the listing, and
    // an un-listed name is rejected by the server's own dispatch table. This is
    // the execution half of the guarantee — the handler does not exist to run.
    await client.listTools()

    const result = await client.callTool(DELETE_CALL)

    expect(result.isError).toBe(true)
    expect((result.content as { text: string }[])[0]?.text).toContain(
      'Tool delete_assignment not found',
    )
    // The whole point: nothing reached Canvas.
    expect(fetchSpy).not.toHaveBeenCalled()
    await client.close()
  })

  it('allow: the identical call reaches the handler and attempts the Canvas DELETE', async () => {
    // Control for the test above. Without it, "no Canvas call" is satisfied by
    // a server that is broken in some unrelated way, and the block assertion
    // proves nothing about the policy.
    const client = await connect('allow')
    await client.listTools()

    const result = await client.callTool(DELETE_CALL)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // The stubbed fetch throws, so the handler surfaces a Canvas failure —
    // evidence the request left the tool layer rather than being refused by it.
    expect(result.isError).toBe(true)
    await client.close()
  })

  it('allow: the gated tools are present and reachable', async () => {
    const client = await connect('allow')
    const names = (await client.listTools()).tools.map((t) => t.name)

    expect([...GATED_DESTRUCTIVE_TOOLS].filter((n) => !names.includes(n))).toEqual([])
    await client.close()
  })

  it('unset: reproduces the allow tool list exactly', async () => {
    const [defaultClient, allowClient] = await Promise.all([connect(), connect('allow')])
    const defaultNames = (await defaultClient.listTools()).tools.map((t) => t.name)
    const allowNames = (await allowClient.listTools()).tools.map((t) => t.name)

    expect(defaultNames).toEqual(allowNames)
    expect(defaultNames).toContain('delete_assignment')
    await Promise.all([defaultClient.close(), allowClient.close()])
  })
})

describe('createCanvasMCPServer destructive-tools validation', () => {
  const ORIGINAL = process.env.CANVAS_DESTRUCTIVE_TOOLS

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CANVAS_DESTRUCTIVE_TOOLS
    else process.env.CANVAS_DESTRUCTIVE_TOOLS = ORIGINAL
  })

  it('honours CANVAS_DESTRUCTIVE_TOOLS when the factory is embedded directly', () => {
    // A library embedder that never goes through `parseArgs` must still get the
    // deployer's policy — otherwise the env var is a no-op in exactly the
    // deployment shape most likely to want it.
    process.env.CANVAS_DESTRUCTIVE_TOOLS = 'block'
    const { server } = createCanvasMCPServer({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    )

    expect(registered.filter((n) => GATED_DESTRUCTIVE_TOOLS.has(n))).toEqual([])
    expect(registered).toContain('delete_peer_review')
  })

  it('throws at construction on an invalid env value rather than registering the deletes', () => {
    process.env.CANVAS_DESTRUCTIVE_TOOLS = 'Block'
    expect(() => createCanvasMCPServer({ token: TEST_TOKEN, baseUrl: TEST_BASE_URL })).toThrow(
      /CANVAS_DESTRUCTIVE_TOOLS/,
    )
  })

  it('an explicit config value overrides the environment', () => {
    process.env.CANVAS_DESTRUCTIVE_TOOLS = 'block'
    const { server } = createCanvasMCPServer({
      token: TEST_TOKEN,
      baseUrl: TEST_BASE_URL,
      destructiveTools: 'allow',
    })
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    )

    expect(registered).toContain('delete_assignment')
  })
})
