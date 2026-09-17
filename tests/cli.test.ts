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
    delete process.env.CANVAS_DESTRUCTIVE_TOOLS
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('CANVAS_AUTH_') ||
        key.startsWith('CANVAS_MCP_') ||
        key.startsWith('CANVAS_OAUTH_') ||
        key === 'CANVAS_HTTP_HOST'
      ) {
        delete process.env[key]
      }
    }
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
      authProfile: 'local_static_token',
      enableAssignmentSubmission: false,
      destructiveTools: 'allow',
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
      'Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN. Run `canvas-lms-mcp doctor` to check your setup.',
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
      'Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL. Run `canvas-lms-mcp doctor` to check your setup.',
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
      'Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN. Run `canvas-lms-mcp doctor` to check your setup.',
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
      authProfile: 'remote_static_token',
      enableAssignmentSubmission: false,
      destructiveTools: 'allow',
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

  describe('--enable-assignment-submission / CANVAS_ENABLE_ASSIGNMENT_SUBMISSION', () => {
    const base = ['--token', 'my-token', '--base-url', 'https://canvas.example.com']

    it('defaults enableAssignmentSubmission to false when neither flag nor env is set', () => {
      expect(parseArgs([...base]).enableAssignmentSubmission).toBe(false)
    })

    it('sets enableAssignmentSubmission to true with --enable-assignment-submission flag', () => {
      expect(
        parseArgs([...base, '--enable-assignment-submission']).enableAssignmentSubmission,
      ).toBe(true)
    })

    it('sets enableAssignmentSubmission to true when CANVAS_ENABLE_ASSIGNMENT_SUBMISSION=true', () => {
      process.env.CANVAS_ENABLE_ASSIGNMENT_SUBMISSION = 'true'
      expect(parseArgs([...base]).enableAssignmentSubmission).toBe(true)
    })

    it('recognises truthy env values: "1", "yes", "on"', () => {
      for (const val of ['1', 'yes', 'on']) {
        process.env.CANVAS_ENABLE_ASSIGNMENT_SUBMISSION = val
        expect(parseArgs([...base]).enableAssignmentSubmission).toBe(true)
      }
    })

    it('ignores non-truthy env value "false"', () => {
      process.env.CANVAS_ENABLE_ASSIGNMENT_SUBMISSION = 'false'
      expect(parseArgs([...base]).enableAssignmentSubmission).toBe(false)
    })

    it('CLI flag overrides absent env (env off + flag on = true)', () => {
      expect(
        parseArgs([...base, '--enable-assignment-submission']).enableAssignmentSubmission,
      ).toBe(true)
    })
  })
  describe('--destructive-tools / CANVAS_DESTRUCTIVE_TOOLS', () => {
    const base = ['--token', 'my-token', '--base-url', 'https://canvas.example.com']

    /** Run parseArgs with process.exit and console.error stubbed out. */
    function expectFatal(args: string[]): string {
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => parseArgs(args)).toThrow('process.exit called')
      expect(errorSpy).toHaveBeenCalled()
      return String(errorSpy.mock.calls[0]?.[0] ?? '')
    }

    it('defaults to allow when neither flag nor env is set', () => {
      expect(parseArgs([...base]).destructiveTools).toBe('allow')
    })

    it('reads block from CANVAS_DESTRUCTIVE_TOOLS', () => {
      process.env.CANVAS_DESTRUCTIVE_TOOLS = 'block'
      expect(parseArgs([...base]).destructiveTools).toBe('block')
    })

    it('accepts the documented --destructive-tools=<mode> form', () => {
      expect(parseArgs([...base, '--destructive-tools=block']).destructiveTools).toBe('block')
      expect(parseArgs([...base, '--destructive-tools=allow']).destructiveTools).toBe('allow')
    })

    it('also accepts the space-separated form used by every other flag', () => {
      expect(parseArgs([...base, '--destructive-tools', 'block']).destructiveTools).toBe('block')
    })

    it('the flag overrides the environment', () => {
      process.env.CANVAS_DESTRUCTIVE_TOOLS = 'allow'
      expect(parseArgs([...base, '--destructive-tools=block']).destructiveTools).toBe('block')
    })

    it('a flag value of allow overrides a block environment', () => {
      // The reverse direction matters just as much: the precedence rule must be
      // "last writer wins", not "strictest wins", or the flag is unusable for
      // a one-off override on a host configured to block.
      process.env.CANVAS_DESTRUCTIVE_TOOLS = 'block'
      expect(parseArgs([...base, '--destructive-tools=allow']).destructiveTools).toBe('allow')
    })

    /**
     * Run parseArgs with process.exit stubbed to throw. Used by the tests that
     * assert startup is *not* aborted: without the stub a regression would call
     * the real process.exit and tear the vitest worker down, which reads as
     * infrastructure noise rather than as this assertion failing.
     */
    function parseArgsNoExit(args: string[]): CliConfig {
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })
      return parseArgs(args)
    }

    // Whichever source wins must be the only one parsed — the same rule
    // `resolveDestructiveToolsMode` follows. Validating the losing source too
    // makes the flag unusable on exactly the hosts that need it: a deployment
    // layer that exports a typo'd CANVAS_DESTRUCTIVE_TOOLS would abort startup
    // no matter what the operator typed on the command line.
    describe.each(['allow', 'block'] as const)('with --destructive-tools=%s supplied', (flag) => {
      it.each(['Block', 'BLOCK', ' block', 'block ', 'blocked', '', 'true', '1', 'confirm'])(
        'overrides the invalid environment value %j instead of aborting',
        (envValue) => {
          process.env.CANVAS_DESTRUCTIVE_TOOLS = envValue
          expect(parseArgsNoExit([...base, `--destructive-tools=${flag}`]).destructiveTools).toBe(
            flag,
          )
        },
      )
    })

    it('a later flag wins over an earlier one', () => {
      expect(
        parseArgsNoExit([...base, '--destructive-tools=allow', '--destructive-tools=block'])
          .destructiveTools,
      ).toBe('block')
    })

    it('still rejects an invalid earlier flag even when a later flag is valid', () => {
      // Deliberately unlike the env case above. A repeated flag is one operator
      // typing twice in a single command line, so a bad value there is a typo
      // with no legitimate override story — unlike an ambient env var, which the
      // invoker may not control. Refusing to start is the safe direction.
      const message = expectFatal([
        ...base,
        '--destructive-tools=Block',
        '--destructive-tools=allow',
      ])
      expect(message).toContain('--destructive-tools')
      expect(message).toContain('"Block"')
    })

    it('parses correctly regardless of flag position', () => {
      expect(parseArgs(['--destructive-tools=block', ...base, 'serve']).destructiveTools).toBe(
        'block',
      )
    })

    it('does not swallow a following flag as its value', () => {
      // `--destructive-tools --port 9000` must fail loudly, not consume `--port`
      // and leave the port at its default while appearing to have worked.
      const message = expectFatal([...base, '--destructive-tools', '--port', '9000'])
      expect(message).toContain('--destructive-tools')
      expect(message).toContain('"--port"')
    })

    it('exits on a bare --destructive-tools with no value rather than failing open', () => {
      const message = expectFatal([...base, '--destructive-tools'])
      expect(message).toContain('requires a value')
    })

    it.each(['Block', 'BLOCK', ' block', 'block ', 'blocked', '', 'true', '1', 'confirm'])(
      'exits on the invalid flag value %j',
      (value) => {
        const message = expectFatal([...base, `--destructive-tools=${value}`])
        expect(message).toContain('--destructive-tools')
      },
    )

    it.each(['Block', 'BLOCK', ' block', 'block ', 'blocked', '', 'true', '1', 'confirm'])(
      'exits on the invalid env value %j',
      (value) => {
        process.env.CANVAS_DESTRUCTIVE_TOOLS = value
        const message = expectFatal([...base])
        expect(message).toContain('CANVAS_DESTRUCTIVE_TOOLS')
      },
    )

    it('names `confirm` as reserved-but-unimplemented, not as a typo', () => {
      const message = expectFatal([...base, '--destructive-tools=confirm'])
      expect(message).toMatch(/not implemented/i)
    })
  })
  describe('--auth-profile / CANVAS_AUTH_PROFILE (#302 §3, §5)', () => {
    const OAUTH_ENV = {
      CANVAS_BASE_URL: 'https://school.instructure.com',
      CANVAS_MCP_ISSUER: 'http://127.0.0.1:3001',
      CANVAS_OAUTH_CLIENT_ID: '10000000000001',
      CANVAS_OAUTH_CLIENT_SECRET: 'dev-key-secret',
    }

    function expectFatal(args: string[]): string {
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      errorSpy.mockClear()
      expect(() => parseArgs(args)).toThrow('process.exit called')
      return String(errorSpy.mock.calls.at(-1)?.[0] ?? '')
    }

    it('defaults to local_static_token on stdio and remote_static_token on serve, with no oauth config', () => {
      const base = ['--token', 't', '--base-url', 'https://canvas.example.com']
      expect(parseArgs(base).authProfile).toBe('local_static_token')
      const http = parseArgs([...base, 'serve'])
      expect(http.authProfile).toBe('remote_static_token')
      expect(http.oauth).toBeUndefined()
      expect(http.host).toBeUndefined()
    })

    it('oauth_brokered starts without CANVAS_API_TOKEN and carries the OAuth config (acceptance)', () => {
      Object.assign(process.env, OAUTH_ENV)
      const config = parseArgs(['serve', '--auth-profile', 'oauth_brokered'])
      expect(config.authProfile).toBe('oauth_brokered')
      expect(config.token).toBe('')
      expect(config.baseUrl).toBe('https://school.instructure.com')
      expect(config.host).toBe('127.0.0.1')
      expect(config.oauth).toMatchObject({
        issuer: 'http://127.0.0.1:3001',
        resource: 'http://127.0.0.1:3001/mcp',
        canvas: { clientId: '10000000000001' },
      })
    })

    it('reads the profile from CANVAS_AUTH_PROFILE and accepts the --auth-profile=value form', () => {
      Object.assign(process.env, OAUTH_ENV, { CANVAS_AUTH_PROFILE: 'oauth_brokered' })
      expect(parseArgs(['serve']).authProfile).toBe('oauth_brokered')
      expect(
        parseArgs(['serve', '--auth-profile=remote_static_token', '--token', 't']).authProfile,
      ).toBe('remote_static_token')
    })

    it('ignores a leftover PAT in the OAuth profile with a warning instead of refusing to start', () => {
      Object.assign(process.env, OAUTH_ENV, { CANVAS_API_TOKEN: 'leftover' })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = parseArgs(['serve', '--auth-profile', 'oauth_brokered'])
      expect(config.token).toBe('')
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ignored in the oauth_brokered profile'),
      )
    })

    it('exits on an unknown profile, on a profile/transport mismatch, and on a bare flag', () => {
      expect(expectFatal(['serve', '--auth-profile', 'oauth'])).toContain(
        "Unknown --auth-profile value 'oauth'",
      )
      expect(expectFatal(['--auth-profile', 'oauth_brokered'])).toContain(
        'requires the HTTP transport',
      )
      expect(
        expectFatal([
          'serve',
          '--token',
          't',
          '--base-url',
          'https://c.example',
          '--auth-profile',
          'local_static_token',
        ]),
      ).toContain("cannot be used with 'serve'")
      expect(expectFatal(['serve', '--auth-profile'])).toContain('--auth-profile requires a value')
    })

    it('the flag is the only source parsed, so an invalid ambient CANVAS_AUTH_PROFILE cannot break a valid override', () => {
      process.env.CANVAS_AUTH_PROFILE = 'garbage'
      const config = parseArgs([
        'serve',
        '--auth-profile',
        'remote_static_token',
        '--token',
        't',
        '--base-url',
        'https://c.example',
      ])
      expect(config.authProfile).toBe('remote_static_token')
    })

    it('names the missing OAuth input and points at doctor, without echoing secrets', () => {
      Object.assign(process.env, OAUTH_ENV)
      delete process.env.CANVAS_MCP_ISSUER
      const message = expectFatal(['serve', '--auth-profile', 'oauth_brokered'])
      expect(message).toContain('CANVAS_MCP_ISSUER (or --issuer) is required')
      expect(message).toContain('canvas-lms-mcp doctor')
      expect(message).not.toContain('dev-key-secret')
    })

    it('--issuer and --base-url override the environment in the OAuth profile', () => {
      Object.assign(process.env, OAUTH_ENV)
      const config = parseArgs([
        'serve',
        '--auth-profile',
        'oauth_brokered',
        '--issuer',
        'https://canvas-mcp.example.edu/',
        '--base-url',
        'https://other.instructure.com',
      ])
      expect(config.oauth?.issuer).toBe('https://canvas-mcp.example.edu')
      expect(config.baseUrl).toBe('https://other.instructure.com')
    })

    describe('--host / CANVAS_HTTP_HOST', () => {
      it('is undefined (all interfaces, unchanged) for the static HTTP profile unless set', () => {
        const base = ['serve', '--token', 't', '--base-url', 'https://c.example']
        expect(parseArgs(base).host).toBeUndefined()
        expect(parseArgs([...base, '--host', '0.0.0.0']).host).toBe('0.0.0.0')
        process.env.CANVAS_HTTP_HOST = '10.0.0.5'
        expect(parseArgs(base).host).toBe('10.0.0.5')
      })

      it('defaults to loopback for the OAuth profile and refuses to expose a loopback issuer', () => {
        Object.assign(process.env, OAUTH_ENV)
        expect(parseArgs(['serve', '--auth-profile', 'oauth_brokered']).host).toBe('127.0.0.1')
        const message = expectFatal([
          'serve',
          '--auth-profile',
          'oauth_brokered',
          '--host',
          '0.0.0.0',
        ])
        expect(message).toContain('must bind a loopback host too')
      })

      it('lets an https issuer bind all interfaces (hosted behind TLS termination)', () => {
        Object.assign(process.env, OAUTH_ENV, {
          CANVAS_MCP_ISSUER: 'https://canvas-mcp.example.edu',
        })
        expect(
          parseArgs(['serve', '--auth-profile', 'oauth_brokered', '--host', '0.0.0.0']).host,
        ).toBe('0.0.0.0')
      })
    })
  })
})
