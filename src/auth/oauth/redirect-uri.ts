// Redirect URI rules (design §7.1).
//
// Registration: `https`, or `http` on a loopback host — the two forms the MCP
// authorization spec permits (OAuth 2.1 §1.5). No fragments, no credentials.
//
// Matching: exact string equality, with the one exception RFC 8252 §7.3
// requires for native apps: a loopback `http` redirect may present a different
// port than it registered, because the client binds an ephemeral port per
// login (Codex registers `http://127.0.0.1/callback` and listens on a random
// port). Scheme, host, path, and query must still match exactly.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** True for hostnames that can only be reached from the same machine. */
export function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (LOOPBACK_HOSTNAMES.has(lower)) return true
  // The whole 127/8 block is loopback (RFC 1122 §3.2.1.3).
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)
}

export type RedirectUriValidation = { ok: true; url: URL } | { ok: false; reason: string }

/** Whether a redirect URI is acceptable to register. */
export function validateRedirectUri(uri: string): RedirectUriValidation {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return { ok: false, reason: `redirect_uri '${uri}' is not an absolute URL` }
  }
  if (url.hash !== '') {
    return { ok: false, reason: `redirect_uri '${uri}' must not contain a fragment` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: `redirect_uri '${uri}' must not contain credentials` }
  }
  if (url.protocol === 'https:') return { ok: true, url }
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return { ok: true, url }
  return {
    ok: false,
    reason: `redirect_uri '${uri}' must use https, or http on a loopback host (127.0.0.1, [::1], localhost)`,
  }
}

/** True when the loopback-port exception applies to a registered URI. */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && isLoopbackHost(url.hostname)
}

/**
 * Does a presented redirect URI match a registered one? Exact match first;
 * otherwise, for loopback `http` registrations only, equal except for port.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true
  let reg: URL
  let pres: URL
  try {
    reg = new URL(registered)
    pres = new URL(presented)
  } catch {
    return false
  }
  if (!isLoopbackHttp(reg) || !isLoopbackHttp(pres)) return false
  return (
    reg.protocol === pres.protocol &&
    reg.hostname.toLowerCase() === pres.hostname.toLowerCase() &&
    reg.pathname === pres.pathname &&
    reg.search === pres.search &&
    pres.hash === ''
  )
}

/** The first registered URI a presented one matches, or undefined. */
export function findMatchingRedirectUri(
  registered: readonly string[],
  presented: string,
): string | undefined {
  return registered.find((candidate) => redirectUriMatches(candidate, presented))
}
