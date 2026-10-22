import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CliConfig } from '../src/cli'
import { CREDENTIALLESS_STDIO_WARNING } from '../src/auth/credential-gate'

const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}))

vi.mock('../src/server', () => ({
  createCanvasMCPServer: vi.fn().mockReturnValue({
    server: {
      connect: mockConnect,
    },
    canvas: {},
  }),
}))

const parseArgsMock = vi.fn()

vi.mock('../src/cli', () => ({
  parseArgs: parseArgsMock,
}))

const CONFIGURED: CliConfig = {
  token: 'test-token',
  baseUrl: 'https://canvas.example.com',
  mode: 'stdio',
  port: 3001,
  allowedOrigin: 'http://localhost:3000',
  authProfile: 'local_static_token',
  destructiveTools: 'block',
  readOnly: false,
  credentials: 'present',
}

/** A config with both Phase 1 tool-surface controls set (GH #442, BRU-3128). */
const NARROWED: CliConfig = {
  ...CONFIGURED,
  toolsets: new Set(['grading', 'quizzes']),
  readOnly: true,
}

const CREDENTIALLESS: CliConfig = {
  ...CONFIGURED,
  token: '',
  baseUrl: '',
  destructiveTools: 'allow',
  credentials: 'absent',
}

/** Import the entry point fresh so `main()` runs against the current mocks. */
async function runEntryPoint() {
  vi.resetModules()
  mockConnect.mockClear()
  // The factory mock is module-scoped and its call list outlives a test, so
  // clear it too: without this, an assertion about "the call" can read a
  // neighbouring test's call instead of its own.
  const { createCanvasMCPServer } = await import('../src/server')
  vi.mocked(createCanvasMCPServer).mockClear()
  await import('../src/stdio')
  await vi.waitFor(() => {
    expect(mockConnect).toHaveBeenCalled()
  })
}

describe('stdio entry point', () => {
  beforeEach(() => {
    parseArgsMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates server with parsed config and connects StdioServerTransport', async () => {
    parseArgsMock.mockReturnValue(CONFIGURED)
    const { createCanvasMCPServer } = await import('../src/server')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runEntryPoint()

    expect(parseArgsMock).toHaveBeenCalledWith(process.argv.slice(2))

    // `destructiveTools` is asserted explicitly: dropping the plumbing line in
    // stdio.ts would otherwise leave the deployer's `--destructive-tools=block`
    // silently unapplied on the default transport.
    //
    // `sharedAcrossCallers: false` likewise: stdio is the one transport where
    // reverse lookup is legitimate, and since BRU-2515 the factory throws
    // rather than infer that. Dropping the line would break `resolve_pseudonym`
    // on stdio for every deployer who enabled it.
    expect(createCanvasMCPServer).toHaveBeenCalledWith({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      destructiveTools: 'block',
      readOnly: false,
      sharedAcrossCallers: false,
    })

    // A configured server is byte-for-byte what it always was: no gate, and
    // no startup notice on a channel some clients surface to the user.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  describe('tool-surface controls (GH #442, BRU-3128)', () => {
    // These exist because an injection sweep scored the stdio plumbing at
    // **zero** failing tests: the fixture above leaves `toolsets` and
    // `readOnly` unset, and `toHaveBeenCalledWith` treats an `undefined`-valued
    // key as absent — so dropping the two pass-through lines from `stdio.ts`
    // looked identical to keeping them. Both flags would have become silently
    // inert on the default transport, which is the one every desktop client
    // runs. Asserted with values set, for the same reason `destructiveTools`
    // is asserted above.
    it('forwards a toolset selection and the read-only floor to the factory', async () => {
      parseArgsMock.mockReturnValue(NARROWED)
      const { createCanvasMCPServer } = await import('../src/server')
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await runEntryPoint()

      expect(createCanvasMCPServer).toHaveBeenCalledWith({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
        destructiveTools: 'block',
        sharedAcrossCallers: false,
        toolsets: new Set(['grading', 'quizzes']),
        readOnly: true,
      })
    })

    it('forwards the unset state as unset, so the default surface is untouched', async () => {
      parseArgsMock.mockReturnValue(CONFIGURED)
      const { createCanvasMCPServer } = await import('../src/server')
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await runEntryPoint()

      const config = vi.mocked(createCanvasMCPServer).mock.calls.at(-1)?.[0]
      expect(config?.toolsets).toBeUndefined()
      expect(config?.readOnly).toBe(false)
    })
  })

  describe('credentialless discovery (GH #442, BRU-3043)', () => {
    it('installs a tool-call gate carrying the credential message', async () => {
      parseArgsMock.mockReturnValue(CREDENTIALLESS)
      const { createCanvasMCPServer } = await import('../src/server')
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await runEntryPoint()

      expect(createCanvasMCPServer).toHaveBeenCalledWith({
        token: '',
        baseUrl: '',
        destructiveTools: 'allow',
        readOnly: false,
        sharedAcrossCallers: false,
        toolCallGate: { message: expect.stringContaining('Canvas API token required') },
      })
    })

    it('warns exactly once, on stderr, and never on stdout', async () => {
      parseArgsMock.mockReturnValue(CREDENTIALLESS)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      await runEntryPoint()

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith(CREDENTIALLESS_STDIO_WARNING)
      // stdout is the MCP protocol channel on this transport.
      expect(logSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it('still connects the transport', async () => {
      parseArgsMock.mockReturnValue(CREDENTIALLESS)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await runEntryPoint()

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })
  })
})
