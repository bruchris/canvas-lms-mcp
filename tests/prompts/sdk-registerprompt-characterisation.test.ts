/**
 * Characterisation test — pins the SDK behaviour that decides our architecture.
 *
 * `src/prompts/index.ts` registers `prompts/list` and `prompts/get` on the
 * underlying `Server` instead of calling `McpServer.registerPrompt`. That is a
 * deliberate departure from the obvious API, and this file is the evidence for
 * it rather than a comment asserting it.
 *
 * The MCP schema makes `arguments` OPTIONAL on a `GetPromptRequest`. The SDK's
 * `registerPrompt` path parses `request.params.arguments` against an object
 * schema built from `argsSchema`, so omitting the key fails validation even
 * when every declared argument is optional — and the SDK's own client omits it
 * when you pass no arguments.
 *
 * If this test ever fails, the SDK has fixed the limitation and
 * `src/prompts/index.ts` can be simplified to use `registerPrompt`. Read the
 * failure as good news, check `tests/prompts/wire.test.ts` still passes, and
 * revisit the design note in
 * docs/superpowers/specs/2026-09-18-issue-355-skills-as-mcp-prompts.md §1.1.
 */
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'

async function serverWithRegisteredPrompt(): Promise<Client> {
  const server = new McpServer({ name: 'characterisation', version: '1.0.0' })
  server.registerPrompt(
    'example',
    {
      title: 'Example',
      description: 'Every argument is optional.',
      argsSchema: { course_id: z.string().optional().describe('Canvas course ID.') },
    },
    () => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'body' } }],
    }),
  )

  const client = new Client({ name: 'characterisation-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('McpServer.registerPrompt argument handling', () => {
  it('advertises the declared argument as optional', async () => {
    const client = await serverWithRegisteredPrompt()
    const { prompts } = await client.listPrompts()

    expect(prompts[0]?.arguments).toEqual([
      { name: 'course_id', description: 'Canvas course ID.', required: false },
    ])
  })

  it('REJECTS a spec-legal getPrompt that omits the arguments key', async () => {
    const client = await serverWithRegisteredPrompt()

    await expect(client.getPrompt({ name: 'example' })).rejects.toThrow(/expected object/i)
  })

  it('accepts the same call once an empty arguments object is supplied', async () => {
    const client = await serverWithRegisteredPrompt()
    const result = await client.getPrompt({ name: 'example', arguments: {} })

    expect(result.messages).toHaveLength(1)
  })
})
