import { describe, it, expect, vi, afterEach } from 'vitest'

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

vi.mock('../src/cli', () => ({
  parseArgs: vi.fn().mockReturnValue({
    token: 'test-token',
    baseUrl: 'https://canvas.example.com',
    mode: 'stdio',
    port: 3001,
    destructiveTools: 'block',
  }),
}))

describe('stdio entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates server with parsed config and connects StdioServerTransport', async () => {
    const { createCanvasMCPServer } = await import('../src/server')
    const { parseArgs } = await import('../src/cli')

    // Import the entry point to trigger main()
    await import('../src/stdio')

    // Allow the async main() to settle
    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    expect(parseArgs).toHaveBeenCalledWith(process.argv.slice(2))

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

    expect(mockConnect).toHaveBeenCalled()
  })
})
