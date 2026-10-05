// Auth profile boundary (issue #302, design docs/superpowers/specs/2026-09-17-issue-302-mcp-oauth-profile.md §3).
//
// Every process resolves to exactly one profile at startup. The profile decides
// where the Canvas credential comes from and what, if anything, authenticates
// the inbound MCP connection. Nothing in this module reads a request: a
// profile is a deployment fact chosen by the operator, never by a client.

export const AUTH_PROFILES = [
  'local_static_token',
  'remote_static_token',
  'oauth_brokered',
] as const

export type AuthProfile = (typeof AUTH_PROFILES)[number]

export type TransportMode = 'stdio' | 'http'

export function isAuthProfile(value: string): value is AuthProfile {
  return (AUTH_PROFILES as readonly string[]).includes(value)
}

/**
 * Parse a raw profile value from the environment or a CLI flag.
 *
 * - unset / empty → `undefined` (caller applies the transport default)
 * - a known profile (trimmed, lower-cased) → that profile
 * - anything else → **throws**. A typo must not fall back to a more permissive
 *   profile, so unlike `parseRole` this is not lenient.
 */
export function parseAuthProfile(raw: string | undefined, source: string): AuthProfile | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === '') return undefined
  if (isAuthProfile(value)) return value
  throw new Error(`Unknown ${source} value '${raw}'. Expected one of: ${AUTH_PROFILES.join(', ')}.`)
}

/** The profile a transport uses when none is configured. Backwards-compatible. */
export function defaultAuthProfile(mode: TransportMode): AuthProfile {
  return mode === 'http' ? 'remote_static_token' : 'local_static_token'
}

/** Which transport each profile can run on. */
const PROFILE_TRANSPORT: Record<AuthProfile, TransportMode> = {
  local_static_token: 'stdio',
  remote_static_token: 'http',
  oauth_brokered: 'http',
}

export function transportForProfile(profile: AuthProfile): TransportMode {
  return PROFILE_TRANSPORT[profile]
}

/**
 * Throws when a profile cannot run on the given transport. stdio has no
 * network edge to put OAuth on; the two remote profiles have no stdin.
 */
export function assertProfileSupportsTransport(profile: AuthProfile, mode: TransportMode): void {
  const expected = PROFILE_TRANSPORT[profile]
  if (expected === mode) return
  if (mode === 'http') {
    throw new Error(
      `Auth profile '${profile}' is a stdio profile and cannot be used with 'serve'. ` +
        `Use 'remote_static_token' (default) or 'oauth_brokered'.`,
    )
  }
  throw new Error(
    `Auth profile '${profile}' requires the HTTP transport. Add the 'serve' subcommand, ` +
      `or use 'local_static_token' (default) for stdio.`,
  )
}

/** True for the profiles that need a Canvas personal access token at startup. */
export function profileRequiresStaticToken(profile: AuthProfile): boolean {
  return profile !== 'oauth_brokered'
}

export interface ResolveAuthProfileInput {
  /** Value of `--auth-profile`, or undefined when the flag was not given. */
  flag?: string
  /** Value of `CANVAS_AUTH_PROFILE`, or undefined when unset. */
  env?: string
  mode: TransportMode
}

/**
 * Resolve the effective profile. The flag wins outright; only the winning
 * source is parsed, so an invalid ambient env var cannot break a command line
 * that carries a valid override (the same precedence rule `--destructive-tools`
 * uses). The result is checked against the transport.
 */
export function resolveAuthProfile(input: ResolveAuthProfileInput): AuthProfile {
  // A flag that is present but carries no value is fatal (QA S1, #356).
  // `--auth-profile=` is an unsubstituted template variable or a typo, and
  // falling through would land on the *more permissive* static profile with
  // whatever CANVAS_API_TOKEN happened to be in the environment. An empty
  // environment variable keeps meaning "unset": that is how a compose file
  // spells "I am not setting this".
  if (input.flag !== undefined && input.flag.trim() === '') {
    throw new Error(
      `--auth-profile requires a value. Expected one of: ${AUTH_PROFILES.join(', ')}.`,
    )
  }
  const fromFlag = parseAuthProfile(input.flag, '--auth-profile')
  const profile =
    fromFlag ?? parseAuthProfile(input.env, 'CANVAS_AUTH_PROFILE') ?? defaultAuthProfile(input.mode)
  assertProfileSupportsTransport(profile, input.mode)
  return profile
}
