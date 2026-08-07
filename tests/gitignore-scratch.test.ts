import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function checkIgnoreExitCode(path: string): number {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: REPO_ROOT })
    return 0
  } catch (error) {
    const status = (error as { status?: number }).status
    return typeof status === 'number' ? status : 1
  }
}

describe('.gitignore scratch-file guard', () => {
  it.each(['.tmp-token.txt', '.tmp-scratch.json', 'scratch.tmp', '.tmp/anything'])(
    'ignores %s',
    (probePath) => {
      expect(checkIgnoreExitCode(probePath)).toBe(0)
    },
  )

  it('has no tracked .tmp-* or *.tmp files', () => {
    const output = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT }).toString()
    const tracked = output
      .split('\n')
      .filter((path) => path.length > 0)
      .filter((path) => {
        const base = path.split('/').pop() ?? path
        return base.startsWith('.tmp-') || base.endsWith('.tmp')
      })
    expect(tracked).toEqual([])
  })
})
