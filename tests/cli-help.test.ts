import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const BIN = new URL('../bin/canvas-lms-mcp.js', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)

/**
 * Run the bin with no Canvas credentials. Help must not import or start a
 * transport, so the child gets a clean environment and no stdin: if the stdio
 * server were started it would either fail on the missing token or print to
 * stdout, and both would fail these assertions.
 */
function runBin(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('CANVAS_')) delete env[key]
  }
  return spawnSync(process.execPath, [BIN, ...args], {
    env,
    input: '',
    encoding: 'utf8',
    timeout: 15_000,
  })
}

describe('top-level help', () => {
  it.each([['--help'], ['-h']])('%s prints usage and exits 0 without credentials', (flag) => {
    const result = runBin([flag])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^Usage: canvas-lms-mcp/)
  })

  it('lists the public commands and credential flags', () => {
    const { stdout } = runBin(['--help'])

    for (const token of [
      'serve',
      'init',
      'doctor',
      'auth status',
      '--token',
      '--base-url',
      'CANVAS_API_TOKEN',
      'CANVAS_BASE_URL',
      'canvas-lms-mcp init --help',
    ]) {
      expect(stdout).toContain(token)
    }
  })

  it('does not print transport or missing-credential errors', () => {
    const { stdout, stderr } = runBin(['-h'])

    expect(stdout).not.toMatch(/token required|base URL required|Fatal error/)
    expect(stderr).not.toMatch(/Fatal error|Error:/)
  })
})
