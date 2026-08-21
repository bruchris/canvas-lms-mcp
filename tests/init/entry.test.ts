import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockRunWizard, mockPrompts } = vi.hoisted(() => ({
  mockRunWizard: vi.fn(),
  mockPrompts: vi.fn(),
}))

vi.mock('../../src/init/wizard', () => ({
  runWizard: mockRunWizard,
}))

vi.mock('prompts', () => ({
  default: mockPrompts,
}))

import { main } from '../../src/init'
import { helpText } from '../../src/init/argv'
import { pingUsersSelf } from '../../src/init/validate'
import { writeClientConfigs } from '../../src/init/config-writer'

const HAPPY_ARGV = [
  '--client',
  'cursor',
  '--token',
  't',
  '--base-url',
  'https://school.instructure.com',
  '--non-interactive',
]

describe('init entry point', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CANVAS_API_TOKEN
    delete process.env.CANVAS_BASE_URL
    mockRunWizard.mockReset()
    mockPrompts.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('parse failure: prints the error to stderr and exits 2 without invoking the wizard', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await main(['--unknown-flag'])

    expect(errorSpy).toHaveBeenCalledWith('Error: Unknown argument: --unknown-flag')
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(exitSpy).toHaveBeenCalledTimes(1)
    expect(mockRunWizard).not.toHaveBeenCalled()
  })

  it.each([
    [['init', '--help'], 'init --help'],
    [['--help'], '--help'],
  ])('help via %s: reaches the parser after the argv shift, prints help, exits 0', async (argv) => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await main(argv)

    expect(logSpy).toHaveBeenCalledWith(helpText())
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(exitSpy).toHaveBeenCalledTimes(1)
    expect(mockRunWizard).not.toHaveBeenCalled()
  })

  it('happy path: assembles WizardDeps, calls runWizard, and propagates exitCode 0', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockRunWizard.mockResolvedValue({ exitCode: 0 })

    await main(HAPPY_ARGV)

    expect(mockRunWizard).toHaveBeenCalledTimes(1)
    const [deps, opts] = mockRunWizard.mock.calls[0]
    expect(deps.pingUsersSelf).toBe(pingUsersSelf)
    expect(deps.writeClientConfigs).toBe(writeClientConfigs)
    expect(typeof deps.log).toBe('function')
    expect(typeof deps.prompts).toBe('function')
    expect(deps.env).toEqual(expect.objectContaining({ platform: process.platform }))
    expect(opts.initialConfig).toEqual(
      expect.objectContaining({
        clients: ['cursor'],
        token: 't',
        baseUrl: 'https://school.instructure.com',
        nonInteractive: true,
      }),
    )
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('happy path: deps.log writes through console.log and deps.prompts wraps the prompts library', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockPrompts.mockResolvedValue({ answer: 'yes' })
    mockRunWizard.mockResolvedValue({ exitCode: 0 })

    await main(HAPPY_ARGV)

    const [deps] = mockRunWizard.mock.calls[0]
    deps.log('hello from the wizard')
    expect(logSpy).toHaveBeenCalledWith('hello from the wizard')

    const question = { type: 'text', name: 'answer' }
    await expect(deps.prompts(question)).resolves.toEqual({ answer: 'yes' })
    expect(mockPrompts).toHaveBeenCalledWith(question)
  })

  it('propagates a non-zero exit code returned by runWizard', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    mockRunWizard.mockResolvedValue({ exitCode: 2, message: 'no clients selected' })

    await main(HAPPY_ARGV)

    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('thrown error: logs "Fatal error:" to stderr and exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const boom = new Error('boom')
    mockRunWizard.mockRejectedValue(boom)

    await main(HAPPY_ARGV)

    expect(errorSpy).toHaveBeenCalledWith('Fatal error:', boom)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
