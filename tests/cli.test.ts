import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseArgs, type CliConfig } from '../src/cli'

describe('parseArgs', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CANVAS_API_TOKEN
    delete process.env.CANVAS_BASE_URL
    delete process.env.CANVAS_ALLOWED_ORIGIN
    delete process.env.CANVAS_ROLE
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
    const result = parseArgs([
      '--token',
      'cli-token',
      '--base-url',
      'https://cli-canvas.example.com',
    ])

    expect(result.token).toBe('cli-token')
    expect(result.baseUrl).toBe('https://cli-canvas.example.com')
  })

  it('sets mode to http when serve subcommand is given', () => {
    const result = parseArgs([
      '--token',
      'my-token',
      '--base-url',
      'https://canvas.example.com',
      'serve',
    ])

    expect(result.mode).toBe('http')
  })

  it('defaults mode to stdio', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.mode).toBe('stdio')
  })

  it('parses --port', () => {
    const result = parseArgs([
      '--token',
      'my-token',
      '--base-url',
      'https://canvas.example.com',
      'serve',
      '--port',
      '8080',
    ])

    expect(result.port).toBe(8080)
  })

  it('defaults port to 3001', () => {
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.port).toBe(3001)
  })

  it('defaults port to 3001 for invalid port value', () => {
    const result = parseArgs([
      '--token',
      'my-token',
      '--base-url',
      'https://canvas.example.com',
      '--port',
      'not-a-number',
    ])

    expect(result.port).toBe(3001)
  })

  it('exits with error when token is missing', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseArgs(['--base-url', 'https://canvas.example.com'])).toThrow(
      'process.exit called',
    )

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
      '--port',
      '9000',
      '--base-url',
      'https://canvas.example.com',
      '--token',
      'my-token',
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
      '--token',
      'my-token',
      '--base-url',
      'https://canvas.example.com',
      '--allowed-origin',
      'https://myapp.example.com',
    ])

    expect(result.allowedOrigin).toBe('https://myapp.example.com')
  })

  it('falls back to CANVAS_ALLOWED_ORIGIN env var', () => {
    process.env.CANVAS_ALLOWED_ORIGIN = 'https://env-origin.example.com'
    const result = parseArgs(['--token', 'my-token', '--base-url', 'https://canvas.example.com'])

    expect(result.allowedOrigin).toBe('https://env-origin.example.com')
  })

  describe('--role / CANVAS_ROLE', () => {
    const base = ['--token', 'my-token', '--base-url', 'https://canvas.example.com']

    it('leaves role undefined when neither flag nor env is set', () => {
      expect(parseArgs([...base]).role).toBeUndefined()
    })

    it('parses --role into config.role', () => {
      expect(parseArgs([...base, '--role', 'student']).role).toBe('student')
    })

    it('reads CANVAS_ROLE env, case-insensitively', () => {
      process.env.CANVAS_ROLE = 'TEACHER'
      expect(parseArgs([...base]).role).toBe('teacher')
    })

    it('--role overrides CANVAS_ROLE env when both are set', () => {
      process.env.CANVAS_ROLE = 'teacher'
      expect(parseArgs([...base, '--role', 'admin']).role).toBe('admin')
    })

    it('treats "all" as no filter without warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.CANVAS_ROLE = 'all'
      expect(parseArgs([...base]).role).toBeUndefined()
      expect(warn).not.toHaveBeenCalled()
    })

    it('warns to stderr and ignores an invalid --role value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = parseArgs([...base, '--role', 'ta'])
      expect(result.role).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown --role value 'ta'"))
    })

    it('warns to stderr and ignores an invalid CANVAS_ROLE env value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.CANVAS_ROLE = 'wizard'
      const result = parseArgs([...base])
      expect(result.role).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown CANVAS_ROLE 'wizard'"))
    })

    it('an invalid --role overrides a valid env role (falls back to all)', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.CANVAS_ROLE = 'admin'
      expect(parseArgs([...base, '--role', 'nope']).role).toBeUndefined()
    })
  })
})
