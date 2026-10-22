import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildPromptDefinitions } from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import type { GeneratedSkill } from '../../src/prompts/types'
import { createCanvasMCPServer } from '../../src/server'
import { getAllTools } from '../../src/tools'
import { CANVAS_TOOLSETS, type CanvasToolset } from '../../src/tools/toolsets'
import { CanvasClient } from '../../src/canvas'

/**
 * Prompt filtering against the tools a server actually registered
 * (GH #442 Phase 1, BRU-3128).
 *
 * One mechanism covers every narrowing control — toolsets, read-only, the
 * destructive gate, the opt-in domain gates and role — because the filter reads
 * the registered set rather than reimplementing any of them.
 */

const canvas = new CanvasClient({ token: 't', baseUrl: 'https://canvas.example.com' })
const BASE = { token: 't', baseUrl: 'https://canvas.example.com', sharedAcrossCallers: false }

async function promptNames(config: Parameters<typeof createCanvasMCPServer>[0]) {
  const { server } = createCanvasMCPServer(config)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    (server as McpServer).connect(serverTransport),
    client.connect(clientTransport),
  ])
  const { prompts } = await client.listPrompts()
  return prompts.map((prompt) => prompt.name).sort()
}

function registeredNames(features: Parameters<typeof getAllTools>[3]): Set<string> {
  return new Set(getAllTools(canvas, undefined, undefined, features).map((tool) => tool.name))
}

describe('GeneratedSkill.tools', () => {
  it('is a superset of writeTools for every skill — one scan, two outputs', () => {
    expect(GENERATED_SKILLS.length).toBeGreaterThan(10)
    for (const skill of GENERATED_SKILLS) {
      for (const name of skill.writeTools) {
        expect(skill.tools, `${skill.name}: ${name}`).toContain(name)
      }
    }
  })

  it('names only real registered tools, and is sorted and deduped', () => {
    const real = registeredNames({ assignmentSubmission: true, destructiveTools: 'allow' })
    let total = 0
    for (const skill of GENERATED_SKILLS) {
      for (const name of skill.tools) expect(real.has(name), `${skill.name}: ${name}`).toBe(true)
      expect([...skill.tools]).toEqual([...new Set(skill.tools)].sort())
      total += skill.tools.length
    }
    // Anti-vacuity: an empty derivation would satisfy every assertion above.
    expect(total).toBeGreaterThan(100)
  })

  it('excludes resolve_pseudonym, which no skill can require', () => {
    // It is conditional on the deployer enabling reverse lookup, so a body
    // naming it must stay inert text rather than hide the workflow everywhere.
    for (const skill of GENERATED_SKILLS) {
      expect(skill.tools).not.toContain('resolve_pseudonym')
    }
  })
})

