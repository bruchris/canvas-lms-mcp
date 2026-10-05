// N5 (#356). `launchChrome` in `scripts/verify-consent-browser.mjs` creates a
// scratch profile and spawns a browser, but the script's own teardown only
// learns about them once `launchChrome` *returns*. When startup failed first —
// Chrome never wrote `DevToolsActivePort`, its endpoint was unreachable, the
// binary would not spawn — the child and the profile were stranded with nobody
// holding a handle to either, and the script hung instead of reporting.
//
// The stand-in "browser" here is a real node process that idles forever, so
// "no child remains" is a liveness check on a real pid, not a mock assertion.
// The real browser is exercised by running the script itself; this covers the
// failure paths that run cannot reach on demand.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs with no declarations; tests are not type-checked by tsc
import { launchChrome } from '../../scripts/verify-consent-browser.mjs'

const stranded: Array<{ child: ChildProcess; profile: string }> = []

/** Stands in for Chrome: starts, then idles until killed. Publishes nothing. */
function idleBrowser(profile: string): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  stranded.push({ child, profile })
  return child
}

// Whatever a failing test leaves behind must not outlive it.
afterEach(() => {
  for (const { child, profile } of stranded.splice(0)) {
    child.kill()
    rmSync(profile, { recursive: true, force: true })
  }
})

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('launchChrome startup failures (N5, #356)', () => {
  it('kills the child and removes the profile when DevToolsActivePort never appears', async () => {
    let profile = ''
    let child: ChildProcess | undefined
    const failure: unknown = await launchChrome({
      timeoutMs: 300,
      spawnChrome: (dir: string) => {
        profile = dir
        child = idleBrowser(dir)
        return child
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    // The error is rethrown, and says what was awaited, for how long, and
    // what the browser was doing — not just that "something" never happened.
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain('DevToolsActivePort')
    expect(message).toContain('300ms')
    expect(message).toContain('still running')

    // No child remains, and the scratch profile is gone.
    expect(child).toBeDefined()
    expect(hasExited(child as ChildProcess)).toBe(true)
    expect(alive((child as ChildProcess).pid)).toBe(false)
    expect(profile).not.toBe('')
    expect(existsSync(profile)).toBe(false)
  })

  it('cleans up when the port is published but the DevTools endpoint is unreachable', async () => {
    const deadPort = await freePort()
    let profile = ''
    let child: ChildProcess | undefined

    await expect(
      launchChrome({
        timeoutMs: 2000,
        spawnChrome: (dir: string) => {
          profile = dir
          writeFileSync(join(dir, 'DevToolsActivePort'), `${deadPort}\n/devtools/browser/x\n`)
          child = idleBrowser(dir)
          return child
        },
      }),
    ).rejects.toThrow()

    expect(hasExited(child as ChildProcess)).toBe(true)
    expect(alive((child as ChildProcess).pid)).toBe(false)
    expect(existsSync(profile)).toBe(false)
  })

  it('cleans up and reports the spawn error at once when the browser cannot be started', async () => {
    let profile = ''
    const started = Date.now()
    const failure: unknown = await launchChrome({
      // Far longer than the test's own timeout: only an early bail-out passes.
      timeoutMs: 30_000,
      spawnChrome: (dir: string) => {
        profile = dir
        return spawn(join(dir, 'no-such-browser'), [], { stdio: 'ignore' })
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ code: 'ENOENT' })
    expect(Date.now() - started).toBeLessThan(4000)
    expect(existsSync(profile)).toBe(false)
  })

  it('leaves the browser and profile alone on success, until stop() is called', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/abc',
          'User-Agent': 'FakeChrome/1',
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    let profile = ''
    let child: ChildProcess | undefined
    try {
      const chrome = await launchChrome({
        spawnChrome: (dir: string) => {
          profile = dir
          writeFileSync(join(dir, 'DevToolsActivePort'), `${port}\n/devtools/browser/abc\n`)
          child = idleBrowser(dir)
          return child
        },
      })

      expect(chrome.wsUrl).toBe('ws://127.0.0.1/devtools/browser/abc')
      expect(chrome.userAgent).toBe('FakeChrome/1')
      expect(alive((child as ChildProcess).pid)).toBe(true)
      expect(existsSync(profile)).toBe(true)

      const exited = new Promise((resolve) => (child as ChildProcess).once('exit', resolve))
      chrome.stop()
      await exited
      expect(existsSync(profile)).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
