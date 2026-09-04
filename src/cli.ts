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
   * place in the CLI path decides it, and an invalid value stops startup.
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

  const config: CliConfig = {
    token: process.env.CANVAS_API_TOKEN ?? '',
    baseUrl: process.env.CANVAS_BASE_URL ?? '',
    mode: 'stdio',
    port: 3001,
    allowedOrigin: process.env.CANVAS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
    role: envRole.role,
    enableAssignmentSubmission: isEnvTruthy(process.env.CANVAS_ENABLE_ASSIGNMENT_SUBMISSION),
    destructiveTools: parseDestructiveToolsModeOrExit(
      process.env.CANVAS_DESTRUCTIVE_TOOLS,
      'CANVAS_DESTRUCTIVE_TOOLS',
    ),
  }

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
      config.destructiveTools = parseDestructiveToolsModeOrExit(raw, DESTRUCTIVE_FLAG)
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

  if (!config.token) {
    console.error('Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN')
    process.exit(1)
  }
  if (!config.baseUrl) {
    console.error('Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL')
    process.exit(1)
  }

  return config
}
