import { describe, expect, it } from 'vitest'
import { runWizard, type WizardDeps } from '../../src/init/wizard'
import type { InitConfig } from '../../src/init/argv'
import { createMemoryFileSystem } from '../../src/init/io'
import { CLIENTS, type ClientId, type PathEnv } from '../../src/init/clients'
import type { McpEntry, WriteConfigOptions } from '../../src/init/config-writer'
import type { ClientDescriptor } from '../../src/init/clients'
import type { ValidateResult } from '../../src/init/validate'

const linuxEnv: PathEnv = { platform: 'linux', home: '/home/alice' }

interface PromptCall {
  question: unknown
  response: Record<string, unknown>
}

function scriptedPrompts(responses: Array<Record<string, unknown>>) {
  const calls: PromptCall[] = []
  const fn = async (question: unknown): Promise<Record<string, unknown>> => {
    const response = responses.shift()
    if (!response) throw new Error('scriptedPrompts: no scripted response left')
    calls.push({ question, response })
    return response
  }
  return { fn, calls, remaining: () => responses.length }
}

function baseConfig(overrides: Partial<InitConfig> = {}): InitConfig {
  return {
    clients: [],
    token: undefined,
    baseUrl: undefined,
    serverName: 'canvas-lms',
    pin: undefined,
    nonInteractive: false,
    dryRun: false,
    noBackup: false,
    showHelp: false,
    ...overrides,
  }
}

interface WriterCall {
  targets: ClientDescriptor[]
  entry: McpEntry
  opts: WriteConfigOptions
}

function recordingWriter() {
  const calls: WriterCall[] = []
  const fn = async (
    _fs: unknown,
    targets: ClientDescriptor[],
    entry: McpEntry,
    opts: WriteConfigOptions = {},
  ): Promise<void> => {
    calls.push({ targets, entry, opts })
  }
  return { fn, calls }
}

function makeDeps(overrides: Partial<WizardDeps> = {}): WizardDeps {
  return {
    fs: createMemoryFileSystem(),
    env: linuxEnv,
    prompts: async () => ({}),
    pingUsersSelf: async (): Promise<ValidateResult> => ({ ok: true, displayName: 'Jane Smith' }),
    writeClientConfigs: async () => undefined,
    log: () => undefined,
    ...overrides,
  }
}

