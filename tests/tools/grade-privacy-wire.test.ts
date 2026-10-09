import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CanvasClient } from '../../src/canvas'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { registerAllTools } from '../../src/tools'

/**
 * BRU-2848 (follow-up to BRU-2847 / BRU-2842, evidence PR #399 at
 * `0bb1f03714e7cb89ba7a9ca4dd0e1566fe7ab2c2`): `explain_grade` and
 * `project_grade` pseudonymize a named student's identity only when
 * `studentId !== 'self'`. The guard this replaced was
 * `typeof studentId === 'number'` — dead code the moment PR 1b (BRU-2827)
 * made `canvasIdInput()` transform *every* ID input to a canonical **string**
 * before any handler runs, so pseudonymization silently stopped firing for
 * any caller regardless of whether the wire carried a JSON number or a
 * string (BRU-2828 comments 2026-10-09 15:37 / 15:57 UTC).
 *
 * `tests/tools/grade-explanation.test.ts` and `grade-projection.test.ts` call
 * `tool.handler(args)` directly, which never runs the SDK's Zod
 * validation/transform — a fixture can still hand the handler a raw runtime
 * `number`, which is exactly the gap that let the dead guard survive review.
 * The tests below instead connect a real `McpServer` to a real `Client` over
 * `InMemoryTransport`, through `registerAllTools`, so every call actually
 * passes through `canvasIdInput()`'s transform before the handler sees it —
 * mirroring `tests/canvas/id-input-wire.test.ts`'s harness rather than
 * `tests/provenance/boundary.test.ts`'s `registerTool` stub, which captures
 * the pre-SDK-validation handler (see the note there) and would not have
 * caught this regression either.
 */

const COURSE = {
  id: '1',
  name: 'Course',
  apply_assignment_group_weights: false,
  grading_standard_id: null,
}
const ONE_GROUP = [
  {
    id: '1',
    name: 'G',
    position: 1,
    group_weight: 0,
    assignments: [{ id: '1', name: 'A1', points_possible: 10, grading_type: 'points' }],
  },
]
const ONE_SUBMISSION = [{ assignment_id: '1', workflow_state: 'graded', score: 8 }]
const REAL_NAME = 'Alice Student'

function buildCanvas(overrides: { user?: unknown; enrollments?: unknown[] } = {}): CanvasClient {
  const user = overrides.user ?? { id: '1234', name: REAL_NAME }
  return {
    courses: { get: async () => COURSE },
    assignments: { listGroups: async () => ONE_GROUP },
    submissions: {
      listMy: async () => ONE_SUBMISSION,
      listForStudents: async () => ONE_SUBMISSION,
    },
    enrollments: { listForCourse: async () => overrides.enrollments ?? [] },
    users: { getSelf: async () => user, get: async () => user },
  } as unknown as CanvasClient
}

async function connect(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): Promise<Client> {
  const server = new McpServer({ name: 'canvas-grade-privacy-probe', version: '0.0.0' })
  registerAllTools(server, canvas, pseudonymizer)
  const client = new Client({ name: 'grade-privacy-wire-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  await client.listTools()
  return client
}

interface StudentOut {
  student: { id: string; name: string }
}

async function callGradeTool(
  client: Client,
  toolName: 'explain_grade' | 'project_grade',
  args: Record<string, unknown>,
): Promise<StudentOut> {
  const extra = toolName === 'project_grade' ? { target_percentage: 90 } : {}
  const result = (await client.callTool({
    name: toolName,
    arguments: { course_id: '1', ...extra, ...args },
  })) as { isError?: boolean; content?: Array<{ text?: string }> }
  if (result.isError) {
    throw new Error(`${toolName} errored: ${result.content?.[0]?.text}`)
  }
  return JSON.parse(result.content?.[0]?.text ?? '{}') as StudentOut
}

const TOOL_NAMES = ['explain_grade', 'project_grade'] as const

describe.each(TOOL_NAMES)('%s — real MCP wire boundary (BRU-2848)', (toolName) => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'grade-privacy-wire-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  function freshPseudonymizer(enabled: boolean): Pseudonymizer {
    return new Pseudonymizer({
      baseUrl: 'https://school.instructure.com/api/v1',
      rootDir: tmpRoot,
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: enabled ? 'true' : 'false' },
    })
  }

  it('pseudonymizes a canonical STRING student_id when pseudonymization is enabled', async () => {
    const client = await connect(buildCanvas(), freshPseudonymizer(true))
    const result = await callGradeTool(client, toolName, { student_id: '1234' })
    expect(result.student.name).toMatch(/^Student \d+$/)
    expect(result.student.name).not.toBe(REAL_NAME)
    // Identity-preserving: the id survives pseudonymization as the canonical
    // decimal string (BRU-2730 §4.3), not stripped or coerced.
    expect(result.student.id).toBe('1234')
  })

  it('pseudonymizes a student_id sent as a wire NUMBER — proving the Zod transform, not the fixture, produced the string the handler compares against', async () => {
    const client = await connect(buildCanvas(), freshPseudonymizer(true))
    const result = await callGradeTool(client, toolName, { student_id: 1234 })
    expect(result.student.name).toMatch(/^Student \d+$/)
    expect(result.student.id).toBe('1234')
  })

  it('does not pseudonymize "self" (omitted student_id) even with pseudonymization enabled', async () => {
    const client = await connect(
      buildCanvas({ user: { id: '99', name: 'Real Name' } }),
      freshPseudonymizer(true),
    )
    const result = await callGradeTool(client, toolName, {})
    expect(result.student.name).toBe('Real Name')
  })

  it('does not pseudonymize when the pseudonymizer is present but explicitly disabled', async () => {
    const client = await connect(buildCanvas(), freshPseudonymizer(false))
    const result = await callGradeTool(client, toolName, { student_id: '1234' })
    expect(result.student.name).toBe(REAL_NAME)
  })

  it('does not pseudonymize — and does not throw — when no pseudonymizer is wired at all', async () => {
    const client = await connect(buildCanvas(), undefined)
    const result = await callGradeTool(client, toolName, { student_id: '1234' })
    expect(result.student.name).toBe(REAL_NAME)
  })
})
