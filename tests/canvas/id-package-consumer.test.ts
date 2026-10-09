import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * BRU-2730 §8 PR 1b's import-level assertion: **the published `CanvasClient`
 * signatures accept a string.**
 *
 * Reading `package.json`'s `exports` and the emitted `.d.ts` gets close and is
 * not enough — it cannot distinguish a symbol that is declared from one that is
 * reachable through the package entry point. Only packing the tarball and
 * typechecking a consumer against it does, and the three ways that fails are
 * each a different bug: `TS2459` (declared in the `.d.ts` but not exported),
 * `TS2307` (subpath absent from `exports`), `TS2353` (the field does not
 * exist).
 *
 * It matters here because `canvas-lms-mcp/canvas` is a documented, separately
 * usable entry point. Before PR 1b a library consumer reading
 * `get(courseId: number)` would pass a `number` and lose precision on exactly
 * the IDs this design preserves — with the MCP surface fixed and the library
 * surface still broken.
 *
 * No network: the tarball is extracted into the consumer's own `node_modules`,
 * and the two runtime dependencies the emitted types reference are linked from
 * this repo's installed tree.
 */

const REPO_ROOT = resolve(__dirname, '..', '..')
const TSC = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const SHARD_901_ID = '9010000000000001'

let consumerDir: string

/** Runs `tsc --noEmit` over one consumer source file and returns its diagnostics. */
function typecheckConsumer(source: string): string {
  writeFileSync(join(consumerDir, 'consumer.ts'), source)
  try {
    execFileSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return ''
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string }
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

describe('§8 PR 1b — the PUBLISHED CanvasClient accepts a string ID (BRU-2730)', () => {
  // Builds, packs and extracts the tarball: well past vitest's 10 s default
  // hook timeout once the rest of the suite is competing for the machine.
  beforeAll(() => {
    // The tarball must be built from the same `dist/` the package ships.
    execFileSync('pnpm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'ignore', shell: true })

    consumerDir = mkdtempSync(join(tmpdir(), 'canvas-id-consumer-'))
    const modules = join(consumerDir, 'node_modules')
    const packed = join(consumerDir, 'packed')
    mkdirSync(modules, { recursive: true })
    mkdirSync(packed, { recursive: true })

    const packOutput = execFileSync('pnpm', ['pack', '--pack-destination', packed], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      shell: true,
    })
    const tarball = readdirSync(packed).find((f) => f.endsWith('.tgz'))
    expect(tarball, `pnpm pack produced no tarball: ${packOutput}`).toBeDefined()

    // `npm install` would reach the network for the runtime deps; extracting
    // and linking keeps the gate hermetic while testing the same artifact.
    const installed = join(modules, 'canvas-lms-mcp')
    mkdirSync(installed, { recursive: true })
    // Resolved explicitly rather than by name: `execFileSync` does not apply
    // PATHEXT, so a bare `tar` is not found on Windows even though
    // `System32\tar.exe` (bsdtar) is present and handles the gzip tarball.
    const tarBin =
      process.platform === 'win32'
        ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe')
        : 'tar'
    execFileSync(
      tarBin,
      ['-xzf', join(packed, tarball!), '-C', installed, '--strip-components=1'],
      {
        stdio: 'ignore',
      },
    )
    for (const dep of ['zod', '@modelcontextprotocol']) {
      const target = join(REPO_ROOT, 'node_modules', dep)
      const link = join(modules, dep)
      mkdirSync(join(link, '..'), { recursive: true })
      symlinkSync(target, link, 'junction')
    }

    writeFileSync(
      join(consumerDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            // `bundler` so the consumer resolves the package's `exports` map,
            // which is the thing under test.
            module: 'esnext',
            moduleResolution: 'bundler',
            target: 'es2022',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
          },
          files: ['consumer.ts'],
        },
        null,
        2,
      ),
    )
  }, 180_000)

  afterAll(() => {
    if (consumerDir) rmSync(consumerDir, { recursive: true, force: true })
  })

  it('typechecks a consumer that passes a 16-digit string ID through the `canvas` subpath', () => {
    const diagnostics = typecheckConsumer(
      [
        `import { CanvasClient } from 'canvas-lms-mcp/canvas'`,
        `const canvas = new CanvasClient({ token: 't', baseUrl: 'https://c.example.com' })`,
        `export const course = canvas.courses.get('${SHARD_901_ID}')`,
        `export const assignment = canvas.assignments.get('${SHARD_901_ID}', '42')`,
        `export const submissions = canvas.submissions.listForStudents('${SHARD_901_ID}', {`,
        `  student_ids: ['${SHARD_901_ID}', 'all'],`,
        `})`,
      ].join('\n'),
    )

    expect(diagnostics).toBe('')
  })

  it('control: the same consumer still typechecks when the ID is written as a number', () => {
    // PR 1b must not *replace* one accepted representation with the other at
    // the library boundary — `CanvasId` is a string, so a numeric literal is
    // now a compile error. This control records which it is, so a reviewer is
    // not left guessing, and so the assertion above cannot be satisfied by a
    // `tsc` invocation that silently checks nothing.
    const diagnostics = typecheckConsumer(
      [
        `import { CanvasClient } from 'canvas-lms-mcp/canvas'`,
        `const canvas = new CanvasClient({ token: 't', baseUrl: 'https://c.example.com' })`,
        `export const course = canvas.courses.get(1)`,
      ].join('\n'),
    )

    // A number is now rejected at the library boundary, by design (§4.1: one
    // canonical representation, so an ID can never be a `Map` key in two
    // forms). That is the breaking change the `feat!` commit records.
    expect(diagnostics).toContain('TS2345')
    expect(diagnostics).toContain("Argument of type 'number' is not assignable")
  })

  it('control: the gate can fail — a nonexistent export is reported, not silently ignored', () => {
    // Proves `tsc` is really running against the packed types. Without this,
    // the assertions above are claims about an invocation that might be
    // checking an empty file list.
    const diagnostics = typecheckConsumer(
      [
        `import { NotAThing } from 'canvas-lms-mcp/canvas'`,
        `export const x: NotAThing = undefined as never`,
      ].join('\n'),
    )

    expect(diagnostics).toMatch(/TS2305|TS2724/)
  })

  it('exposes `CanvasId` through the published subpath, so a consumer can name the type', () => {
    const diagnostics = typecheckConsumer(
      [
        `import type { CanvasId } from 'canvas-lms-mcp/canvas'`,
        `const id: CanvasId = '${SHARD_901_ID}'`,
        `export default id`,
      ].join('\n'),
    )

    expect(diagnostics).toBe('')
  })
})
