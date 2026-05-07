import { CLIENT_IDS, type ClientId } from './clients'

export interface InitConfig {
  clients: ClientId[]
  token?: string
  baseUrl?: string
  serverName: string
  pin?: string
  nonInteractive: boolean
  dryRun: boolean
  noBackup: boolean
  showHelp: boolean
}

export interface InitError {
  ok: false
  message: string
  flag?: string
}

export type ParseInitResult = { ok: true; config: InitConfig } | InitError

const SERVER_NAME_RE = /^[a-z][a-z0-9-]{0,40}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function parseInitArgs(args: string[]): ParseInitResult {
  const config: InitConfig = {
    clients: [],
    token: process.env.CANVAS_API_TOKEN || undefined,
    baseUrl: process.env.CANVAS_BASE_URL || undefined,
    serverName: 'canvas-lms',
    pin: undefined,
    nonInteractive: false,
    dryRun: false,
    noBackup: false,
    showHelp: false,
  }

  const requireValue = (flag: string, value: string | undefined): InitError | string => {
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, message: `Missing value for ${flag}`, flag }
    }
    return value
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '-h':
      case '--help':
        config.showHelp = true
        break
      case '--client': {
        const v = requireValue(arg, args[++i])
        if (typeof v !== 'string') return v
        if (!CLIENT_IDS.includes(v as ClientId)) {
          return {
            ok: false,
            message: `Unknown client "${v}". Supported: ${CLIENT_IDS.join(', ')}`,
            flag: '--client',
          }
        }
        if (!config.clients.includes(v as ClientId)) {
          config.clients.push(v as ClientId)
        }
        break
      }
      case '--token': {
        const v = requireValue(arg, args[++i])
        if (typeof v !== 'string') return v
        config.token = v
        break
      }
      case '--base-url': {
        const v = requireValue(arg, args[++i])
        if (typeof v !== 'string') return v
        const urlError = validateBaseUrl(v)
        if (urlError) return urlError
        config.baseUrl = v
        break
      }
      case '--server-name': {
        const v = requireValue(arg, args[++i])
        if (typeof v !== 'string') return v
        if (!SERVER_NAME_RE.test(v)) {
          return {
            ok: false,
            message: `--server-name must match /^[a-z][a-z0-9-]{0,40}$/, got "${v}"`,
            flag: '--server-name',
          }
        }
        config.serverName = v
        break
      }
      case '--pin': {
        const v = requireValue(arg, args[++i])
        if (typeof v !== 'string') return v
        if (!SEMVER_RE.test(v)) {
          return {
            ok: false,
            message: `--pin must be a semver string (e.g., 1.12.0), got "${v}"`,
            flag: '--pin',
          }
        }
        config.pin = v
        break
      }
      case '--non-interactive':
      case '--yes':
        config.nonInteractive = true
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--no-backup':
        config.noBackup = true
        break
      default:
        return { ok: false, message: `Unknown argument: ${arg}`, flag: arg }
    }
  }

  return { ok: true, config }
}

function validateBaseUrl(value: string): InitError | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return {
      ok: false,
      message: `--base-url is not a valid URL: ${value}`,
      flag: '--base-url',
    }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      message: `--base-url must use http(s):// (got ${url.protocol})`,
      flag: '--base-url',
    }
  }
  return undefined
}

export function helpText(): string {
  return `Usage: canvas-lms-mcp init [options]

Configures the canvas-lms-mcp server in one or more MCP clients.

Options:
  --client <id>           MCP client to configure (repeatable). Supported:
                          ${CLIENT_IDS.join(', ')}
  --token <t>             Canvas API token (else CANVAS_API_TOKEN, else prompt)
  --base-url <u>          Canvas base URL (else CANVAS_BASE_URL, else prompt)
  --server-name <name>    MCP server entry name (default: canvas-lms)
  --pin <semver>          Pin to canvas-lms-mcp@<semver> instead of latest
  --non-interactive       Fail rather than prompt; alias --yes
  --dry-run               Print planned changes; do not write
  --no-backup             Do not write <file>.bak before each change
  -h, --help              Show this help and exit
`
}
