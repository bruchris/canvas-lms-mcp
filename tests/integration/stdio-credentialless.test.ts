import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CREDENTIALLESS_STDIO_WARNING } from '../../src/auth/credential-gate'

/**
 * BRU-3043 / GH #442 — the real thing: spawn the **built** default stdio entry
 * point with every `CANVAS_*` variable removed from its environment, complete
 * MCP initialization over a pipe, and prove what a directory crawler sees.
 *
 * Why a child process rather than an in-process server:
 *
 * 1. The defect being fixed was `process.exit(1)` inside `parseArgs()`. No
 *    in-process test can observe "the process did not exit", and a mocked
 *    `process.exit` is a test of the mock.
 * 2. "stdout stays protocol-clean" is a claim about a real file descriptor.
 *    One stray `console.log` anywhere in the import graph breaks every client,
 *    and only a pipe can see it.
 * 3. The environment is read in the built module. `vi.stubEnv` never crosses a
 *    process boundary, so a bundler that hoisted or inlined the read would
 *    still pass every src-level test.
 *
 * The build goes to a private `--out-dir` under the repo, not `dist/`:
 * `tsup.config.ts` sets `clean: true`, so two test files building into the
 * shared `dist/` race and the loser's whole file silently drops out of the run
 * (BRU-2851). It must stay under the repo because tsup keeps deps external and
 * the emitted chunk resolves them by walking up to `node_modules`.
 *
 * The RPC sequence runs in `beforeAll` but records its own failure instead of
 * throwing: a `beforeAll` that throws reports its tests as **skipped**, which
 * reads as "0 failures" in a JSON report rather than "the server died". Every
 * assertion below therefore checks `startupFailure` first, so an injected
 * regression names the test it broke.
 */

const REPO_ROOT = resolve(__dirname, '..', '..')
const BUNDLE_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'bru3043-credentialless-stdio')

/** Lowest tool count any supported server config can expose. */
const TOOL_COUNT_FLOOR = 150

interface JsonRpcResponse {
  jsonrpc: string
  id?: number | string | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** A line-delimited JSON-RPC client over a child process pipe. */
class StdioProbe {
  readonly child: ChildProcessWithoutNullStreams
  readonly stdoutLines: string[] = []
  stderr = ''
  exitInfo: string | undefined
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, (error: Error | null, r?: JsonRpcResponse) => void>()

  constructor(entry: string) {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key.startsWith('CANVAS_')) delete env[key]
    }
    this.child = spawn(process.execPath, [entry], {
      env,
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk
    })
    this.child.stdout.on('data', (chunk: string) => this.consume(chunk))
    this.child.on('exit', (code, signal) => {
      this.exitInfo = `exited with code ${code} signal ${signal}`
      // Fail fast and informatively: a server that exited is the original
      // defect, and waiting out a timeout would hide the reason.
      for (const [id, settle] of this.pending) {
        this.pending.delete(id)
        settle(new Error(`child ${this.exitInfo}; stderr: ${this.stderr.trim()}`))
      }
    })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    this.stdoutLines.push(line)
    let parsed: JsonRpcResponse
    try {
      parsed = JSON.parse(line) as JsonRpcResponse
    } catch {
      // A non-JSON line is itself a finding; the stdout-discipline test reads
      // `stdoutLines` and reports it.
      return
    }
    if (typeof parsed.id === 'number') {
      const settle = this.pending.get(parsed.id)
      if (settle) {
        this.pending.delete(parsed.id)
        settle(null, parsed)
      }
    }
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++
    return new Promise((resolvePromise, rejectPromise) => {
      if (this.exitInfo !== undefined) {
        rejectPromise(new Error(`child already ${this.exitInfo}; stderr: ${this.stderr.trim()}`))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error(`timed out waiting for ${method}; stderr: ${this.stderr.trim()}`))
      }, 20_000)
      this.pending.set(id, (error, response) => {
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else resolvePromise(response as JsonRpcResponse)
      })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill()
  }
}

interface Capture {
  startupFailure?: string
  initialize?: JsonRpcResponse
  toolsList?: JsonRpcResponse
  promptsList?: JsonRpcResponse
  resourcesList?: JsonRpcResponse
  gatedCall?: JsonRpcResponse
  promptGet?: JsonRpcResponse
  toolsListAgain?: JsonRpcResponse
  stdoutLines: string[]
  stderr: string
  exitInfo?: string
}

const capture: Capture = { stdoutLines: [], stderr: '' }

function toolNames(response: JsonRpcResponse | undefined): string[] {
  return ((response?.result?.tools ?? []) as { name: string }[]).map((t) => t.name)
}

