import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { format, resolveConfig } from 'prettier'
import { parse as parseYaml } from 'yaml'
import { getAllTools } from '../tools'
import { createRegistryProbeClient } from '../tools/registry-probe'
import type { ToolAudience } from '../tools/types'
import { isKnownArgument } from './arguments'
import type { GeneratedSkill } from './types'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const AUDIENCE_KEY = 'io.github.bruchris/canvas-lms-mcp-audience'
const ARGUMENTS_KEY = 'io.github.bruchris/canvas-lms-mcp-arguments'
const AUDIENCES: readonly ToolAudience[] = ['student', 'educator', 'admin', 'shared']
/** Agent Skills specification cap on a frontmatter `description`. */
const DESCRIPTION_LIMIT = 1024

export interface ParsedSkillFile {
  name: string
  title: string
  description: string
  audience: ToolAudience
  argumentNames: string[]
  body: string
}

function fail(fileName: string, message: string): never {
  throw new Error(`${fileName}: ${message}`)
}

function requireString(
  fileName: string,
  source: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    fail(fileName, `${where} is missing a non-empty string "${key}".`)
  }
  return value
}

/**
 * Parses one SKILL.md with a real YAML parser.
 *
 * Using the `yaml` package rather than splitting lines on their first colon is
 * deliberate. A hand-rolled parser accepts an unquoted description containing
 * ": " — exactly the defect canvas-admin-roster carried — while every other
 * Agent Skills consumer rejects the file. Sharing the ecosystem's parser is what
 * keeps a broken skill loud instead of silently ours-only.
 *
 * Unknown keys are ignored rather than rejected: the Agent Skills spec defines
 * `license`, `compatibility` and `allowed-tools`, and explicitly invites
 * third-party keys under `metadata`.
 */
