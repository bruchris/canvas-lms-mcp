// `canvas-lms-mcp doctor` (issue #302 §11): identity-safe setup diagnostics.
//
// Reports which inputs the resolved profile needs, whether each is present and
// where it came from — never the value. Pure: takes argv and an environment,
// returns a report; the entry point in src/doctor.ts prints it.

import { OAuthConfigError, loadOAuthProfileConfig, resolveBindHost } from './oauth/config'
import { isLoopbackHost } from './oauth/redirect-uri'
import {
  parseAuthProfile,
  defaultAuthProfile,
  profileRequiresStaticToken,
  transportForProfile,
  type AuthProfile,
  type TransportMode,
} from './profile'

export type DoctorStatus = 'ok' | 'warn' | 'missing' | 'info'

export interface DoctorCheck {
  label: string
  status: DoctorStatus
  detail: string
}

export interface DoctorReport {
  mode: TransportMode
  profile?: AuthProfile
  checks: DoctorCheck[]
  /** True when the server would start with this configuration. */
  ready: boolean
}

export type DoctorEnv = Record<string, string | undefined>

interface DoctorArgs {
  mode: TransportMode
  authProfile?: string
  token?: string
  baseUrl?: string
  issuer?: string
  host?: string
}

/** A lenient scan of the same flags `parseArgs` reads; never exits. */
export function scanDoctorArgs(argv: string[]): DoctorArgs {
  const args: DoctorArgs = { mode: 'stdio' }
  const take = (flag: string, arg: string, next: () => string | undefined): string | undefined => {
    if (arg === flag) return next() ?? ''
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
    return undefined
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    const next = () => argv[++i]
    if (arg === 'serve') {
      args.mode = 'http'
      continue
    }
    const profile = take('--auth-profile', arg, next)
    if (profile !== undefined) {
      args.authProfile = profile
      continue
    }
    const token = take('--token', arg, next)
    if (token !== undefined) {
      args.token = token
      continue
    }
    const baseUrl = take('--base-url', arg, next)
    if (baseUrl !== undefined) {
      args.baseUrl = baseUrl
      continue
    }
    const issuer = take('--issuer', arg, next)
    if (issuer !== undefined) {
      args.issuer = issuer
      continue
    }
    const host = take('--host', arg, next)
    if (host !== undefined) {
      args.host = host
      continue
    }
  }
  return args
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

function source(
  flagValue: string | undefined,
  flag: string,
  envValue: string | undefined,
  envName: string,
): string | undefined {
  if (present(flagValue)) return flag
  if (present(envValue)) return envName
  return undefined
}

function baseUrlCheck(value: string | undefined, from: string | undefined): DoctorCheck {
  if (!present(value) || !from) {
    return {
      label: 'Canvas base URL',
      status: 'missing',
      detail:
        'not set — use --base-url or CANVAS_BASE_URL (origin only, e.g. https://school.instructure.com)',
    }
  }
  let url: URL
  try {
    url = new URL(value!)
  } catch {
    return {
      label: 'Canvas base URL',
      status: 'warn',
      detail: `set (${from}) but is not an absolute URL`,
    }
  }
  if (/\/api\/v1\/?$/.test(url.pathname)) {
    return {
      label: 'Canvas base URL',
      status: 'warn',
      detail: `set (${from}) but ends with /api/v1 — use the origin only; the client adds /api/v1 itself`,
    }
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return {
      label: 'Canvas base URL',
      status: 'warn',
      detail: `set (${from}) but has a path — expected the origin only`,
    }
  }
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    return { label: 'Canvas base URL', status: 'warn', detail: `set (${from}) but is not https` }
  }
  return { label: 'Canvas base URL', status: 'ok', detail: `set (${from}), origin only` }
}