describe('runWizard — interactive flow', () => {
  it('runs the happy path: prompts for url, token, clients; writes; exits 0', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 's3cret' },
      { clients: ['cursor', 'claude-desktop'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()
    const logs: string[] = []

    const result = await runWizard(
      makeDeps({
        prompts: prompts.fn,
        writeClientConfigs: writer.fn,
        log: (m) => logs.push(m),
      }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).toBe(0)
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0].targets.map((c) => c.id).sort()).toEqual(['claude-desktop', 'cursor'])
    expect(writer.calls[0].entry).toEqual({
      command: 'npx',
      args: ['-y', 'canvas-lms-mcp'],
      env: {
        CANVAS_API_TOKEN: 's3cret',
        CANVAS_BASE_URL: 'https://school.instructure.com/api/v1',
      },
    })
    expect(prompts.remaining()).toBe(0)
    expect(logs.some((l) => /Authenticated as Jane Smith/.test(l))).toBe(true)
  })

  it('normalizes the base URL — strips trailing slash and appends /api/v1', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com/' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig(),
    })

    expect(writer.calls[0].entry.env.CANVAS_BASE_URL).toBe('https://school.instructure.com/api/v1')
  })

  it('does not double-append /api/v1 when the user already typed it', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com/api/v1' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig(),
    })

    expect(writer.calls[0].entry.env.CANVAS_BASE_URL).toBe('https://school.instructure.com/api/v1')
  })

  it('skips the URL prompt when --base-url was supplied', async () => {
    const prompts = scriptedPrompts([{ token: 't' }, { clients: ['cursor'] }, { role: 'all' }])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({
        baseUrl: 'https://school.instructure.com',
      }),
    })

    expect(prompts.remaining()).toBe(0)
    expect(writer.calls[0].entry.env.CANVAS_BASE_URL).toBe('https://school.instructure.com/api/v1')
  })

  it('re-prompts the token on a 401 hard failure', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 'bad' },
      { token: 'good' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    let attempt = 0
    const ping = async (): Promise<ValidateResult> => {
      attempt++
      if (attempt === 1) return { ok: false, status: 401, hint: 'Token is invalid or expired' }
      return { ok: true, displayName: 'Jane' }
    }
    const writer = recordingWriter()
    const logs: string[] = []

    const result = await runWizard(
      makeDeps({
        prompts: prompts.fn,
        pingUsersSelf: ping,
        writeClientConfigs: writer.fn,
        log: (m) => logs.push(m),
      }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).toBe(0)
    expect(attempt).toBe(2)
    expect(writer.calls[0].entry.env.CANVAS_API_TOKEN).toBe('good')
    expect(logs.some((l) => /invalid or expired/i.test(l))).toBe(true)
  })

  it('aborts after too many failed token attempts', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 'bad1' },
      { token: 'bad2' },
      { token: 'bad3' },
    ])
    const ping = async (): Promise<ValidateResult> => ({
      ok: false,
      status: 401,
      hint: 'Token is invalid or expired',
    })
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, pingUsersSelf: ping, writeClientConfigs: writer.fn }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('asks "continue anyway?" on soft failure and proceeds when confirmed', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { proceed: true },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const ping = async (): Promise<ValidateResult> => ({
      ok: false,
      hint: 'Canvas unreachable, continue anyway?',
    })
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, pingUsersSelf: ping, writeClientConfigs: writer.fn }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).toBe(0)
    expect(writer.calls).toHaveLength(1)
  })

  it('aborts on soft failure when the user declines to continue', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { proceed: false },
    ])
    const ping = async (): Promise<ValidateResult> => ({
      ok: false,
      hint: 'Canvas unreachable, continue anyway?',
    })
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, pingUsersSelf: ping, writeClientConfigs: writer.fn }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('uses --client values from argv and skips the client multi-select', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({ clients: ['claude-desktop' satisfies ClientId] }),
    })

    expect(prompts.remaining()).toBe(0)
    expect(writer.calls[0].targets.map((c) => c.id)).toEqual(['claude-desktop'])
  })

  it('aborts with a clear error when the user picks zero clients', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: [] },
    ])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      { initialConfig: baseConfig() },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('passes serverName and noBackup through to the writer', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({ serverName: 'my-canvas', noBackup: true }),
    })

    expect(writer.calls[0].opts.serverName).toBe('my-canvas')
    expect(writer.calls[0].opts.noBackup).toBe(true)
  })

  it('builds args with the pinned semver when --pin is set', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({ pin: '1.15.6' }),
    })

    expect(writer.calls[0].entry.args).toEqual(['-y', 'canvas-lms-mcp@1.15.6'])
  })

  it('skips the writer in --dry-run but reports what would have happened', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()
    const logs: string[] = []

    const result = await runWizard(
      makeDeps({
        prompts: prompts.fn,
        writeClientConfigs: writer.fn,
        log: (m) => logs.push(m),
      }),
      { initialConfig: baseConfig({ dryRun: true }) },
    )

    expect(result.exitCode).toBe(0)
    expect(writer.calls).toHaveLength(0)
    expect(logs.some((l) => /dry[- ]run/i.test(l))).toBe(true)
  })
})

