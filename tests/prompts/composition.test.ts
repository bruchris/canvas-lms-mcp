/**
 * The additive-compatibility contract: an in-process embedder that builds a
 * Canvas server and then calls `McpServer.registerPrompt()` for its own prompt
 * must end up with both surfaces working, and none of the three invariants this
 * feature owns — per-entry `_meta`, rejection of an undeclared argument, role
 * filtering — may weaken because a custom prompt exists.
 *
 * `tests/prompts/wire.test.ts` pins those invariants on a Canvas-only server;
 * this file pins them on a composed one.
 */
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { registerAllPrompts } from '../../src/prompts'
import { PROMPT_META_KEY } from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { createCanvasMCPServer } from '../../src/server'
import type { CanvasRole } from '../../src/tools/types'

const CUSTOM = 'embedder-quarter-report'

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

/** A prompt the embedding application owns, registered through the public SDK API. */
function registerCustomPrompt(server: McpServer, name: string = CUSTOM): void {
  server.registerPrompt(
    name,
    {
      title: 'Quarter Report',
      description: 'A prompt the embedding application owns.',
      argsSchema: { term: z.string().optional().describe('Reporting term.') },
    },
    ({ term }) => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: `report ${term ?? 'all'}` },
        },
      ],
    }),
  )
}

function canvasServer(role?: CanvasRole): McpServer {
  const { server } = createCanvasMCPServer({
    token: 'test-token',
    baseUrl: 'https://canvas.example.com',
    ...(role ? { role } : {}),
  })
  return server
}

describe('registerPrompt after Canvas server setup', () => {
  it('does not throw a duplicate-handler error', () => {
    const server = canvasServer()
    expect(() => registerCustomPrompt(server)).not.toThrow()
  })

  it('lists the custom prompt alongside every built-in', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    const { prompts } = await client.listPrompts()
    const names = prompts.map((prompt) => prompt.name)

    expect(prompts).toHaveLength(GENERATED_SKILLS.length + 1)
    expect(names).toContain(CUSTOM)
    for (const skill of GENERATED_SKILLS) expect(names).toContain(skill.name)
  })

  it('serves both a built-in and the custom prompt through prompts/get', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    const builtIn = await client.getPrompt({ name: 'canvas-grading-pass' })
    const custom = await client.getPrompt({ name: CUSTOM, arguments: { term: 'Fall' } })

    expect((builtIn.messages[0]?.content as { text: string }).text).toContain(
      '# Canvas Grading Pass',
    )
    expect((custom.messages[0]?.content as { text: string }).text).toBe('report Fall')
  })

  it('works when the embedder registers after the transport is connected', async () => {
    const server = canvasServer()
    const client = await connect(server)

    expect(() => registerCustomPrompt(server)).not.toThrow()

    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name)).toContain(CUSTOM)
    const result = await client.getPrompt({ name: CUSTOM })
    expect((result.messages[0]?.content as { text: string }).text).toBe('report all')
  })

  it('refuses a custom prompt that would shadow a built-in name', () => {
    const server = canvasServer()
    expect(() => registerCustomPrompt(server, 'canvas-grading-pass')).toThrow(/already registered/i)
  })
})

describe('invariants survive composition', () => {
  it('keeps namespaced _meta on the built-in listing entries', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    const { prompts } = await client.listPrompts()
    const grading = prompts.find((prompt) => prompt.name === 'canvas-grading-pass')

    expect(grading?._meta?.[PROMPT_META_KEY]).toEqual({
      audience: 'educator',
      writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
    })
  })

  it('leaves the custom prompt entry undecorated', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    const { prompts } = await client.listPrompts()
    const custom = prompts.find((prompt) => prompt.name === CUSTOM)

    expect(custom?.title).toBe('Quarter Report')
    expect(custom?._meta?.[PROMPT_META_KEY]).toBeUndefined()
    expect(custom?.arguments).toEqual([
      { name: 'term', description: 'Reporting term.', required: false },
    ])
  })

  it('still rejects an undeclared argument on a built-in with -32602', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    await expect(
      client.getPrompt({ name: 'canvas-grading-pass', arguments: { bogus: 'x' } }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('bogus') })
  })

  it('still rejects an unknown prompt name with -32602', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    await expect(client.getPrompt({ name: 'no-such-prompt' })).rejects.toMatchObject({
      code: -32602,
      message: expect.stringMatching(/not found/i),
    })
  })

  it('still applies the role filter to built-ins while serving the custom prompt', async () => {
    const server = canvasServer('student')
    registerCustomPrompt(server)
    const client = await connect(server)

    const { prompts } = await client.listPrompts()

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'canvas-student-todo',
      'canvas-week-plan',
      CUSTOM,
    ])
    await expect(client.getPrompt({ name: 'canvas-grading-pass' })).rejects.toThrow(/not found/i)
  })

  it('still carries _meta on a built-in get result', async () => {
    const server = canvasServer()
    registerCustomPrompt(server)
    const client = await connect(server)

    const result = await client.getPrompt({ name: 'canvas-grading-pass' })

    expect(result._meta?.[PROMPT_META_KEY]).toEqual({
      audience: 'educator',
      writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
    })
  })
})

describe('advertised prompts capability', () => {
  // Characterisation. Going through `registerPrompt` means the SDK owns the
  // declaration, and `listChanged: true` is now the truthful value: an embedder
  // can add or remove a prompt at any time and the SDK emits the notification.
  it('declares listChanged: true, because the surface really can change', async () => {
    const client = await connect(canvasServer())
    expect(client.getServerCapabilities()?.prompts).toEqual({ listChanged: true })
  })

  it('declares no prompts capability at all when the catalog is empty', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    server.registerTool('noop', { description: 'noop', inputSchema: {} }, () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }))
    registerAllPrompts(server, undefined, [])
    const client = await connect(server)

    expect(client.getServerCapabilities()?.prompts).toBeUndefined()
  })

  it('leaves the surface entirely to the embedder when the catalog is empty', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    registerAllPrompts(server, undefined, [])
    registerCustomPrompt(server)
    const client = await connect(server)

    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name)).toEqual([CUSTOM])
  })
})

describe('ordering requirement', () => {
  // The composition captures the SDK's own handlers as the SDK installs them, so
  // it has to be the call that triggers that installation. If an embedder got
  // there first there is nothing to capture, and silently dropping their prompts
  // from the listing is the one outcome worth crashing over.
  it('fails loudly when the embedder registered a prompt first', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    registerCustomPrompt(server)

    expect(() => registerAllPrompts(server)).toThrow(/before/i)
  })

  it('names both calls in that error, so the fix is obvious from the message', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    registerCustomPrompt(server)

    // One invocation, asserted twice: a second call would hit the SDK's
    // duplicate-name error instead, because the first already registered.
    const message = (() => {
      try {
        registerAllPrompts(server)
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()

    expect(message).toContain('registerAllPrompts')
    expect(message).toContain('registerPrompt')
  })
})
