import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

/**
 * BRU-2730 §8 Phase 2b's "prove it against the built `dist/`" requirement
 * (BRU-2851).
 *
 * The src-level suite proves the logic. It cannot prove that the **shipped
 * artifact** does it, and that gap is real here for two reasons specific to
 * this change:
 *
 * 1. The Accept value is a literal string that esbuild rewrites. Only reading
 *    it off a real request made by `dist/` proves the bytes on the wire.
 * 2. The flag is read from `process.env` in the built module. A bundler that
 *    hoisted, inlined or tree-shook that read would still pass every
 *    `vi.stubEnv`-based test in the same process, because those never cross a
 *    process boundary. Spawning a child with the variable in its real
 *    environment is the only shape that matches a deployment.
 *
 * The probe runs twice against the same bundle with the environment as the
 * single variable: `CANVAS_STRING_IDS=true` and the flag absent. A delta
 * between two otherwise identical runs is attributable to nothing else.
 *
 * ## Why this builds into a private directory instead of `dist/`
 *
 * `tests/canvas/id-package-consumer.test.ts` also shells out to a build, and
 * `tsup.config.ts` sets `clean: true`. Two test files building into the shared
 * `dist/` concurrently race: one wipes the tree while the other's child process
 * is importing it, and the loser's whole file drops out of the run. That
 * failure mode is invisible in the default reporter's summary and shows up only
 * as a *missing* file in `--reporter=json` output, i.e. as four tests that
 * silently never ran. `--out-dir` costs nothing (the build is ~300 ms), keeps
 * the same tsup config, entries and bundler, and makes the measurement
 * independent of what else is running.
 */

const REPO_ROOT = resolve(__dirname, '..', '..')
const SHARD_901_ID = '9010000000000001'
const EXPECTED_ACCEPT = 'application/json+canvas-string-ids, application/json'

interface ProbeResult {
  /** `Accept` seen on each captured request, in order; `null` when absent. */
  accept: Array<string | null>
  urls: string[]
  /** IDs as the client handed them back, after §4.3 normalization. */
  ids: string[]
  authorization: Array<string | null>
}

/**
 * Exercises all three response paths plus a followed `Link` URL and a
 * `/api/quiz/v1` path, against whatever the built `canvas/index.js` contains.
 * Written without template literals so the generated source stays free of
 * nesting hazards.
 */
function probeSource(builtEntry: string): string {
  return [
    'import { CanvasHttpClient } from ' + JSON.stringify(pathToFileURL(builtEntry).href),
    "import { writeFileSync } from 'node:fs'",
    '',
    'const SHARD = ' + JSON.stringify(SHARD_901_ID),
    'const PAGE2 = "https://canvas.example.com/api/v1/courses?page=2"',
    '',
    'const accept = []',
    'const urls = []',
    'const authorization = []',
    'const queued = [',
    '  // request(): a single entity whose id Canvas has stringified.',
    '  { body: JSON.stringify({ id: SHARD }), headers: {} },',
    '  // paginate(): page 1 advertises a next link, page 2 closes the list.',
    '  { body: JSON.stringify([{ id: SHARD }]), headers: { Link: "<" + PAGE2 + ">; rel=\\"next\\"" } },',
    '  { body: JSON.stringify([{ id: SHARD }]), headers: {} },',
    '  // paginateEnvelope()',
    '  { body: JSON.stringify({ items: [{ id: SHARD }] }), headers: {} },',
    '  // a New Quizzes path, which must never negotiate',
    '  { body: JSON.stringify({ id: SHARD }), headers: {} },',
    ']',
    'let i = 0',
    'globalThis.fetch = (url, init) => {',
    '  const headers = (init && init.headers) || {}',
    '  urls.push(String(url))',
    '  accept.push(headers.Accept === undefined ? null : headers.Accept)',
    '  authorization.push(headers.Authorization === undefined ? null : headers.Authorization)',
    '  const canned = queued[i++]',
    '  if (!canned) throw new Error("probe: no canned response for call " + i)',
    '  return Promise.resolve(',
    '    new Response(canned.body, {',
    '      status: 200,',
    '      headers: Object.assign({ "Content-Type": "application/json" }, canned.headers),',
    '    }),',
    '  )',
    '}',
    '',
    'const client = new CanvasHttpClient({',
    '  token: "probe-token",',
    '  baseUrl: "https://canvas.example.com",',
    '})',
    '',
    'const ids = []',
    'ids.push((await client.request("/api/v1/courses/" + SHARD)).id)',
    'for (const row of await client.paginate("/api/v1/courses")) ids.push(row.id)',
    'for (const row of await client.paginateEnvelope("/api/v1/items", "items")) ids.push(row.id)',
    'ids.push((await client.request("/api/quiz/v1/courses/1/quizzes/" + SHARD)).id)',
    '',
    'writeFileSync(process.argv[2], JSON.stringify({ accept, urls, ids, authorization }))',
  ].join('\n')
}

