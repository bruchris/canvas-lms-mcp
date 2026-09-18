import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerAllPrompts } from '../../src/prompts'
import { buildPromptDefinitions, PROMPT_META_KEY } from '../../src/prompts/catalog'
import { GENERATED_SKILLS } from '../../src/prompts/skills.generated'
import { createCanvasMCPServer } from '../../src/server'
import { ROLE_VISIBILITY } from '../../src/tools/roles'
import type { CanvasRole } from '../../src/tools/types'

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function promptServer(role?: CanvasRole): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  registerAllPrompts(server, role)
  return connect(server)
}

function textOf(result: { messages: { content: unknown }[] }): string {
  const content = result.messages[0]?.content as { type: string; text: string }
  expect(content.type).toBe('text')
  return content.text
}

describe('prompts/list', () => {
  it('advertises every skill with title, description and arguments', async () => {
    const client = await promptServer()
    const { prompts } = await client.listPrompts()

    expect(prompts).toHaveLength(GENERATED_SKILLS.length)
    const grading = prompts.find((prompt) => prompt.name === 'canvas-grading-pass')
    expect(grading?.title).toBe('Canvas Grading Pass')
    expect(grading?.description).toContain('Uses write tools:')
    expect(grading?.arguments).toEqual([
      {
        name: 'course_id',
        description: 'Canvas course ID to run this workflow against. Omit to be asked.',
        required: false,
      },
      {
        name: 'assignment_id',
        description: 'Canvas assignment ID to scope to. Omit to be asked.',
        required: false,
      },
    ])
  })

  it('carries namespaced _meta through the wire', async () => {
    const client = await promptServer()
    const { prompts } = await client.listPrompts()
    const grading = prompts.find((prompt) => prompt.name === 'canvas-grading-pass')

    expect(grading?._meta?.[PROMPT_META_KEY]).toEqual({
      audience: 'educator',
      writeTools: ['comment_on_submission', 'grade_submission', 'submit_rubric_assessment'],
    })
  })
})

describe('prompts/get', () => {
  it('succeeds when the client omits the arguments key entirely', async () => {
    // Regression gate. `arguments` is optional in the MCP schema, but
    // McpServer.registerPrompt parses it against an object schema, so a prompt
    // with a declared argsSchema rejects this call. This test fails against any
    // registerPrompt-based implementation — that is the point.
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-grading-pass' })

    expect(textOf(result)).toContain('# Canvas Grading Pass')
    expect(textOf(result)).not.toContain('Context supplied by the user')
  })

  it('accepts an empty arguments object', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-grading-pass', arguments: {} })
    expect(textOf(result)).not.toContain('Context supplied by the user')
  })

  it('prepends a context block for supplied arguments', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({
      name: 'canvas-grading-pass',
      arguments: { course_id: '42' },
    })

    expect(textOf(result)).toContain('Context supplied by the user:\n- course_id: 42\n')
  })

  it('returns the body byte-identical to the generated skill', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-week-plan' })
    const skill = GENERATED_SKILLS.find((entry) => entry.name === 'canvas-week-plan')

    expect(textOf(result)).toBe(skill?.body)
  })

  it('returns one user-role message and the composed description', async () => {
    const client = await promptServer()
    const result = await client.getPrompt({ name: 'canvas-week-plan' })
    const expected = buildPromptDefinitions().find((entry) => entry.name === 'canvas-week-plan')

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')
    expect(result.description).toBe(expected?.description)
  })

  it('rejects an unknown argument name', async () => {
    const client = await promptServer()
    await expect(
      client.getPrompt({ name: 'canvas-grading-pass', arguments: { bogus: 'x' } }),
    ).rejects.toThrow(/bogus/)
  })

  it('rejects an unknown prompt name', async () => {
    const client = await promptServer()
    await expect(client.getPrompt({ name: 'no-such-prompt' })).rejects.toThrow(/not found/i)
  })

  it('rejects a prompt the configured role cannot see', async () => {
    const client = await promptServer('student')
    await expect(client.getPrompt({ name: 'canvas-grading-pass' })).rejects.toThrow(/not found/i)
  })
})

describe('role filtering', () => {
  it.each(['student', 'teacher', 'admin'] as const)(
    'registers exactly the prompts %s can see',
    async (role: CanvasRole) => {
      const client = await promptServer(role)
      const visible = ROLE_VISIBILITY[role]
      const expected = GENERATED_SKILLS.filter((skill) => visible.has(skill.audience))
        .map((skill) => skill.name)
        .sort()

      const { prompts } = await client.listPrompts()
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual(expected)
    },
  )

  it('declares no prompts capability when the catalog is empty', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    server.registerTool('noop', { description: 'noop', inputSchema: {} }, () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }))
    registerAllPrompts(server, undefined, [])
    const client = await connect(server)

    expect(client.getServerCapabilities()?.prompts).toBeUndefined()
    await expect(client.listPrompts()).rejects.toThrow(/method not found/i)
  })
})

describe('createCanvasMCPServer', () => {
  it('advertises prompts alongside tools and resources', async () => {
    const { server } = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    const client = await connect(server)
    const capabilities = client.getServerCapabilities()

    expect(capabilities?.prompts).toBeDefined()
    expect(capabilities?.tools).toBeDefined()
    expect(capabilities?.resources).toBeDefined()
    expect((await client.listPrompts()).prompts).toHaveLength(GENERATED_SKILLS.length)
  })

  it('applies the configured role to prompts as well as tools', async () => {
    const { server } = createCanvasMCPServer({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      role: 'student',
    })
    const client = await connect(server)
    const { prompts } = await client.listPrompts()

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'canvas-student-todo',
      'canvas-week-plan',
    ])
  })
})