describe('runWizard — non-interactive flow', () => {
  it('writes without any prompts when all required flags are supplied', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          baseUrl: 'https://school.instructure.com',
          token: 'tok',
          clients: ['claude-desktop' satisfies ClientId],
        }),
      },
    )

    expect(result.exitCode).toBe(0)
    expect(prompts.calls).toHaveLength(0)
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0].entry.env.CANVAS_API_TOKEN).toBe('tok')
  })

  it('errors out if the base URL is missing in non-interactive mode', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          token: 'tok',
          clients: ['cursor'],
        }),
      },
    )

    expect(result.exitCode).not.toBe(0)
    expect(prompts.calls).toHaveLength(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('errors out if the token is missing in non-interactive mode', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          baseUrl: 'https://school.instructure.com',
          clients: ['cursor'],
        }),
      },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('errors out if no clients are supplied in non-interactive mode', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          baseUrl: 'https://school.instructure.com',
          token: 'tok',
        }),
      },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })

  it('still validates the token in non-interactive mode and errors on 401', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({
        prompts: prompts.fn,
        pingUsersSelf: async () => ({ ok: false, status: 401, hint: 'invalid' }),
        writeClientConfigs: writer.fn,
      }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          baseUrl: 'https://school.instructure.com',
          token: 'bad',
          clients: ['cursor'],
        }),
      },
    )

    expect(result.exitCode).not.toBe(0)
    expect(writer.calls).toHaveLength(0)
  })
})

describe('runWizard — output', () => {
  it('uses ASCII-friendly summary output (no emoji)', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()
    const logs: string[] = []

    await runWizard(
      makeDeps({
        prompts: prompts.fn,
        writeClientConfigs: writer.fn,
        log: (m) => logs.push(m),
      }),
      { initialConfig: baseConfig() },
    )

    const all = logs.join('\n')
    // eslint-disable-next-line no-control-regex
    expect(all).toMatch(/^[\x00-\x7F\n]*$/)
  })

  it('mentions the cursor client by name in the summary', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const cursor = CLIENTS.find((c) => c.id === 'cursor')!
    const logs: string[] = []

    await runWizard(makeDeps({ prompts: prompts.fn, log: (m) => logs.push(m) }), {
      initialConfig: baseConfig(),
    })

    expect(logs.some((l) => l.includes(cursor.name))).toBe(true)
  })
})

describe('runWizard — role filtering', () => {
  it('writes CANVAS_ROLE when a role is selected interactively', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'student' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig(),
    })

    expect(prompts.remaining()).toBe(0)
    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBe('student')
  })

  it('omits CANVAS_ROLE when "all" is selected interactively', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
      { role: 'all' },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig(),
    })

    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBeUndefined()
  })

  it('uses --role from argv and skips the role prompt', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({ role: 'teacher' }),
    })

    expect(prompts.remaining()).toBe(0)
    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBe('teacher')
  })

  it('omits CANVAS_ROLE when --role all is supplied', async () => {
    const prompts = scriptedPrompts([
      { baseUrl: 'https://school.instructure.com' },
      { token: 't' },
      { clients: ['cursor'] },
    ])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({ role: 'all' }),
    })

    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBeUndefined()
  })

  it('writes CANVAS_ROLE in non-interactive mode when --role is set', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    const result = await runWizard(
      makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }),
      {
        initialConfig: baseConfig({
          nonInteractive: true,
          baseUrl: 'https://school.instructure.com',
          token: 'tok',
          clients: ['cursor'],
          role: 'admin',
        }),
      },
    )

    expect(result.exitCode).toBe(0)
    expect(prompts.calls).toHaveLength(0)
    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBe('admin')
  })

  it('does not prompt for a role in non-interactive mode without --role', async () => {
    const prompts = scriptedPrompts([])
    const writer = recordingWriter()

    await runWizard(makeDeps({ prompts: prompts.fn, writeClientConfigs: writer.fn }), {
      initialConfig: baseConfig({
        nonInteractive: true,
        baseUrl: 'https://school.instructure.com',
        token: 'tok',
        clients: ['cursor'],
      }),
    })

    expect(prompts.calls).toHaveLength(0)
    expect(writer.calls[0].entry.env.CANVAS_ROLE).toBeUndefined()
  })
})