describe('buildPromptDefinitions — availability filter', () => {
  it('omitting availableToolNames keeps every skill (the docs/count path)', () => {
    expect(buildPromptDefinitions()).toHaveLength(GENERATED_SKILLS.length)
    expect(buildPromptDefinitions(undefined, GENERATED_SKILLS, undefined)).toHaveLength(
      GENERATED_SKILLS.length,
    )
  })

  it('the full registry hides nothing — the default surface is unchanged', () => {
    const full = registeredNames({ assignmentSubmission: true, destructiveTools: 'allow' })

    expect(buildPromptDefinitions(undefined, GENERATED_SKILLS, full).map((d) => d.name)).toEqual(
      buildPromptDefinitions().map((d) => d.name),
    )
  })

  it('drops a skill whose named tool is not registered, and keeps the others', () => {
    const skills: GeneratedSkill[] = [
      {
        name: 'needs-grading',
        title: 'Needs Grading',
        description: 'd',
        argumentNames: [],
        audience: 'educator',
        writeTools: ['grade_submission'],
        tools: ['grade_submission', 'list_assignments'],
        body: '# Needs Grading',
      },
      {
        name: 'reads-only',
        title: 'Reads Only',
        description: 'd',
        argumentNames: [],
        audience: 'educator',
        writeTools: [],
        tools: ['list_assignments'],
        body: '# Reads Only',
      },
    ]

    const available = new Set(['list_assignments'])
    expect(buildPromptDefinitions(undefined, skills, available).map((d) => d.name)).toEqual([
      'reads-only',
    ])
    // Control: with both tools available, neither is dropped.
    expect(
      buildPromptDefinitions(
        undefined,
        skills,
        new Set(['list_assignments', 'grade_submission']),
      ).map((d) => d.name),
    ).toEqual(['needs-grading', 'reads-only'])
  })

  it('a skill naming no registered tool is always visible', () => {
    const skills: GeneratedSkill[] = [
      {
        name: 'pure-advice',
        title: 'Pure Advice',
        description: 'd',
        argumentNames: [],
        audience: 'shared',
        writeTools: [],
        tools: [],
        body: '# Pure Advice',
      },
    ]

    expect(buildPromptDefinitions(undefined, skills, new Set<string>()).map((d) => d.name)).toEqual(
      ['pure-advice'],
    )
  })

  it('composes with the role filter — both must pass', () => {
    const skills: GeneratedSkill[] = [
      {
        name: 'admin-only',
        title: 'Admin Only',
        description: 'd',
        argumentNames: [],
        audience: 'admin',
        writeTools: [],
        tools: ['list_assignments'],
        body: '# Admin Only',
      },
    ]

    // Audience passes, tool missing.
    expect(buildPromptDefinitions('admin', skills, new Set<string>())).toHaveLength(0)
    // Tool present, audience fails.
    expect(buildPromptDefinitions('student', skills, new Set(['list_assignments']))).toHaveLength(0)
    // Both pass.
    expect(buildPromptDefinitions('admin', skills, new Set(['list_assignments']))).toHaveLength(1)
  })
})