let probeDir: string
let bundleDir: string

/** Runs the probe in a fresh process with `CANVAS_STRING_IDS` set or removed. */
function runProbe(flag: string | undefined): ProbeResult {
  const out = join(probeDir, `out-${flag === undefined ? 'unset' : flag}.json`)
  const env = { ...process.env }
  if (flag === undefined) delete env.CANVAS_STRING_IDS
  else env.CANVAS_STRING_IDS = flag

  execFileSync(process.execPath, [join(probeDir, 'probe.mjs'), out], {
    cwd: probeDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  return JSON.parse(readFileSync(out, 'utf8')) as ProbeResult
}

describe('§8 Phase 2b — the BUILT dist/ negotiates string IDs, and only when the flag is exact', () => {
  // Builds the bundle the package ships: well past vitest's 10 s default hook
  // timeout once the rest of the suite is competing for the machine.
  beforeAll(() => {
    // One command string, no args array: `execFileSync(file, args, {shell:true})`
    // emits a DEP0190 deprecation warning on every run, and a build step has no
    // business adding a line of stderr to the suite.
    probeDir = mkdtempSync(join(tmpdir(), 'canvas-string-ids-dist-'))
    // The bundle must live *under the repo*: tsup keeps `zod` external, so the
    // emitted chunk resolves it by walking up to the repo's `node_modules`. In
    // a temp directory that walk fails with ERR_MODULE_NOT_FOUND. `.cache/` is
    // already ignored and is not `dist/`, so there is still no race.
    bundleDir = join(REPO_ROOT, 'node_modules', '.cache', 'bru2851-string-ids-dist')
    rmSync(bundleDir, { recursive: true, force: true })
    execFileSync(`pnpm exec tsup --out-dir ${JSON.stringify(bundleDir)}`, {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      shell: true,
    })

    const builtEntry = join(bundleDir, 'canvas', 'index.js')
    expect(existsSync(builtEntry)).toBe(true)
    writeFileSync(join(probeDir, 'probe.mjs'), probeSource(builtEntry))
  }, 180_000)

  afterAll(() => {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true })
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true })
  })

  it('sends the exact Accept bytes on all three paths and the followed Link URL', () => {
    const on = runProbe('true')

    expect(on.urls).toEqual([
      'https://canvas.example.com/api/v1/courses/9010000000000001',
      expect.stringContaining('per_page=100'),
      'https://canvas.example.com/api/v1/courses?page=2',
      expect.stringContaining('/api/v1/items'),
      'https://canvas.example.com/api/quiz/v1/courses/1/quizzes/9010000000000001',
    ])
    // request, paginate page 1, paginate page 2 (followed Link),
    // paginateEnvelope — then New Quizzes, excluded.
    expect(on.accept).toEqual([
      EXPECTED_ACCEPT,
      EXPECTED_ACCEPT,
      EXPECTED_ACCEPT,
      EXPECTED_ACCEPT,
      null,
    ])
  })

  it('flag-off built dist: the same bundle sends no Accept header anywhere', () => {
    const off = runProbe(undefined)

    // Negative control: every request was still attempted, with auth intact,
    // so "no Accept" is not "no request".
    expect(off.urls).toHaveLength(5)
    expect(off.authorization.every((a) => a === 'Bearer probe-token')).toBe(true)
    expect(off.accept).toEqual([null, null, null, null, null])
  })

  it('flag-off built dist: a non-exact value does not enable it either', () => {
    expect(runProbe('TRUE').accept).toEqual([null, null, null, null, null])
    expect(runProbe('1').accept).toEqual([null, null, null, null, null])
  })

  it('the shard-901 ID survives the built dist byte-exact, in both flag modes', () => {
    // The canned payload is already stringified, so this isolates the built
    // §4.3 normalization: it must not mangle an exact ID with the flag on, and
    // must not stop running with the flag off. Five IDs, one per captured
    // request — including the New Quizzes response, which is normalized even
    // though it never negotiates.
    const expected = Array(5).fill(SHARD_901_ID)
    expect(runProbe('true').ids).toEqual(expected)
    expect(runProbe(undefined).ids).toEqual(expected)
  })
})
