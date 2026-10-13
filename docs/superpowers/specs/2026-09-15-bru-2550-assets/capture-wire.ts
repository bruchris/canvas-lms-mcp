// BRU-2550 wire capture. Records the exact HTTP request that the SHIPPED
// `submit_rubric_assessment` handler sends, so the request body can be fed to
// canvas-source-probe.rb (case A1).
//
// Safe by construction:
//   - `fetch` is replaced before anything runs, so no network I/O happens and no
//     real Canvas instance can be reached. Any host other than the placeholder
//     one aborts the run.
//   - The token is a dummy literal, not read from the environment.
//   - The Authorization header is dropped from the record, so wire.json holds no
//     credential even if the dummy were swapped for a real one.
//
// Run from the repository root, on a tree where the tool still takes the legacy
// input (`association_id` + `data`), e.g. origin/main @ db2c5e2 or this docs-only
// branch. After the implementation PR merges, the legacy args fail input
// validation, no request is sent, and this script exits non-zero.
//
//   WORK=<dir> pnpm exec tsx docs/superpowers/specs/2026-09-15-bru-2550-assets/capture-wire.ts
//
// Writes <WORK>/wire.json as { calls: [{ method, url, headers, body }], result }.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvasMCPServer } from '../../../../src/server'

const WORK = process.env.WORK
if (!WORK) {
  throw new Error(
    'Set WORK to an output directory outside the repository (wire.json is written there).',
  )
}

const DUMMY_TOKEN = 'dummy-token-not-a-secret'
const BASE_URL = 'https://canvas.example.com'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}
const calls: Call[] = []

globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input)
  if (new URL(url).origin !== BASE_URL) {
    throw new Error(`Refusing to contact ${url}: only ${BASE_URL} is allowed in this capture.`)
  }
  const headers = Object.fromEntries(
    Object.entries((init.headers ?? {}) as Record<string, string>).filter(
      ([name]) => name.toLowerCase() !== 'authorization',
    ),
  )
  calls.push({
    method: (init.method ?? 'GET').toUpperCase(),
    url,
    headers,
    body: typeof init.body === 'string' ? init.body : null,
  })
  // What Canvas answers when rubric_assessment[user_id] is missing (probe A1).
  return new Response(
    JSON.stringify({ errors: [{ message: 'The specified resource does not exist.' }] }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  )
}) as typeof fetch

const { server } = createCanvasMCPServer({ baseUrl: BASE_URL, token: DUMMY_TOKEN })
const registered = (
  server as unknown as {
    _registeredTools: Record<
      string,
      { handler: (args: unknown, extra: unknown) => Promise<unknown> }
    >
  }
)._registeredTools
const tool = registered['submit_rubric_assessment']
if (!tool) throw new Error('submit_rubric_assessment is not registered.')

const result = await tool.handler(
  {
    course_id: 100,
    association_id: 5,
    data: [
      { criterion_id: '_1001', points: 4, comments: 'Good' },
      { criterion_id: '_1002', points: 5, comments: 'Complete' },
      { criterion_id: '_1003', points: 2, comments: 'n/a' },
    ],
  },
  {},
)

if (calls.length === 0) {
  console.error(
    'No request was captured: this tree no longer takes the legacy input. ' +
      'Check out origin/main @ db2c5e2 (or this branch) to reproduce.',
  )
  process.exit(1)
}

mkdirSync(WORK, { recursive: true })
writeFileSync(join(WORK, 'wire.json'), JSON.stringify({ calls, result }, null, 2) + '\n')
console.log(JSON.stringify({ calls, result }, null, 2))
