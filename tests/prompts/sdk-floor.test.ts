/**
 * Arms every other test in this directory.
 *
 * The behavioural tests here run against whatever `@modelcontextprotocol/sdk`
 * the lockfile installs. That is only evidence about what a *consumer* gets if
 * the installed version is also the lowest version this package declares it
 * accepts — and for one release cycle it was not: `package.json` declared
 * `^1.30.0` while the lockfile resolved 1.32.0, so CI proved nothing about the
 * floor and a consumer resolving at the floor got a broken prompt surface.
 *
 * The behaviour at stake is a `prompts/get` whose `arguments` key is omitted,
 * which the MCP schema permits and the SDK's own client does by default. On the
 * old floor the SDK parsed `undefined` against an object schema and answered
 * `-32602`. Our own handler is unaffected — it reads
 * `request.params.arguments ?? {}` — but a prompt an embedder registers itself
 * is served by delegating to the SDK's handler (`src/prompts/index.ts`), which
 * is the path `docs/agent-discovery.md` tells embedders to use.
 *
 * Bisected over every release between the old and new floor, each run with a
 * control call supplying `arguments: {}` that had to succeed (so a failure
 * cannot be the probe breaking at that version):
 *
 * | SDK    | `getPrompt({ name })` | control `arguments: {}` |
 * | ------ | --------------------- | ----------------------- |
 * | 1.30.0 | -32602                | OK                      |
 * | 1.30.1 | -32602                | OK                      |
 * | 1.31.0 | -32602                | OK                      |
 * | 1.32.0 | OK                    | OK                      |
 * | 1.32.1 | OK                    | OK                      |
 *
 * So 1.32.0 is the first published release with the fix, and the floor below is
 * the tightest correct one rather than a round number.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

/** First published SDK release that accepts a `prompts/get` with no `arguments` key. */
const FIRST_FIXED = '1.32.0'

const declaredRange: string = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  .dependencies['@modelcontextprotocol/sdk']

const installedVersion: string = JSON.parse(
  readFileSync(resolve(ROOT, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8'),
).version

/**
 * Lowest version the declared range accepts. Deliberately refuses anything but
 * a plain caret range: a range this cannot parse must fail loudly rather than
 * be guessed at, because the guess would silently decide what "the floor" means.
 */
function minVersionOf(range: string): string {
  const match = /^\^(\d+\.\d+\.\d+)$/.exec(range)
  if (!match) {
    throw new Error(
      `Cannot determine a minimum version from the declared range "${range}". ` +
        'This guard understands a plain caret range only — widen it deliberately.',
    )
  }
  return match[1]!
}

/** Numeric, not lexicographic: '1.9.0' is below '1.30.0'. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1
  }
  return 0
}

describe('MCP SDK compatibility floor', () => {
  // Without this the comparisons below could pass on unparsed or lexicographic
  // nonsense, which is exactly the class of mistake a version guard invites.
  it('compares versions numerically', () => {
    expect(compareVersions('1.9.0', '1.30.0')).toBe(-1)
    expect(compareVersions('1.30.1', '1.32.0')).toBe(-1)
    expect(compareVersions('1.32.0', '1.32.1')).toBe(-1)
    expect(compareVersions('1.32.0', '1.32.0')).toBe(0)
    expect(compareVersions('1.32.1', '1.32.0')).toBe(1)
  })

  it('reads a real range and a real installed version', () => {
    expect(declaredRange).toMatch(/^\^\d+\.\d+\.\d+$/)
    expect(installedVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it(`declares a floor no lower than ${FIRST_FIXED}, where omitted prompt arguments was fixed`, () => {
    expect(
      compareVersions(minVersionOf(declaredRange), FIRST_FIXED),
      `package.json declares "${declaredRange}", whose minimum predates the fix for a ` +
        'prompts/get with the arguments key omitted. A consumer installing at that floor gets ' +
        'a -32602 on any prompt an embedder registered itself.',
    ).toBeGreaterThanOrEqual(0)
  })

  it('installs a version the declared range accepts', () => {
    expect(
      compareVersions(installedVersion, minVersionOf(declaredRange)),
      `installed ${installedVersion} is below the declared floor ${declaredRange}`,
    ).toBeGreaterThanOrEqual(0)
  })

  it('installs exactly the declared floor, so the tests in this directory verify the floor', () => {
    expect(
      installedVersion,
      'The lockfile no longer installs the lowest version package.json accepts, so every other ' +
        'test in tests/prompts/ now proves the prompt surface works on a version a consumer may ' +
        'never resolve. Either raise the declared floor in package.json to the installed version ' +
        '(after checking the prompt suite still passes on it), or pin the lockfile back to the ' +
        'floor. See the table at the top of this file for how the floor was established.',
    ).toBe(minVersionOf(declaredRange))
  })
})
