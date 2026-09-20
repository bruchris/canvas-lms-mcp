#!/usr/bin/env node
// Drive the oauth_brokered consent page in a real headless Chrome and prove
// that both outcomes reach their redirect target.
//
// Why this exists: the consent page is the one part of the OAuth profile whose
// behaviour is decided by the browser, not by us. QA found (PR #356, R1/R2)
// that the whole suite passed while Chrome refused to submit the form at all —
// every test posts the form itself with a hand-set `Origin`, which no browser
// sends for this page. Header assertions live in
// `tests/auth/oauth/browser-headers.test.ts`; this script is the end-to-end
// half, and it is the check behind rows 5a/6a of the manual matrix in
// `docs/oauth-profile.md`.
//
// It is deliberately self-contained: stub Canvas, stub client callback, the
// built server from `dist/`, and two *controls* that reproduce the shipped-and-
// broken headers. If the controls do not fail, the run is not evidence — it
// only means Chrome enforced nothing.
//
// Usage:  pnpm build && node scripts/verify-consent-browser.mjs
//         CHROME_PATH=/path/to/chrome node scripts/verify-consent-browser.mjs

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEADLINE_MS = 15_000

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(label, predicate, timeout = DEADLINE_MS) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  return undefined
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

// ------------------------------------------------------------- CDP client

class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  #listeners = []

  static async attachToNewTab(browserWsUrl) {
    const cdp = new Cdp()
    await cdp.#connect(browserWsUrl)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    cdp.sessionId = sessionId
    for (const domain of ['Page', 'Network', 'Runtime', 'Log']) {
      await cdp.send(`${domain}.enable`)
    }
    return cdp
  }

  #connect(url) {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(url)
      this.#ws.addEventListener('open', () => resolve())
      this.#ws.addEventListener('error', reject)
      this.#ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== undefined) {
          const entry = this.#pending.get(message.id)
          this.#pending.delete(message.id)
          if (!entry) return
          if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
          else entry.resolve(message.result)
          return
        }
        for (const listener of this.#listeners) listener(message)
      })
    })
  }

  on(listener) {
    this.#listeners.push(listener)
  }

  send(method, params = {}) {
    const id = ++this.#id
    const payload = { id, method, params }
    if (this.sessionId && !method.startsWith('Target.')) payload.sessionId = this.sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  async navigate(url) {
    await this.send('Page.navigate', { url })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true })
    return result.result?.value
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      /* already gone */
    }
  }
}

async function launchChrome() {
  const binary = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!binary) {
    throw new Error(
      `No Chrome found. Set CHROME_PATH. Looked at:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }
  const profile = mkdtempSync(join(tmpdir(), 'canvas-mcp-consent-'))
  const child = spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const portFile = join(profile, 'DevToolsActivePort')
  const port = await waitFor('DevToolsActivePort', () => {
    if (!existsSync(portFile)) return undefined
    const first = readFileSync(portFile, 'utf8').split('\n')[0]?.trim()
    return first ? Number(first) : undefined
  })
  if (!port) throw new Error('Chrome never published a DevTools port')
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  return {
    wsUrl: version.webSocketDebuggerUrl,
    userAgent: version['User-Agent'],
    stop() {
      child.kill()
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* Chrome may still hold a handle on Windows */
      }
    },
  }
}

// -------------------------------------------------------------- the stubs

/** Stub Canvas. Records the authorize hit; also the cross-origin landing for control B. */
async function startFarSide() {
  const hits = []
  const server = createServer((req, res) => {
    hits.push({ url: req.url, origin: req.headers.origin ?? null })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('far side')
  })
  const port = await listen(server)
  return { hits, port, origin: `http://127.0.0.1:${port}`, close: () => server.close() }
}

/** Stub MCP client: receives the deny redirect. */
async function startClientCallback() {
  const hits = []
  const server = createServer((req, res) => {
    hits.push(req.url)
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('callback')
  })
  const port = await listen(server)
  return { hits, port, redirectUri: `http://127.0.0.1:${port}/callback`, close: () => server.close() }
}

/**
 * Control origin. Serves a replica of the consent form under caller-chosen
 * headers, so a run can show that Chrome really does apply both rules.
 */
async function startControls(farOrigin) {
  const seen = { origins: [], posts: [] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/page') {
      const headers = { 'Content-Type': 'text/html; charset=utf-8' }
      const policy = url.searchParams.get('referrer-policy')
      const csp = url.searchParams.get('csp')
      if (policy) headers['Referrer-Policy'] = policy
      if (csp) headers['Content-Security-Policy'] = csp
      res.writeHead(200, headers)
      res.end(
        `<!doctype html><meta charset="utf-8"><form id="f" method="post" action="${url.searchParams.get('action')}">` +
          `<button type="submit" name="decision" value="allow">go</button></form>`,
      )
      return
    }
    if (url.pathname === '/echo-origin') {
      seen.origins.push(req.headers.origin ?? '<absent>')
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    if (url.pathname === '/redirect-far') {
      seen.posts.push(url.pathname)
      res.writeHead(302, { Location: `${farOrigin}/landed?via=control` })
      res.end()
      return
    }
    res.writeHead(404).end()
  })
  const port = await listen(server)
  return { seen, port, origin: `http://127.0.0.1:${port}`, close: () => server.close() }
}

async function startMcpServer(env, args = []) {
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'canvas-lms-mcp.js'), 'serve', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => {
    log += chunk
  })
  child.stderr.on('data', (chunk) => {
    log += chunk
  })
  const issuer = env.CANVAS_MCP_ISSUER
  const ready = await waitFor('server listening', () => log.includes('Health check:'))
  if (!ready) {
    child.kill()
    throw new Error(`Server never came up. Output:\n${log}`)
  }
  return {
    issuer,
    log: () => log,
    alive: () => child.exitCode === null,
    stop: () => child.kill(),
  }
}

