import { vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CanvasClient } from '../../../src/canvas'
import type { Pseudonymizer } from '../../../src/pseudonym/pseudonymizer'
import { registerAllTools } from '../../../src/tools'

/**
 * The fixture registry behind the structured-output gates (BRU-2418 §7.2, §7.5).
 *
 * Every tool that declares an `output` contract must appear here, and the
 * completeness gate in `output-contract.test.ts` derives the expected key set
 * from the live tool registry — so a migrated tool without a fixture fails CI.
 * Keeping the fixtures *here* rather than as a bare list of names is what makes
 * that gate real: a name cannot be added to satisfy the gate without also
 * supplying the payload the round-trip runs against.
 */

/**
 * A Canvas page carrying fields our schema does not declare. `front_page`,
 * `hide_from_students` and `last_edited_by` are real Canvas response fields
 * absent from `CanvasPage`; `created_at` uses a UTC-offset timestamp rather
 * than a `Z` suffix, which is the form `z.iso.datetime()` would have rejected.
 */
export const driftedPage = {
  page_id: 1,
  url: 'welcome-page',
  title: 'Welcome Page',
  body: '<p>Welcome!</p>',
  published: true,
  created_at: '2026-01-01T09:00:00+02:00',
  updated_at: '2026-01-01T00:00:00Z',
  editing_roles: 'teachers',
  front_page: false,
  hide_from_students: false,
  last_edited_by: { id: 7, display_name: 'A Teacher' },
}

export type PagesOverrides = Partial<
  Record<'list' | 'get' | 'create' | 'update' | 'delete', unknown>
>

export function buildPagesCanvas(overrides: PagesOverrides = {}): CanvasClient {
  return {
    pages: {
      list: vi.fn().mockResolvedValue([driftedPage]),
      get: vi.fn().mockResolvedValue(driftedPage),
      create: vi.fn().mockResolvedValue(driftedPage),
      update: vi.fn().mockResolvedValue(driftedPage),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    modules: {
      get: vi.fn().mockResolvedValue({ id: 9, name: 'Module One', unlock_at: null }),
    },
  } as unknown as CanvasClient
}

/**
 * Dual-mode coverage for a fixture whose tool also appears in
 * `PSEUDONYMIZER_WRAPPED_TOOLS` (BRU-2418 §5.2/§7.2, BRU-2426). Required
 * (non-null) for exactly that intersection — enforced by the completeness
 * gate in `output-contract.test.ts`, not chosen freely per fixture.
 */
export interface PseudonymizationModeFixture {
  /** A Canvas mock exercising the field expected to change once pseudonymized. */
  buildCanvas: () => CanvasClient
  /** A Pseudonymizer for the given mode; `enabled` maps to `CANVAS_PSEUDONYMIZE_STUDENTS`. */
  buildPseudonymizer: (enabled: boolean) => Pseudonymizer
  /** Reads the field that must differ between the disabled and enabled runs. */
  readPseudonymizedField: (structuredContent: Record<string, unknown>) => unknown
}

export interface OutputFixture {
  /** Arguments for the tool call. */
  args: Record<string, unknown>
  /** A Canvas client mock that serves this fixture. */
  buildCanvas: () => CanvasClient
  /**
   * Where the envelope puts the handler's value, or `null` when the value *is*
   * the structured content. Drives the surface-agreement assertion.
   */
  envelopeKey: string | null
  /**
   * Reads a field the payload carries but the schema does not declare, at the
   * level where Canvas drift has to be tolerated. `null` only for shapes this
   * server authors itself, where strictness is the point and drift is a bug.
   *
   * A non-null reader is what stops the round-trip going vacuous: without it a
   * future `z.looseObject` → `z.object` regression would still pass.
   */
  readUndeclared: ((structuredContent: Record<string, unknown>) => unknown) | null
  /**
   * Pseudonymization-mode coverage, required exactly when this tool's name is
   * also in `PSEUDONYMIZER_WRAPPED_TOOLS`. `null` for every fixture outside
   * that intersection — currently all of them, since `pages` carries no
   * student PII.
   */
  pseudonymization: PseudonymizationModeFixture | null
}

export const OUTPUT_FIXTURES: Record<string, OutputFixture> = {
  list_pages: {
    args: { course_id: 1 },
    buildCanvas: () => buildPagesCanvas(),
    envelopeKey: 'pages',
    readUndeclared: (structured) =>
      (structured.pages as Record<string, unknown>[])[0].hide_from_students,
    pseudonymization: null,
  },
  get_page: {
    args: { course_id: 1, page_url: 'welcome-page' },
    buildCanvas: () => buildPagesCanvas(),
    envelopeKey: null,
    readUndeclared: (structured) => structured.hide_from_students,
    pseudonymization: null,
  },
  create_page: {
    args: { course_id: 1, title: 'New Page' },
    buildCanvas: () => buildPagesCanvas(),
    envelopeKey: null,
    readUndeclared: (structured) => structured.hide_from_students,
    pseudonymization: null,
  },
  update_page: {
    args: { course_id: 1, page_url: 'welcome-page', title: 'Renamed' },
    buildCanvas: () => buildPagesCanvas(),
    envelopeKey: null,
    readUndeclared: (structured) => structured.hide_from_students,
    pseudonymization: null,
  },
  delete_page: {
    args: { course_id: 1, page_url: 'welcome-page' },
    buildCanvas: () => buildPagesCanvas(),
    envelopeKey: null,
    // Authored by the handler, not by Canvas — strict on purpose, so there is
    // no undeclared field to tolerate. `output-contract.test.ts` asserts the
    // strictness separately.
    readUndeclared: null,
    pseudonymization: null,
  },
}

/**
 * A connected client that has already listed tools — i.e. one whose output
 * validators are armed.
 *
 * The `listTools()` call is load-bearing, not stylistic: the SDK client
 * populates `_cachedToolOutputValidators` from the `tools/list` response, so a
 * client that calls a tool without listing first validates nothing and every
 * downstream assertion passes vacuously against a broken payload.
 */
export async function connectArmedClient(canvas: CanvasClient): Promise<Client> {
  const server = new McpServer({ name: 'output-fixture-test', version: '0.0.0' })
  registerAllTools(server, canvas)
  const client = new Client({ name: 'output-fixture-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  await client.listTools()
  return client
}

export interface CallResult {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export async function callArmed(
  canvas: CanvasClient,
  name: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const client = await connectArmedClient(canvas)
  return (await client.callTool({ name, arguments: args })) as unknown as CallResult
}

/**
 * Same connection as `callArmed`, but with a `Pseudonymizer` wired through
 * `registerAllTools` — the alternate runner the dual-mode gate needs to
 * exercise a `PseudonymizationModeFixture` pseudonymization-on and -off.
 */
export async function callArmedWithPseudonymizer(
  canvas: CanvasClient,
  pseudonymizer: Pseudonymizer,
  name: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const server = new McpServer({ name: 'output-fixture-test', version: '0.0.0' })
  registerAllTools(server, canvas, pseudonymizer)
  const client = new Client({ name: 'output-fixture-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  await client.listTools()
  return (await client.callTool({ name, arguments: args })) as unknown as CallResult
}
