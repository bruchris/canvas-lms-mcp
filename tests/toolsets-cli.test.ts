import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseArgs } from '../src/cli'
import { CANVAS_TOOLSETS, type CanvasToolset } from '../src/tools/toolsets'

const CREDENTIALS = ['--token', 't', '--base-url', 'https://canvas.example.com']

function set(...toolsets: CanvasToolset[]): ReadonlySet<CanvasToolset> {
  return new Set(toolsets)
}

describe('parseArgs — --toolsets / CANVAS_TOOLSETS', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CANVAS_')) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('is unset by default, preserving the full surface', () => {
    expect(parseArgs(CREDENTIALS).toolsets).toBeUndefined()
  })

  it('reads CANVAS_TOOLSETS', () => {
    process.env.CANVAS_TOOLSETS = 'grading,quizzes'
    expect(parseArgs(CREDENTIALS).toolsets).toEqual(set('grading', 'quizzes'))
  })

  it('accepts --toolsets=<list> and --toolsets <list>', () => {
    expect(parseArgs([...CREDENTIALS, '--toolsets=core,people']).toolsets).toEqual(
      set('core', 'people'),
    )
    expect(parseArgs([...CREDENTIALS, '--toolsets', 'core,people']).toolsets).toEqual(
      set('core', 'people'),
    )
  })

  it('treats "all" as unset on both surfaces, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    process.env.CANVAS_TOOLSETS = 'all'
    expect(parseArgs(CREDENTIALS).toolsets).toBeUndefined()
    expect(parseArgs([...CREDENTIALS, '--toolsets=all']).toolsets).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('the flag wins over the environment', () => {
    process.env.CANVAS_TOOLSETS = 'grading'
    expect(parseArgs([...CREDENTIALS, '--toolsets=account']).toolsets).toEqual(set('account'))
  })

  it('a later flag wins over an earlier one', () => {
    expect(
      parseArgs([...CREDENTIALS, '--toolsets=grading', '--toolsets=account']).toolsets,
    ).toEqual(set('account'))
  })

  it('warns and falls back to the full surface on an unknown CANVAS_TOOLSETS value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.CANVAS_TOOLSETS = 'grading,bogus'

    expect(parseArgs(CREDENTIALS).toolsets).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain("'bogus'")
    expect(warn.mock.calls[0]?.[0]).toContain('registering all tools')
  })

  it('warns and falls back to the full surface on an unknown --toolsets value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseArgs([...CREDENTIALS, '--toolsets=nope']).toolsets).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain("'nope'")
  })

  it('an invalid flag clears a valid environment selection, mirroring --role', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.CANVAS_TOOLSETS = 'grading'

    // Never the narrower reading: serving `grading` here would honour a surface
    // the operator's own command line contradicted.
    expect(parseArgs([...CREDENTIALS, '--toolsets=bogus']).toolsets).toBeUndefined()
  })

  it('--toolsets without a value is a startup error, not a silently swallowed argument', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseArgs([...CREDENTIALS, '--toolsets'])).toThrow('exit')
    expect(error.mock.calls[0]?.[0]).toContain('--toolsets requires a value')
    exit.mockRestore()
  })

  it('accepts every published toolset name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseArgs([...CREDENTIALS, `--toolsets=${CANVAS_TOOLSETS.join(',')}`]).toolsets).toEqual(
      new Set(CANVAS_TOOLSETS),
    )
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('parseArgs — --read-only / CANVAS_READ_ONLY', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CANVAS_')) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('defaults to false', () => {
    expect(parseArgs(CREDENTIALS).readOnly).toBe(false)
  })

  it('--read-only sets it', () => {
    expect(parseArgs([...CREDENTIALS, '--read-only']).readOnly).toBe(true)
  })

  it('CANVAS_READ_ONLY=true sets it', () => {
    process.env.CANVAS_READ_ONLY = 'true'
    expect(parseArgs(CREDENTIALS).readOnly).toBe(true)
  })

  it('accepts the other truthy spellings — every one turns a restriction ON', () => {
    // Permissive parsing is the safe direction here, unlike a kill switch: a
    // stray `TRUE` or `1` fails closed into read-only rather than open.
    for (const value of ['true', 'TRUE', ' True ', '1', 'yes', 'on']) {
      process.env.CANVAS_READ_ONLY = value
      expect(parseArgs(CREDENTIALS).readOnly, value).toBe(true)
    }
  })

  it('false, 0, off and unset all preserve the default write surface', () => {
    for (const value of ['false', 'FALSE', '0', 'off', 'no', '']) {
      process.env.CANVAS_READ_ONLY = value
      expect(parseArgs(CREDENTIALS).readOnly, value).toBe(false)
    }
    delete process.env.CANVAS_READ_ONLY
    expect(parseArgs(CREDENTIALS).readOnly).toBe(false)
  })

  it('composes with --toolsets on one command line', () => {
    const config = parseArgs([...CREDENTIALS, '--read-only', '--toolsets=grading'])

    expect(config.readOnly).toBe(true)
    expect(config.toolsets).toEqual(set('grading'))
  })
})