// --------------------------------------------------------------- the checks

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function run() {
  const far = await startFarSide()
  const callback = await startClientCallback()
  const controls = await startControls(far.origin)
  const chrome = await launchChrome()

  const port = 5100 + Math.floor(Math.random() * 300)
  const issuer = `http://127.0.0.1:${port}`
  const server = await startMcpServer({
    CANVAS_AUTH_PROFILE: 'oauth_brokered',
    CANVAS_BASE_URL: far.origin,
    CANVAS_MCP_ISSUER: issuer,
    CANVAS_OAUTH_CLIENT_ID: '10000000000001',
    CANVAS_OAUTH_CLIENT_SECRET: 'stub-developer-key-secret',
    CANVAS_MCP_OAUTH_DCR: 'false',
    CANVAS_MCP_OAUTH_CLIENTS: JSON.stringify([
      {
        client_id: 'mcpcl_browserprobe',
        client_name: 'Consent probe',
        redirect_uris: [callback.redirectUri],
      },
    ]),
    CANVAS_API_TOKEN: '',
  }, ['--port', String(port)])

  const cdp = await Cdp.attachToNewTab(chrome.wsUrl)
  const consoleLines = []
  cdp.on((message) => {
    if (message.method === 'Log.entryAdded') consoleLines.push(message.params.entry.text)
  })

  const authorizeUrl = () => {
    const { challenge } = pkce()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'mcpcl_browserprobe',
      redirect_uri: callback.redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: `probe-${randomBytes(4).toString('hex')}`,
      resource: `${issuer}/mcp`,
    })
    return `${issuer}/oauth/authorize?${params}`
  }

  const submit = async (value) => {
    await cdp.navigate(authorizeUrl())
    const found = await waitFor('consent form', async () => {
      const has = await cdp.evaluate(`!!document.querySelector('button[value="${value}"]')`)
      return has === true
    })
    if (!found) throw new Error('consent page never rendered a form')
    await cdp.evaluate(`document.querySelector('button[value="${value}"]').click()`)
  }

  try {
    // --- controls: prove Chrome is enforcing both rules in this browser -----
    const control = async (query) => {
      await cdp.navigate(`${controls.origin}/page?${query}`)
      const ok = await waitFor('control form', async () => {
        const has = await cdp.evaluate(`!!document.querySelector('#f')`)
        return has === true
      })
      if (!ok) throw new Error('control page never rendered')
      await cdp.evaluate(`document.querySelector('#f button').click()`)
      await sleep(600)
    }

    controls.seen.origins.length = 0
    await control('referrer-policy=no-referrer&action=/echo-origin')
    const brokenOrigin = controls.seen.origins.at(-1)
    record(
      'control: Referrer-Policy no-referrer makes a same-origin form POST send Origin: null',
      brokenOrigin === 'null',
      `Origin: ${brokenOrigin}`,
    )

    await control('referrer-policy=same-origin&action=/echo-origin')
    const fixedOrigin = controls.seen.origins.at(-1)
    record(
      'control: Referrer-Policy same-origin sends the real Origin',
      fixedOrigin === controls.origin,
      `Origin: ${fixedOrigin}`,
    )

    const landedBefore = far.hits.length
    await control(
      `csp=${encodeURIComponent("default-src 'none'; form-action 'self'")}&action=/redirect-far`,
    )
    const blocked = far.hits.slice(landedBefore).filter((h) => h.url.startsWith('/landed'))
    record(
      "control: form-action 'self' blocks the cross-origin redirect after a form POST",
      blocked.length === 0,
      blocked.length === 0 ? 'never landed' : `landed ${blocked.length}x`,
    )

    const landedBefore2 = far.hits.length
    await control('action=/redirect-far')
    const allowed = far.hits.slice(landedBefore2).filter((h) => h.url.startsWith('/landed'))
    record(
      'control: without form-action the same redirect lands',
      allowed.length === 1,
      `landed ${allowed.length}x`,
    )

    // --- the real page ------------------------------------------------------
    const canvasBefore = far.hits.length
    await submit('allow')
    const reachedCanvas = await waitFor('Canvas authorize hit', () =>
      far.hits.slice(canvasBefore).find((h) => h.url.startsWith('/login/oauth2/auth')),
    )
    const landedUrl = await cdp.evaluate('location.href')
    record(
      'Allow on the real consent page reaches the Canvas authorize URL',
      Boolean(reachedCanvas),
      reachedCanvas ? `browser at ${landedUrl}` : `browser stuck at ${landedUrl}`,
    )

    const denyBefore = callback.hits.length
    await submit('deny')
    const denied = await waitFor('client callback hit', () =>
      callback.hits.slice(denyBefore).find((url) => url.includes('error=access_denied')),
    )
    record(
      "Cancel reaches the client's redirect URI with error=access_denied",
      Boolean(denied),
      denied ?? `browser at ${await cdp.evaluate('location.href')}`,
    )

    record('the server process is still running', server.alive())

    const violations = consoleLines.filter((line) => line.includes('Content Security Policy'))
    const realPageViolations = violations.filter((line) => line.includes(issuer))
    record(
      'no CSP violation is reported against the real consent page',
      realPageViolations.length === 0,
      realPageViolations.join(' | ') || 'none',
    )

    console.log(`\nChrome: ${chrome.userAgent}`)
    console.log(`Node:   ${process.version}`)
  } finally {
    cdp.close()
    chrome.stop()
    server.stop()
    far.close()
    callback.close()
    controls.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
