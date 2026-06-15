import type { InitConfig } from './argv'
import { parseRole } from '../tools/roles'
import type { CanvasRole } from '../tools/types'
import {
  CLIENTS,
  detectInstalled,
  getClient,
  type ClientDescriptor,
  type ClientId,
  type PathEnv,
} from './clients'
import type { McpEntry, WriteConfigOptions } from './config-writer'
import type { FileSystem } from './io'
import type { ValidateResult } from './validate'

export interface WizardDeps {
  fs: FileSystem
  env: PathEnv
  prompts: (question: unknown) => Promise<Record<string, unknown>>
  pingUsersSelf: (token: string, baseUrl: string) => Promise<ValidateResult>
  writeClientConfigs: (
    fs: FileSystem,
    targets: ClientDescriptor[],
    entry: McpEntry,
    opts?: WriteConfigOptions,
  ) => Promise<void>
  log: (message: string) => void
}

export interface WizardOptions {
  initialConfig: InitConfig
}

export interface WizardResult {
  exitCode: number
  message?: string
}

const MAX_TOKEN_ATTEMPTS = 3

export async function runWizard(deps: WizardDeps, opts: WizardOptions): Promise<WizardResult> {
  const cfg = opts.initialConfig

  // Step 1: base URL
  const baseUrl = await resolveBaseUrl(deps, cfg)
  if (!baseUrl.ok) return { exitCode: 2, message: baseUrl.message }

  // Step 2: token + Step 3: validate (with retry on hard fail, soft-fail confirm).
  const tokenStep = await resolveTokenAndValidate(deps, cfg, baseUrl.value)
  if (!tokenStep.ok) return { exitCode: 2, message: tokenStep.message }

  // Step 4: clients
  const clientStep = await resolveClients(deps, cfg)
  if (!clientStep.ok) return { exitCode: 2, message: clientStep.message }
  const targets = clientStep.value

  // Step 5: role (optional tool filtering)
  const role = await resolveRole(deps, cfg)

  // Step 6: write
  const entry = buildEntry(tokenStep.value, baseUrl.value, cfg.pin, role)
  if (cfg.dryRun) {
    deps.log('Dry-run: skipping config writes. Would have written:')
    for (const target of targets) {
      const path = target.resolvePath(deps.env)
      deps.log(`  - ${target.name} -> ${path}`)
    }
    return { exitCode: 0 }
  }

  await deps.writeClientConfigs(deps.fs, targets, entry, {
    serverName: cfg.serverName,
    noBackup: cfg.noBackup,
    pathEnv: deps.env,
  })

  // Step 6: summary
  deps.log('')
  deps.log('Done. Wrote canvas-lms entry to:')
  for (const target of targets) {
    deps.log(`  - ${target.name} (${target.resolvePath(deps.env)})`)
  }
  deps.log('Restart your MCP clients to pick up the new server.')
  return { exitCode: 0 }
}

interface StepOk<T> {
  ok: true
  value: T
}
interface StepErr {
  ok: false
  message: string
}

function err(message: string): StepErr {
  return { ok: false, message }
}

export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (!/\/api\/v\d+$/i.test(url)) {
    url = `${url}/api/v1`
  }
  return url
}

async function resolveBaseUrl(
  deps: WizardDeps,
  cfg: InitConfig,
): Promise<StepOk<string> | StepErr> {
  if (cfg.baseUrl) return { ok: true, value: normalizeBaseUrl(cfg.baseUrl) }
  if (cfg.nonInteractive) {
    deps.log('Error: --base-url is required in non-interactive mode.')
    return err('--base-url is required')
  }

  const ans = await deps.prompts({
    type: 'text',
    name: 'baseUrl',
    message: 'Canvas base URL (e.g., https://school.instructure.com):',
    validate: (v: string) => (isUrlLike(v) ? true : 'Enter an http(s):// URL'),
  })
  const raw = typeof ans.baseUrl === 'string' ? ans.baseUrl : ''
  if (!raw) return err('Cancelled — no base URL provided.')
  return { ok: true, value: normalizeBaseUrl(raw) }
}

