import { parse as parseYaml } from 'yaml'
import type { ToolAudience } from '../tools/types'
import { isKnownArgument } from './arguments'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const AUDIENCE_KEY = 'io.github.bruchris/canvas-lms-mcp-audience'
const ARGUMENTS_KEY = 'io.github.bruchris/canvas-lms-mcp-arguments'
const AUDIENCES: readonly ToolAudience[] = ['student', 'educator', 'admin', 'shared']

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
