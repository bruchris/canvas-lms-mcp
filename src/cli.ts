import { isEnvTruthy } from './env'
import { parseRole } from './tools/roles'
import { parseDestructiveToolsMode, type DestructiveToolsMode } from './tools/destructive-policy'
import type { CanvasRole } from './tools/types'

export interface CliConfig {
  token: string
  baseUrl: string
  mode: 'stdio' | 'http'
  port: number
  allowedOrigin: string
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

export function parseArgs(args: string[]): CliConfig {
  const envRole = parseRole(process.env.CANVAS_ROLE)
  if (envRole.invalid) {
    console.warn(
      `Unknown CANVAS_ROLE '${process.env.CANVAS_ROLE}'; ignoring and registering all tools.`,
    )
  }

  // `destructiveTools` is deliberately absent from this object *and* from its
  // type: it is resolved after the loop, once we know whether the command line
  // supplied a flag. Omitting the key makes the compiler demand it at the
  // `return` below, so the resolution cannot be dropped, and leaves no
  // placeholder here that could survive and fail *open* into `allow`.
  const config: Omit<CliConfig, 'destructiveTools'> = {
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    // `--destructive-tools=<mode>` (the documented form) and
    // `--destructive-tools <mode>` (the form every other flag in this parser
    // uses) are both accepted, because a flag that is silently ignored fails
    // *open* into `allow` — the one outcome a deployer typing this flag never
    // wants. A missing value is a startup error for the same reason.
    if (arg === DESTRUCTIVE_FLAG || arg?.startsWith(`${DESTRUCTIVE_FLAG}=`)) {
      const raw = arg === DESTRUCTIVE_FLAG ? args[++i] : arg.slice(DESTRUCTIVE_FLAG.length + 1)
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

    switch (arg) {
      case '--token':
        config.token = args[++i] ?? ''
        break
      case '--base-url':
        config.baseUrl = args[++i] ?? ''
        break
      case 'serve':
        config.mode = 'http'
        break
      case '--port': {
        const parsed = Number(args[++i])
        config.port = Number.isNaN(parsed) ? 3001 : parsed
        break
      }
      case '--allowed-origin':
        config.allowedOrigin = args[++i] ?? 'http://localhost:3000'
        break
      case '--role': {
        const raw = args[++i]
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

  if (!config.token) {
    console.error('Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN')
    process.exit(1)
  }
  if (!config.baseUrl) {
    console.error('Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL')
    process.exit(1)
  }

  return { ...config, destructiveTools }
}