describe('built stdio entry point with no Canvas credentials', () => {
  let probe: StdioProbe

  beforeAll(async () => {
    rmSync(BUNDLE_DIR, { recursive: true, force: true })
    // One command string, no args array: `execFileSync(file, args, {shell:true})`
    // emits a DEP0190 deprecation warning on every run.
    execFileSync(`pnpm exec tsup --out-dir ${JSON.stringify(BUNDLE_DIR)}`, {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      shell: true,
    })
    const entry = join(BUNDLE_DIR, 'stdio.js')
    expect(existsSync(entry)).toBe(true)

    probe = new StdioProbe(entry)
    try {
      capture.initialize = await probe.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'bru3043-probe', version: '0.0.0' },
      })
      probe.notify('notifications/initialized')

      capture.toolsList = await probe.request('tools/list')
      capture.promptsList = await probe.request('prompts/list')
      capture.resourcesList = await probe.request('resources/list')

      capture.gatedCall = await probe.request('tools/call', {
        name: 'list_pages',
        arguments: { course_id: '1' },
      })

      // Control: a non-tool method still works after the refused call. Without
      // it, "the tool call was refused" is indistinguishable from "the server
      // answers everything with an error". Picks a prompt with no required
      // arguments so the probe needs no per-prompt fixture.
      const prompts = (capture.promptsList.result?.prompts ?? []) as {
        name: string
        arguments?: { name: string; required?: boolean }[]
      }[]
      const argless = prompts.find((p) => !(p.arguments ?? []).some((a) => a.required === true))
      expect(argless, 'expected at least one prompt with no required arguments').toBeDefined()
      capture.promptGet = await probe.request('prompts/get', {
        name: argless?.name ?? '',
        arguments: {},
      })

      capture.toolsListAgain = await probe.request('tools/list')
    } catch (error) {
      capture.startupFailure = error instanceof Error ? error.message : String(error)
    }
    capture.stdoutLines = [...probe.stdoutLines]
    capture.stderr = probe.stderr
    capture.exitInfo = probe.exitInfo
  }, 240_000)

  afterAll(() => {
    probe?.close()
    rmSync(BUNDLE_DIR, { recursive: true, force: true })
  })

  it('completes MCP initialization', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.initialize?.error).toBeUndefined()
    expect(capture.initialize?.result?.serverInfo).toMatchObject({ name: 'canvas-lms-mcp' })
  })

  it('never exited during the session', () => {
    expect(capture.exitInfo).toBeUndefined()
  })

  it('serves the full default tool surface to tools/list', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.toolsList?.error).toBeUndefined()
    const names = toolNames(capture.toolsList)
    expect(names.length).toBeGreaterThan(TOOL_COUNT_FLOOR)
    // A directory reads these names; a sample of recognisable ones pins that
    // the surface is the real registry rather than a stub.
    expect(names).toContain('list_courses')
    expect(names).toContain('list_pages')
  })

  it('serves prompts/list and resources/list', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.promptsList?.error).toBeUndefined()
    expect(capture.resourcesList?.error).toBeUndefined()
    expect((capture.promptsList?.result?.prompts as unknown[]).length).toBeGreaterThan(10)
    expect((capture.resourcesList?.result?.resources as unknown[]).length).toBeGreaterThan(0)
  })

  it('refuses a tool call with the structured credential error', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.gatedCall?.error).toBeUndefined()
    expect(capture.gatedCall?.result?.isError).toBe(true)
    const content = capture.gatedCall?.result?.content as { type: string; text: string }[]
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('text')
    for (const needle of [
      'Canvas API token required',
      '--token',
      'CANVAS_API_TOKEN',
      'canvas-lms-mcp doctor',
    ]) {
      expect(content[0].text).toContain(needle)
    }
    // The refusal is a tool result, not a protocol error, and carries no
    // structured payload that could satisfy the success schema.
    expect(capture.gatedCall?.result?.structuredContent).toBeUndefined()
  })

  it('still answers a non-tool method after the refusal', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.promptGet?.error).toBeUndefined()
    expect((capture.promptGet?.result?.messages as unknown[]).length).toBeGreaterThan(0)
  })

  it('survives the refused call and serves tools/list again, identically', () => {
    expect(capture.startupFailure).toBeUndefined()
    expect(capture.toolsListAgain?.error).toBeUndefined()
    expect(toolNames(capture.toolsListAgain)).toEqual(toolNames(capture.toolsList))
  })

  it('keeps stdout protocol-clean: every line is a JSON-RPC message', () => {
    expect(capture.startupFailure).toBeUndefined()
    const notJsonRpc = capture.stdoutLines.filter((line) => {
      try {
        return (JSON.parse(line) as { jsonrpc?: string }).jsonrpc !== '2.0'
      } catch {
        return true
      }
    })
    expect(notJsonRpc).toEqual([])
    expect(capture.stdoutLines.length).toBeGreaterThan(0)
  })

  it('emits exactly one stderr warning, and nothing else', () => {
    expect(capture.stderr.trim()).toBe(CREDENTIALLESS_STDIO_WARNING)
    const occurrences = capture.stderr.split(CREDENTIALLESS_STDIO_WARNING).length - 1
    expect(occurrences).toBe(1)
  })

  it('names the credential variables and the doctor path in the warning', () => {
    for (const needle of ['CANVAS_API_TOKEN', 'CANVAS_BASE_URL', 'canvas-lms-mcp doctor']) {
      expect(capture.stderr).toContain(needle)
    }
  })
})