export function parseSkillFile(fileName: string, raw: string): ParsedSkillFile {
  const match = raw.match(FRONTMATTER)
  if (!match) {
    fail(fileName, 'missing or unterminated YAML frontmatter — expected a leading "---" block.')
  }

  let parsed: unknown
  try {
    parsed = parseYaml(match[1]!)
  } catch (error) {
    fail(fileName, `invalid YAML frontmatter: ${(error as Error).message.split('\n')[0]}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(fileName, 'YAML frontmatter must be a mapping of keys to values.')
  }
  const frontmatter = parsed as Record<string, unknown>

  const name = requireString(fileName, frontmatter, 'name', 'frontmatter')
  const description = requireString(fileName, frontmatter, 'description', 'frontmatter')
  // The Agent Skills specification caps a frontmatter description at 1024
  // characters. The prompt description this server composes may exceed that —
  // it is not a skill file — but the file itself must stay within the limit or
  // a spec-conformant loader rejects it.
  if (description.length > DESCRIPTION_LIMIT) {
    fail(
      fileName,
      `frontmatter description is ${description.length} characters; the Agent Skills specification caps it at ${DESCRIPTION_LIMIT}.`,
    )
  }

  const rawMetadata = frontmatter.metadata
  const metadata: Record<string, unknown> =
    typeof rawMetadata === 'object' && rawMetadata !== null && !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : {}

  const audience = requireString(fileName, metadata, AUDIENCE_KEY, 'frontmatter metadata')
  if (!AUDIENCES.includes(audience as ToolAudience)) {
    fail(fileName, `unknown audience "${audience}" — expected one of ${AUDIENCES.join(', ')}.`)
  }

  const rawArguments = metadata[ARGUMENTS_KEY]
  if (rawArguments !== undefined && typeof rawArguments !== 'string') {
    fail(fileName, `"${ARGUMENTS_KEY}" must be a space-separated string.`)
  }
  const argumentNames = (rawArguments ?? '').split(/\s+/).filter(Boolean)
  for (const argument of argumentNames) {
    if (!isKnownArgument(argument)) {
      fail(fileName, `unknown prompt argument "${argument}" — add it to ARGUMENT_VOCABULARY first.`)
    }
  }
  if (new Set(argumentNames).size !== argumentNames.length) {
    fail(fileName, `duplicate prompt argument in "${argumentNames.join(' ')}".`)
  }

  const body = raw
    .slice(match[0].length)
    .replace(/^\s*\n/, '')
    .trimEnd()
  const title = body.match(/^# (.+)$/m)?.[1]?.trim()
  if (title === undefined || title === '') {
    fail(fileName, 'body has no level-1 heading ("# Title") to use as the prompt title.')
  }

  return { name, title, description, audience: audience as ToolAudience, argumentNames, body }
}

/**
 * Every registered tool name carrying `destructiveHint`.
 *
 * Both feature flags are pinned explicitly rather than left to their defaults,
 * because a skill either names a write tool or it does not — that fact must not
 * move when a deployer, or a future default, changes policy:
 *
 * - `assignmentSubmission: true` includes the two opt-in submission tools.
 * - `destructiveTools: 'allow'` keeps the seven irreversible deletes in the
 *   registry. Left unset this follows `DEFAULT_DESTRUCTIVE_TOOLS_MODE`, and if
 *   that default ever flips to `block` the set drops from 48 names to 41 —
 *   silently un-marking `canvas-office-hours` as a workflow that deletes.
 */
export function collectWriteToolNames(): Set<string> {
  // Throwing probe, shared with manifest generation: building a ToolDefinition
  // must not touch Canvas, and a permissive proxy would hide it if one did.
  const tools = getAllTools(createRegistryProbeClient('Prompt generation'), undefined, undefined, {
    assignmentSubmission: true,
    destructiveTools: 'allow',
  })
  return new Set(
    tools.filter((tool) => tool.annotations.destructiveHint === true).map((tool) => tool.name),
  )
}

/**
 * Write tools a skill body names, sorted and deduped.
 *
 * Unresolvable identifiers are ignored on purpose. Three skills deliberately
 * name tools that do not exist — "there is no `list_discussion_entries` tool" —
 * to steer the model away from them, so an identifier that does not resolve is
 * normal content, not drift.
 */
export function deriveWriteTools(body: string, writeToolNames: ReadonlySet<string>): string[] {
  const ticked = new Set([...body.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1]!))
  return [...ticked].filter((name) => writeToolNames.has(name)).sort()
}

export function buildGeneratedSkills(skillsDir = resolve('skills')): GeneratedSkill[] {
  const writeToolNames = collectWriteToolNames()
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort()
    .map((name) => {
      const path = join(skillsDir, name, 'SKILL.md')
      const parsed = parseSkillFile(`skills/${name}/SKILL.md`, readFileSync(path, 'utf8'))
      if (parsed.name !== name) {
        fail(
          `skills/${name}/SKILL.md`,
          `frontmatter name "${parsed.name}" must match its directory.`,
        )
      }
      return {
        name: parsed.name,
        title: parsed.title,
        description: parsed.description,
        argumentNames: parsed.argumentNames,
        audience: parsed.audience,
        writeTools: deriveWriteTools(parsed.body, writeToolNames),
        body: parsed.body,
      }
    })
}

const BANNER = `// GENERATED by \`pnpm generate:prompts\` from skills/*/SKILL.md. Do not edit by hand.
// Regenerate after changing any SKILL.md; tests/prompts/generate.test.ts fails if this is stale.`

/**
 * Emits the module already prettier-formatted, so `pnpm lint`, which checks
 * every file under src/, passes on generated output without an ignore rule.
 */
export async function renderGeneratedModule(skills: readonly GeneratedSkill[]): Promise<string> {
  const source = `${BANNER}
import type { GeneratedSkill } from './types'

export const GENERATED_SKILLS: readonly GeneratedSkill[] = ${JSON.stringify(skills, null, 2)}
`
  const config = await resolveConfig(resolve('src/prompts/skills.generated.ts'))
  return format(source, { ...config, parser: 'typescript' })
}
