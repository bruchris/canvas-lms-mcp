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
  credentials: 'present',
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
      sharedAcrossCallers: false,
    })

    // A configured server is byte-for-byte what it always was: no gate, and
    // no startup notice on a channel some clients surface to the user.
    expect(errorSpy).not.toHaveBeenCalled()
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