export function diagnose(argv: string[], env: DoctorEnv): DoctorReport {
  const args = scanDoctorArgs(argv)
  const checks: DoctorCheck[] = []
  let ready = true
  const fail = (check: DoctorCheck) => {
    checks.push(check)
    if (check.status === 'missing') ready = false
  }

  checks.push({
    label: 'Transport',
    status: 'info',
    detail: args.mode === 'http' ? 'HTTP (serve)' : 'stdio (default)',
  })

  let profile: AuthProfile | undefined
  try {
    profile =
      parseAuthProfile(args.authProfile, '--auth-profile') ??
      parseAuthProfile(env.CANVAS_AUTH_PROFILE, 'CANVAS_AUTH_PROFILE') ??
      defaultAuthProfile(args.mode)
  } catch (error) {
    fail({
      label: 'Auth profile',
      status: 'missing',
      detail: error instanceof Error ? error.message : String(error),
    })
    return { mode: args.mode, checks, ready: false }
  }
  if (transportForProfile(profile) !== args.mode) {
    fail({
      label: 'Auth profile',
      status: 'missing',
      detail: `${profile} runs on ${transportForProfile(profile)}, but the command line selects ${args.mode}`,
    })
    return { mode: args.mode, profile, checks, ready: false }
  }
  const profileSource = present(args.authProfile)
    ? '--auth-profile'
    : present(env.CANVAS_AUTH_PROFILE)
      ? 'CANVAS_AUTH_PROFILE'
      : 'default'
  checks.push({ label: 'Auth profile', status: 'info', detail: `${profile} (${profileSource})` })

  const baseUrlValue = present(args.baseUrl) ? args.baseUrl : env.CANVAS_BASE_URL
  const baseUrlFrom = source(args.baseUrl, '--base-url', env.CANVAS_BASE_URL, 'CANVAS_BASE_URL')
  fail(baseUrlCheck(baseUrlValue, baseUrlFrom))

  if (profileRequiresStaticToken(profile)) {
    const tokenFrom = source(args.token, '--token', env.CANVAS_API_TOKEN, 'CANVAS_API_TOKEN')
    fail(
      tokenFrom
        ? {
            label: 'Canvas credential',
            status: 'ok',
            detail: `personal access token set (${tokenFrom})`,
          }
        : {
            label: 'Canvas credential',
            status: 'missing',
            detail: 'no personal access token — use --token or CANVAS_API_TOKEN',
          },
    )
    checks.push({
      label: 'Host OAuth badge',
      status: 'info',
      detail:
        profile === 'local_static_token'
          ? 'not available on stdio — Codex shows "Auth Unsupported" for stdio servers by design. ' +
            'For a native "Not logged in" / Authenticate state, run `serve --auth-profile oauth_brokered`.'
          : 'not available in remote_static_token — switch to `--auth-profile oauth_brokered` for a native login state.',
    })
    return { mode: args.mode, profile, checks, ready }
  }

  // oauth_brokered
  if (present(args.token) || present(env.CANVAS_API_TOKEN)) {
    checks.push({
      label: 'Canvas credential',
      status: 'warn',
      detail:
        'a personal access token is set but ignored in oauth_brokered; Canvas credentials come from the OAuth flow',
    })
  } else {
    checks.push({
      label: 'Canvas credential',
      status: 'ok',
      detail: 'none required — obtained per user through Canvas OAuth',
    })
  }
  const issuerFrom = source(args.issuer, '--issuer', env.CANVAS_MCP_ISSUER, 'CANVAS_MCP_ISSUER')
  const clientIdFrom = present(env.CANVAS_OAUTH_CLIENT_ID) ? 'CANVAS_OAUTH_CLIENT_ID' : undefined
  const secretFrom = present(env.CANVAS_OAUTH_CLIENT_SECRET)
    ? 'CANVAS_OAUTH_CLIENT_SECRET'
    : undefined
  fail(
    issuerFrom
      ? { label: 'Issuer', status: 'ok', detail: `set (${issuerFrom})` }
      : {
          label: 'Issuer',
          status: 'missing',
          detail: 'not set — use --issuer or CANVAS_MCP_ISSUER (public URL of this server)',
        },
  )
  fail(
    clientIdFrom
      ? { label: 'Canvas Developer Key ID', status: 'ok', detail: `set (${clientIdFrom})` }
      : {
          label: 'Canvas Developer Key ID',
          status: 'missing',
          detail: 'not set — CANVAS_OAUTH_CLIENT_ID',
        },
  )
  fail(
    secretFrom
      ? { label: 'Canvas Developer Key secret', status: 'ok', detail: `set (${secretFrom})` }
      : {
          label: 'Canvas Developer Key secret',
          status: 'missing',
          detail: 'not set — CANVAS_OAUTH_CLIENT_SECRET',
        },
  )

  // Full validation, the same code the server runs at startup.
  try {
    const config = loadOAuthProfileConfig(env, {
      ...(present(args.issuer) ? { issuer: args.issuer } : {}),
      ...(present(args.baseUrl) ? { baseUrl: args.baseUrl } : {}),
    })
    const host = resolveBindHost(config, present(args.host) ? args.host : env.CANVAS_HTTP_HOST)
    checks.push({
      label: 'OAuth configuration',
      status: 'ok',
      detail: `issuer ${config.issuer}, resource ${config.resource}, bind ${host}`,
    })
    checks.push({
      label: 'Grant store',
      status: config.store ? 'ok' : 'info',
      detail: config.store
        ? 'encrypted file (CANVAS_MCP_OAUTH_STORE)'
        : 'in-memory — grants reset when the process restarts; set CANVAS_MCP_OAUTH_STORE for a hosted deployment',
    })
    checks.push({
      label: 'Client registration',
      status: 'info',
      detail: [
        config.dynamicRegistration ? 'dynamic registration on' : 'dynamic registration off',
        config.cimdAllowedHosts.length > 0
          ? `CIMD trusted hosts: ${config.cimdAllowedHosts.join(', ')}`
          : 'CIMD off',
        `${config.clients.length} pre-registered client(s)`,
      ].join('; '),
    })
    checks.push({
      label: 'Host OAuth badge',
      status: 'info',
      detail: `available — clients see "Not logged in" until they authenticate at ${config.resource}`,
    })
  } catch (error) {
    if (error instanceof OAuthConfigError) {
      fail({ label: 'OAuth configuration', status: 'missing', detail: error.message })
    } else {
      throw error
    }
  }

  return { mode: args.mode, profile, checks, ready }
}

const MARK: Record<DoctorStatus, string> = {
  ok: 'ok     ',
  warn: 'warn   ',
  missing: 'MISSING',
  info: 'info   ',
}

export function formatReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.label.length))
  const lines = ['canvas-lms-mcp doctor']
  for (const check of report.checks) {
    lines.push(`  [${MARK[check.status]}] ${check.label.padEnd(width)}  ${check.detail}`)
  }
  lines.push('')
  lines.push(
    report.ready
      ? `Result: ready (${report.profile ?? 'unknown profile'})`
      : 'Result: not ready — fix the MISSING items above',
  )
  return lines.join('\n')
}
