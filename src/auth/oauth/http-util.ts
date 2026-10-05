// Small node:http helpers for the OAuth endpoints: bounded body parsing,
// cookies, credentials in headers, and response shorthands. No framework —
// the rest of the transport is plain node:http too.

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Hard cap on any request body this server reads for OAuth purposes. */
export const MAX_BODY_BYTES = 64 * 1024

export class BodyError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BodyError'
    this.status = status
  }
}

export function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

/** Media type only, lower-cased, without parameters. */
export function contentType(req: IncomingMessage): string {
  const raw = firstHeader(req, 'content-type') ?? ''
  return raw.split(';')[0]?.trim().toLowerCase() ?? ''
}

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of req) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer)
      total += buf.length
      if (total > limit) throw new BodyError('Request body too large', 413)
      chunks.push(buf)
    }
  } catch (error) {
    // A client that announces a body and drops the connection makes the
    // request stream emit ECONNRESET here. That is the caller's fault, not
    // ours, so it becomes a 4xx like any other malformed request — before
    // this it escaped every catch on the path and ended the process.
    if (error instanceof BodyError) throw error
    throw new BodyError('Request body could not be read', 400)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `application/x-www-form-urlencoded` body, as OAuth token/revoke/consent require. */
export async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const type = contentType(req)
  if (type !== 'application/x-www-form-urlencoded') {
    throw new BodyError('Expected application/x-www-form-urlencoded', 400)
  }
  return new URLSearchParams(await readBody(req))
}

/** `application/json` body (dynamic client registration). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = contentType(req)
  if (type !== 'application/json') {
    throw new BodyError('Expected application/json', 400)
  }
  const text = await readBody(req)
  try {
    return JSON.parse(text)
  } catch {
    throw new BodyError('Request body is not valid JSON', 400)
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

/**
 * CSP for the two HTML pages this server serves (consent and error).
 *
 * Deliberately no `form-action`: both outcomes of the consent POST are a 302
 * to an origin chosen at runtime — Canvas on allow, the client's own redirect
 * URI on deny — and Chrome enforces `form-action` against every hop of that
 * navigation, so `'self'` aborted the login. `form-action` has no
 * `default-src` fallback in CSP 3, so leaving it out is what permits the
 * redirect; nothing else in the policy is relaxed.
 */
export const HTML_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"

/**
 * Referrer policy for those same pages.
 *
 * Not `no-referrer`: per Fetch, a non-CORS POST under that policy carries
 * `Origin: null`, which the transport's own origin allowlist then refuses —
 * so the consent form could not be submitted from any browser. `same-origin`
 * keeps the privacy intent (no `Referer` on the hop to Canvas or to the
 * client's redirect URI) while still sending a real `Origin` on the form
 * post back to the issuer.
 */
export const HTML_REFERRER_POLICY = 'same-origin'

export function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': HTML_CONTENT_SECURITY_POLICY,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': HTML_REFERRER_POLICY,
    ...headers,
  })
  res.end(html)
}

export function sendRedirect(
  res: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers })
  res.end()
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name !== '' && !(name in out)) {
      try {
        out[name] = decodeURIComponent(value)
      } catch {
        out[name] = value
      }
    }
  }
  return out
}

export interface CookieOptions {
  /** Seconds; omit for a session cookie, 0 to delete. */
  maxAge?: number
  secure: boolean
  path?: string
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  parts.push('HttpOnly')
  parts.push('SameSite=Lax')
  if (options.secure) parts.push('Secure')
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  return parts.join('; ')
}

/** The token from `Authorization: Bearer <token>`, or undefined. */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match?.[1]
}

/** Credentials from `Authorization: Basic <base64>`, or undefined. */
export function parseBasicAuth(
  header: string | undefined,
): { username: string; password: string } | undefined {
  if (!header) return undefined
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header)
  if (!match?.[1]) return undefined
  let decoded: string
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return undefined
  }
  const colon = decoded.indexOf(':')
  if (colon === -1) return undefined
  try {
    // RFC 6749 §2.3.1: client id and secret are form-urlencoded before base64.
    return {
      username: decodeURIComponent(decoded.slice(0, colon)),
      password: decodeURIComponent(decoded.slice(colon + 1)),
    }
  } catch {
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
  }
}

/** A request target this server was able to parse. */
export interface RoutedPath {
  /** Path with the issuer path prefix removed, for routing. */
  path: string
  /** Path exactly as received, for the well-known endpoints. */
  rawPath: string
  query: URLSearchParams
}

/**
 * Parse `req.url` against the issuer. The path is returned with the issuer's
 * own path prefix removed when the request carries it, so routing is the same
 * whether a reverse proxy strips the prefix or passes it through.
 *
 * Returns `undefined` when the request target is not a URL at all. The node
 * HTTP parser is happy with targets `new URL` rejects (`//a:b`, `//`), and
 * this runs before any authentication, so throwing here ended the process for
 * anyone who could open a socket. The caller answers 400.
 */
export function routePath(rawUrl: string | undefined, issuerPath: string): RoutedPath | undefined {
  let url: URL
  try {
    url = new URL(rawUrl ?? '/', 'http://placeholder.invalid')
  } catch {
    return undefined
  }
  const rawPath = url.pathname
  let path = rawPath
  if (issuerPath !== '' && (path === issuerPath || path.startsWith(`${issuerPath}/`))) {
    path = path.slice(issuerPath.length) || '/'
  }
  return { path, rawPath, query: url.searchParams }
}
