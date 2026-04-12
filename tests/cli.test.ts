import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseArgs, type CliConfig } from '../src/cli'

describe('parseArgs', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CANVAS_API_TOKEN
    delete process.env.CANVAS_BASE_URL
    delete process.env.CANVAS_ALLOWED_ORIGIN
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('parses --token and --base-url from CLI args', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result).toEqual<CliConfig>({
      token: 'my-token',
      baseUrl: 'https://canvas.example.com',
      mode: 'stdio',
      port: 3001,
      allowedOrigin: 'http://localhost:3000',
    })
  })

  it('falls back to CANVAS_API_TOKEN env var', () => {
    process.env.CANVAS_API_TOKEN = 'env-token'
    const result = parseArgs(['--base-url', 'https://canvas.example.com'])

    expect(result.token).toBe('env-token')
  })

  it('falls back to CANVAS_BASE_URL env var', () => {
    process.env.CANVAS_BASE_URL = 'https://env-canvas.example.com'
    const result = parseArgs(['--token', 'my-token'])

    expect(result.baseUrl).toBe('https://env-canvas.example.com')
  })

  it('CLI args override env vars', () => {
    process.env.CANVAS_API_TOKEN = 'env-token'
    process.env.CANVAS_BASE_URL = 'https://env-canvas.example.com'
    const result = parseArgs(['--token', 'cli-token', '--base-url', 'https://cli-canvas.example.com'])

    expect(result.token).toBe('cli-token')
    expect(result.baseUrl).toBe('https://cli-canvas.example.com')
  })

  it('sets mode to http when serve subcommand is given', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com', 'serve'])

    expect(result.mode).toBe('http')
  })

  it('defaults mode to stdio', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.mode).toBe('stdio')
  })

  it('parses --port', () => {
    const result = parseArgs([
      '--token', 'my-token',
      '--base-url', 'https://canvas.example.com',
      'serve',
      '--port', '8080',
    ])

    expect(result.port).toBe(8080)
  })

  it('defaults port to 3001', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.port).toBe(3001)
  })

  it('defaults port to 3001 for invalid port value', () => {
    const result = parseArgs([
      '--token', 'my-token',
      '--base-url', 'https://canvas.example.com',
      '--port', 'not-a-number',
    ])

    expect(result.port).toBe(3001)
  })

  it('exits with error when token is missing', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseArgs(['--base-url', 'https://canvas.example.com'])).toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN',
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with error when baseUrl is missing', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseArgs(['--token', 'my-token'])).toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL',
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with error when both token and baseUrl are missing', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseArgs([])).toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN',
    )
  })

  it('handles args in any order', () => {
    const result = parseArgs([
      'serve',
      '--port', '9000',
      '--base-url', 'https://canvas.example.com',
      '--token', 'my-token',
    ])

    expect(result).toEqual<CliConfig>({
      token: 'my-token',
      baseUrl: 'https://canvas.example.com',
      mode: 'http',
      port: 9000,
      allowedOrigin: 'http://localhost:3000',
    })
  })

  it('parses --allowed-origin', () => {
    const result = parseArgs([
      '--token', 'my-token',
      '--base-url', 'https://canvas.example.com',
      '--allowed-origin', 'https://myapp.example.com',
    ])

    expect(result.allowedOrigin).toBe('https://myapp.example.com')
  })

  it('falls back to CANVAS_ALLOWED_ORIGIN env var', () => {
    process.env.CANVAS_ALLOWED_ORIGIN = 'https://env-origin.example.com'
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.allowedOrigin).toBe('https://env-origin.example.com')
  })
})
