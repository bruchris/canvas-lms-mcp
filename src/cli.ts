import { isEnvTruthy } from './env'
import { parseRole } from './tools/roles'
import { parseDestructiveToolsMode, type DestructiveToolsMode } from './tools/destructive-policy'
import type { CanvasRole } from './tools/types'
import { profileRequiresStaticToken, resolveAuthProfile, type AuthProfile } from './auth/profile'
import {
  OAuthConfigError,
  loadOAuthProfileConfig,
  resolveBindHost,
  type OAuthProfileConfig,
} from './auth/oauth/config'

export interface CliConfig {
  /** Canvas personal access token. Empty in the `oauth_brokered` profile. */
  token: string
  baseUrl: string
  mode: 'stdio' | 'http'
  port: number
  /**
   * Bind address for the HTTP transport. `undefined` means every interface,
   * which is what `remote_static_token` has always done (Docker relies on it).
   * `oauth_brokered` always resolves a concrete host, loopback by default.
   */
  host?: string
  allowedOrigin: string
  /**
   * Auth profile (issue #302 §3). Resolved from `--auth-profile` /
   * `CANVAS_AUTH_PROFILE`, defaulting per transport, and checked against it.
   */
  authProfile: AuthProfile
  /** Present exactly when `authProfile === 'oauth_brokered'`. */
  oauth?: OAuthProfileConfig
  /** Canvas role for tool filtering; undefined = register all tools. */
  role?: CanvasRole
  /** Opt-in: register assignment submission tools when true. */
  enableAssignmentSubmission?: boolean
  /**
   * Destructive-tool policy. Always concrete: resolved from
   * `--destructive-tools` / `CANVAS_DESTRUCTIVE_TOOLS` here so that exactly one
   * place in the CLI path decides it. The flag wins outright when present, and
   * an invalid value *of the winning source* stops startup.
   */
  destructiveTools: DestructiveToolsMode
}

const DESTRUCTIVE_FLAG = '--destructive-tools'
const DOCTOR_HINT = 'Run `canvas-lms-mcp doctor` to check your setup.'

