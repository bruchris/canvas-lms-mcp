/**
 * Characterisation test — pins the SDK behaviour that decides our architecture.
 *
 * `src/prompts/index.ts` registers every built-in through
 * `McpServer.registerPrompt` and then replaces the two handlers the SDK installs
 * with composing ones, so an embedder's later `registerPrompt` still works. This
 * file is the evidence for *why* it replaces them rather than a comment
 * asserting it.
 *
 * **2026-10-05, merging current `main` (SDK 1.30.0 -> 1.32.0, PR #375).** The
 * original reason this file recorded is now FIXED: on 1.30.0, `registerPrompt`
 * parsed `request.params.arguments` against an object schema, so omitting the
 * key — which the MCP schema allows, and which the SDK's own client does by
 * default — failed validation. On 1.32.0 that call succeeds. The first test
 * below is inverted and now guards against the SDK regressing.
 *
 * The declared dependency floor was raised to `^1.32.0` to match (BRU-2761), so the
 * inverted test is a statement about the lowest version a consumer can resolve
 * and not only about what the lockfile happens to install.
 * `tests/prompts/sdk-floor.test.ts` is what keeps that true.
 *
 * Owning the two handlers is still required, for two reasons measured on 1.32.0.
 * Note that these are reasons to *compose over* the SDK's handlers, not reasons
 * to keep the SDK out of the registry — `src/prompts/index.ts` does both, and
 * `tests/prompts/composition.test.ts` pins the coexistence that buys.
 *
 *   1. `registerPrompt`'s config accepts only `title`, `description` and
 *      `argsSchema`, and the SDK's `prompts/list` handler emits no `_meta` per
 *      entry. The whole point of this feature is publishing each skill's
 *      audience, arguments and derived write tools under a namespaced `_meta`
 *      key on the listing, so `registerPrompt` cannot serve it at all.
 *   2. `registerPrompt` silently accepts an argument the prompt never declared.
 *      Our handler answers `-32602` so a client typo is not swallowed.
 *
 * `tests/prompts/wire.test.ts` pins the positive half of both on our own
 * implementation. If reason 1 ever disappears — an SDK that lets `registerPrompt`
 * carry `_meta` onto the listing — the handler-replacement decision in
 * docs/superpowers/specs/2026-09-18-issue-355-skills-as-mcp-prompts.md §1.1 is
 * worth revisiting; until then this file is why it stands.
 */
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'

const PROBE_META = { 'io.github.bruchris/probe': 'present-on-the-get-result' }

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
      _meta: PROBE_META,
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

  it('ACCEPTS a spec-legal getPrompt that omits the arguments key (fixed in SDK 1.32.0)', async () => {
    const client = await serverWithRegisteredPrompt()

    const result = await client.getPrompt({ name: 'example' })

    expect(result.messages).toHaveLength(1)
  })

  it('accepts the same call once an empty arguments object is supplied', async () => {
    const client = await serverWithRegisteredPrompt()
    const result = await client.getPrompt({ name: 'example', arguments: {} })

    expect(result.messages).toHaveLength(1)
  })
})

describe('why registerPrompt still cannot serve this feature', () => {
  it('emits no per-entry _meta on prompts/list, so the skill metadata has nowhere to go', async () => {
    const client = await serverWithRegisteredPrompt()
    const { prompts } = await client.listPrompts()

    // The get result can carry _meta — the listing cannot, and the listing is
    // the surface a client reads to decide which prompt to call.
    expect((await client.getPrompt({ name: 'example' }))._meta).toEqual(PROBE_META)
    expect(prompts[0]?._meta).toBeUndefined()
  })

  it('silently accepts an argument the prompt never declared', async () => {
    const client = await serverWithRegisteredPrompt()

    const result = await client.getPrompt({
      name: 'example',
      arguments: { not_a_declared_argument: 'x' },
    })

    expect(result.messages).toHaveLength(1)
  })
})