describe('prompts/list over the wire — per control', () => {
  it('default invocation advertises every skill, byte-for-byte', async () => {
    expect(await promptNames(BASE)).toEqual(GENERATED_SKILLS.map((s) => s.name).sort())
  })

  it('an all-toolsets selection equals unset', async () => {
    expect(await promptNames({ ...BASE, toolsets: new Set(CANVAS_TOOLSETS) })).toEqual(
      await promptNames(BASE),
    )
  })

  it('the default tool surface is unchanged, and `all` reproduces it exactly', async () => {
    // The headline acceptance criterion, at the wire: `tools/list` names for a
    // default invocation, for an explicit all-nine selection, and for an empty
    // set, must all be the same list.
    async function toolNames(config: Parameters<typeof createCanvasMCPServer>[0]) {
      const { server } = createCanvasMCPServer(config)
      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([
        (server as McpServer).connect(serverTransport),
        client.connect(clientTransport),
      ])
      return (await client.listTools()).tools.map((tool) => tool.name).sort()
    }

    const base = await toolNames(BASE)
    expect(base.length).toBeGreaterThan(150)
    expect(await toolNames({ ...BASE, toolsets: new Set(CANVAS_TOOLSETS) })).toEqual(base)
    expect(await toolNames({ ...BASE, toolsets: new Set<CanvasToolset>() })).toEqual(base)
    expect(await toolNames({ ...BASE, readOnly: false })).toEqual(base)
  })

  it('every role surface is unchanged by the new filter', async () => {
    // The original objection to checking a skill's tools was that it would make
    // a workflow vanish from a role it is written for. Measured: it does not.
    for (const role of ['student', 'teacher', 'admin'] as const) {
      expect(await promptNames({ ...BASE, role }), role).toEqual(
        buildPromptDefinitions(role)
          .map((d) => d.name)
          .sort(),
      )
    }
  })

  it('a narrow toolset hides the workflows whose tools are gone', async () => {
    const narrow = await promptNames({
      ...BASE,
      toolsets: new Set<CanvasToolset>(['core', 'grading']),
    })
    const full = await promptNames(BASE)

    expect(narrow.length).toBeGreaterThan(0)
    expect(narrow.length).toBeLessThan(full.length)
    for (const name of narrow) expect(full).toContain(name)
    // canvas-grading-pass spans core+grading, so it survives exactly this pair
    // and not `grading` alone — which is the point of the next test.
    expect(narrow).toContain('canvas-grading-pass')
  })

  it('a selection that leaves no workflow declares no prompts capability at all', async () => {
    // A consequence worth pinning rather than discovering: most workflows span
    // two to four toolsets, so a single narrow toolset can empty the prompt
    // surface. `registerAllPrompts` then registers nothing, and the server
    // honestly advertises no `prompts` capability instead of an empty list —
    // so `prompts/list` answers -32601, exactly as it does for an embedder that
    // passes no skills.
    const { server } = createCanvasMCPServer({
      ...BASE,
      toolsets: new Set<CanvasToolset>(['grading']),
    })
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([
      (server as McpServer).connect(serverTransport),
      client.connect(clientTransport),
    ])

    expect(client.getServerCapabilities()?.prompts).toBeUndefined()
    await expect(client.listPrompts()).rejects.toThrow(/-32601|Method not found/)

    // Control: the same server still serves its tools, so the empty prompt
    // surface is the filter working and not a broken registration.
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
  })

  it('read-only hides every workflow that drives a write tool', async () => {
    const readOnly = new Set(await promptNames({ ...BASE, readOnly: true }))
    const full = await promptNames(BASE)

    const hidden = full.filter((name) => !readOnly.has(name))
    expect(hidden.length).toBeGreaterThan(0)

    // Each hidden workflow names at least one write tool, and each surviving
    // one names none — the filter is exactly "advertises an absent tool".
    const byName = new Map(GENERATED_SKILLS.map((skill) => [skill.name, skill]))
    for (const name of hidden) {
      expect(byName.get(name)?.writeTools.length, name).toBeGreaterThan(0)
    }
    for (const name of readOnly) {
      expect(byName.get(name)?.writeTools.length, name).toBe(0)
    }
  })

  it('no advertised prompt ever names a tool the same server did not register', async () => {
    // The acceptance criterion itself, checked across every control at once.
    const configs: Array<Parameters<typeof createCanvasMCPServer>[0]> = [
      BASE,
      { ...BASE, readOnly: true },
      { ...BASE, destructiveTools: 'block' },
      { ...BASE, role: 'student' },
      { ...BASE, role: 'teacher' },
      { ...BASE, role: 'admin' },
      ...CANVAS_TOOLSETS.map((toolset) => ({
        ...BASE,
        toolsets: new Set<CanvasToolset>([toolset]),
      })),
      { ...BASE, toolsets: new Set<CanvasToolset>(['grading']), role: 'teacher', readOnly: true },
    ]

    const byName = new Map(GENERATED_SKILLS.map((skill) => [skill.name, skill]))
    let checked = 0
    for (const config of configs) {
      const { server } = createCanvasMCPServer(config)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = new Set(Object.keys((server as any)._registeredTools))
      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([
        (server as McpServer).connect(serverTransport),
        client.connect(clientTransport),
      ])
      // A config can legitimately leave no workflow at all, in which case there
      // is no `prompts` capability to query — and nothing advertised, so
      // nothing to check.
      if (client.getServerCapabilities()?.prompts === undefined) continue
      const { prompts } = await client.listPrompts()

      for (const prompt of prompts) {
        for (const name of byName.get(prompt.name)?.tools ?? []) {
          expect(registered.has(name), `${prompt.name} -> ${name}`).toBe(true)
          checked++
        }
      }
    }

    // Anti-vacuity: if every config had advertised zero prompts, or every skill
    // derived zero tools, the loop above would assert nothing.
    expect(checked).toBeGreaterThan(200)
  })
})