/** Print a startup error and exit. Never returns. */
function fatal(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

/**
 * Parse a destructive-tools mode, converting the parser's thrown error into the
 * same `Error: …` + exit-1 shape the rest of this CLI uses for fatal config
 * problems. Exiting is deliberate: the alternative is starting with the delete
 * tools registered after the deployer asked for them to be blocked.
 */
function parseDestructiveToolsModeOrExit(
  raw: string | undefined,
  source: string,
): DestructiveToolsMode {
  try {
    return parseDestructiveToolsMode(raw, source)
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Read the value of a `--flag value` / `--flag=value` pair. Returns `undefined`
 * when `arg` is not this flag; exits when the flag is present without a value.
 */
function takeFlagValue(
  flag: string,
  arg: string | undefined,
  args: string[],
  index: { i: number },
): string | undefined {
  if (arg === flag) {
    const value = args[++index.i]
    if (value === undefined) fatal(`${flag} requires a value.`)
    return value
  }
  if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  return undefined
}

export function parseArgs(args: string[]): CliConfig {
  const envRole = parseRole(process.env.CANVAS_ROLE)
  if (envRole.invalid) {
    console.warn(
      `Unknown CANVAS_ROLE '${process.env.CANVAS_ROLE}'; ignoring and registering all tools.`,
    )
  }

  // `destructiveTools` and `authProfile` are deliberately absent from this
  // object *and* from its type: both are resolved after the loop, once we know
  // whether the command line supplied a flag. Omitting the keys makes the
  // compiler demand them at the `return` below, so the resolution cannot be
  // dropped, and leaves no placeholder here that could survive and fail *open*.
  const config: Omit<CliConfig, 'destructiveTools' | 'authProfile'> = {
    token: process.env.CANVAS_API_TOKEN ?? '',
    baseUrl: process.env.CANVAS_BASE_URL ?? '',
    mode: 'stdio',
    port: 3001,
    allowedOrigin: process.env.CANVAS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
    role: envRole.role,
    enableAssignmentSubmission: isEnvTruthy(process.env.CANVAS_ENABLE_ASSIGNMENT_SUBMISSION),
  }

  /** Set only when `--destructive-tools` appears in argv; `undefined` = no flag. */
  let destructiveToolsFromFlag: DestructiveToolsMode | undefined
  let authProfileFlag: string | undefined
  let hostFlag: string | undefined
  let issuerFlag: string | undefined

  const index = { i: 0 }
  for (index.i = 0; index.i < args.length; index.i++) {
    const arg = args[index.i]

    // `--destructive-tools=<mode>` (the documented form) and
    // `--destructive-tools <mode>` (the form every other flag in this parser
    // uses) are both accepted, because a flag that is silently ignored fails
    // *open* into `allow` — the one outcome a deployer typing this flag never
    // wants. A missing value is a startup error for the same reason.
    if (arg === DESTRUCTIVE_FLAG || arg?.startsWith(`${DESTRUCTIVE_FLAG}=`)) {
      const raw =
        arg === DESTRUCTIVE_FLAG ? args[++index.i] : arg.slice(DESTRUCTIVE_FLAG.length + 1)
      if (raw === undefined) {
        fatal(`${DESTRUCTIVE_FLAG} requires a value. Use ${DESTRUCTIVE_FLAG}=allow or =block.`)
      }
      // Parsed here, per occurrence, rather than deferred with the environment:
      // a repeated flag is one operator typing twice in a single command line,
      // so a bad value has no legitimate override story and refusing to start is
      // the safe direction. Among *valid* values the last one still wins.
      destructiveToolsFromFlag = parseDestructiveToolsModeOrExit(raw, DESTRUCTIVE_FLAG)
      continue
    }

    // The three profile-related flags: same "silently ignored fails open"
    // reasoning, so a missing value is fatal rather than defaulted.
    const profileValue = takeFlagValue('--auth-profile', arg, args, index)
    if (profileValue !== undefined) {
      authProfileFlag = profileValue
      continue
    }
    const hostValue = takeFlagValue('--host', arg, args, index)
    if (hostValue !== undefined) {
      hostFlag = hostValue
      continue
    }
    const issuerValue = takeFlagValue('--issuer', arg, args, index)
    if (issuerValue !== undefined) {
      issuerFlag = issuerValue
      continue
    }

    switch (arg) {
      case '--token':
        config.token = args[++index.i] ?? ''
        break
      case '--base-url':
        config.baseUrl = args[++index.i] ?? ''
        break
      case 'serve':
        config.mode = 'http'
        break
      case '--port': {
        const parsed = Number(args[++index.i])
        config.port = Number.isNaN(parsed) ? 3001 : parsed
        break
      }
      case '--allowed-origin':
        config.allowedOrigin = args[++index.i] ?? 'http://localhost:3000'
        break
      case '--role': {
        const raw = args[++index.i]
        const parsed = parseRole(raw)
        if (parsed.invalid) {
          console.warn(`Unknown --role value '${raw}'; ignoring and registering all tools.`)
        }
        // A valid --role overrides env; an invalid/`all` value falls back to all.
        config.role = parsed.role
        break
      }
      case '--enable-assignment-submission':
        config.enableAssignmentSubmission = true
        break
    }
  }

  // Precedence mirrors `resolveDestructiveToolsMode` (src/tools/destructive-policy.ts):
  // whichever source wins is the *only* source parsed. Reading the environment
  // eagerly instead — as this function used to, while building `config` above —
  // let an invalid ambient `CANVAS_DESTRUCTIVE_TOOLS` abort startup even when the
  // command line carried a valid override, making the flag unusable on precisely
  // the hosts where an operator needs it (BRU-2463).
  const destructiveTools =
    destructiveToolsFromFlag ??
    parseDestructiveToolsModeOrExit(
      process.env.CANVAS_DESTRUCTIVE_TOOLS,
      'CANVAS_DESTRUCTIVE_TOOLS',
    )

  // Same rule for the profile: the flag wins and is the only source parsed;
  // an unknown value on the winning source is fatal, never a fallback.
  let authProfile: AuthProfile
  try {
    authProfile = resolveAuthProfile({
      flag: authProfileFlag,
      env: process.env.CANVAS_AUTH_PROFILE,
      mode: config.mode,
    })
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error))
  }

  const hostRaw = hostFlag ?? process.env.CANVAS_HTTP_HOST

  if (!profileRequiresStaticToken(authProfile)) {
    // oauth_brokered: the Canvas credential comes from the OAuth flow, never
    // from the environment. A leftover PAT is worth a warning, not a refusal.
    if (config.token !== '') {
      console.warn(
        'CANVAS_API_TOKEN / --token is ignored in the oauth_brokered profile; Canvas credentials come from the OAuth flow.',
      )
      config.token = ''
    }
    let oauth: OAuthProfileConfig
    let host: string
    try {
      oauth = loadOAuthProfileConfig(process.env, {
        issuer: issuerFlag,
        baseUrl: config.baseUrl === '' ? undefined : config.baseUrl,
      })
      host = resolveBindHost(oauth, hostRaw)
    } catch (error) {
      if (error instanceof OAuthConfigError) return fatal(`${error.message}. ${DOCTOR_HINT}`)
      throw error
    }
    return {
      ...config,
      baseUrl: oauth.canvas.baseUrl,
      host,
      authProfile,
      oauth,
      destructiveTools,
    }
  }

  if (!config.token) {
    fatal(`Canvas API token required. Use --token or set CANVAS_API_TOKEN. ${DOCTOR_HINT}`)
  }
  if (!config.baseUrl) {
    fatal(`Canvas base URL required. Use --base-url or set CANVAS_BASE_URL. ${DOCTOR_HINT}`)
  }

  return {
    ...config,
    ...(hostRaw !== undefined && hostRaw.trim() !== '' ? { host: hostRaw.trim() } : {}),
    authProfile,
    destructiveTools,
  }
}