function isUrlLike(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function resolveTokenAndValidate(
  deps: WizardDeps,
  cfg: InitConfig,
  baseUrl: string,
): Promise<StepOk<string> | StepErr> {
  let token = cfg.token

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    if (!token) {
      if (cfg.nonInteractive) {
        deps.log('Error: --token is required in non-interactive mode.')
        return err('--token is required')
      }
      const ans = await deps.prompts({
        type: 'password',
        name: 'token',
        message: attempt === 0 ? 'Canvas API token:' : 'Canvas API token (re-enter):',
      })
      token = typeof ans.token === 'string' ? ans.token : ''
      if (!token) return err('Cancelled — no token provided.')
    }

    deps.log(`Validating token against ${baseUrl}/users/self ...`)
    const result = await deps.pingUsersSelf(token, baseUrl)
    if (result.ok) {
      const who = result.displayName ?? 'unknown user'
      deps.log(`  Authenticated as ${who}.`)
      return { ok: true, value: token }
    }

    if (result.status !== undefined && result.status !== 401) {
      // 5xx etc. — soft failure.
      if (cfg.nonInteractive) {
        deps.log(`Error: ${result.hint ?? 'validation failed'} (status ${result.status})`)
        return err('validation failed')
      }
      const proceed = await confirmContinue(deps, result.hint ?? 'Canvas unreachable')
      if (proceed) return { ok: true, value: token }
      return err('Cancelled by user.')
    }

    if (result.status === undefined) {
      // Network / unknown — soft failure.
      if (cfg.nonInteractive) {
        deps.log(`Error: ${result.hint ?? 'network failure'}`)
        return err('network failure')
      }
      const proceed = await confirmContinue(deps, result.hint ?? 'Canvas unreachable')
      if (proceed) return { ok: true, value: token }
      return err('Cancelled by user.')
    }

    // 401 — hard failure, re-prompt.
    deps.log(`  Token is invalid or expired${result.hint ? `: ${result.hint}` : ''}`)
    if (cfg.nonInteractive) return err('token rejected by Canvas')
    token = undefined
  }

  deps.log(`Error: token rejected ${MAX_TOKEN_ATTEMPTS} times. Aborting.`)
  return err('too many failed token attempts')
}

async function confirmContinue(deps: WizardDeps, hint: string): Promise<boolean> {
  const ans = await deps.prompts({
    type: 'confirm',
    name: 'proceed',
    message: `${hint} Continue anyway?`,
    initial: false,
  })
  return ans.proceed === true
}

async function resolveRole(deps: WizardDeps, cfg: InitConfig): Promise<CanvasRole | undefined> {
  // `--role` already supplied (incl. explicit `all`), or non-interactive: don't prompt.
  if (cfg.role !== undefined) return cfg.role === 'all' ? undefined : cfg.role
  if (cfg.nonInteractive) return undefined

  const ans = await deps.prompts({
    type: 'select',
    name: 'role',
    message: 'Filter tools by Canvas role? ("all" exposes every tool — recommended)',
    choices: [
      { title: 'all (every tool)', value: 'all' },
      { title: 'student', value: 'student' },
      { title: 'teacher', value: 'teacher' },
      { title: 'admin', value: 'admin' },
    ],
    initial: 0,
  })
  const raw = typeof ans.role === 'string' ? ans.role : 'all'
  return parseRole(raw).role
}

async function resolveClients(
  deps: WizardDeps,
  cfg: InitConfig,
): Promise<StepOk<ClientDescriptor[]> | StepErr> {
  if (cfg.clients.length > 0) {
    const targets = cfg.clients
      .map((id) => getClient(id))
      .filter((c): c is ClientDescriptor => c !== undefined)
    return { ok: true, value: targets }
  }

  if (cfg.nonInteractive) {
    deps.log('Error: --client is required in non-interactive mode.')
    return err('--client is required')
  }

  const installed = await detectInstalled(deps.fs, deps.env)
  const choices = CLIENTS.map((c) => ({
    title: installed.has(c.id) ? `${c.name} (detected)` : c.name,
    value: c.id,
    selected: installed.has(c.id),
  }))
  const ans = await deps.prompts({
    type: 'multiselect',
    name: 'clients',
    message: 'Which MCP clients do you want to configure?',
    choices,
    min: 1,
    instructions: false,
  })
  const ids = Array.isArray(ans.clients) ? (ans.clients as ClientId[]) : []
  if (ids.length === 0) {
    deps.log('Error: no clients selected. Aborting.')
    return err('no clients selected')
  }
  const targets = ids
    .map((id) => getClient(id))
    .filter((c): c is ClientDescriptor => c !== undefined)
  return { ok: true, value: targets }
}

function buildEntry(
  token: string,
  baseUrl: string,
  pin: string | undefined,
  role: CanvasRole | undefined,
): McpEntry {
  const pkg = pin ? `canvas-lms-mcp@${pin}` : 'canvas-lms-mcp'
  const env: Record<string, string> = {
    CANVAS_API_TOKEN: token,
    CANVAS_BASE_URL: baseUrl,
  }
  if (role) env.CANVAS_ROLE = role
  return {
    command: 'npx',
    args: ['-y', pkg],
    env,
  }
}
