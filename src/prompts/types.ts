import type { ToolAudience } from '../tools/types'

/**
 * One skill as `pnpm generate:prompts` captured it from `skills/<name>/SKILL.md`.
 * Everything here is derived from the markdown — nothing is hand-maintained.
 */
export interface GeneratedSkill {
  /** Frontmatter `name`. Also the prompt name and the directory name. */
  name: string
  /** The body's first level-1 heading. */
  title: string
  /** Frontmatter `description`, verbatim. Carries the trigger phrases. */
  description: string
  /** Declared argument names, in declaration order. Each exists in ARGUMENT_VOCABULARY. */
  argumentNames: readonly string[]
  /** Audience tag driving role filtering. */
  audience: ToolAudience
  /** Registered tools with destructiveHint that the body names. Sorted, deduped. */
  writeTools: readonly string[]
  /** The markdown body with frontmatter removed, verbatim. */
  body: string
}

/** One prompt argument as advertised on `prompts/list`. Always optional. */
export interface PromptArgumentDescriptor {
  name: string
  description: string
  required: false
}

/** A skill shaped for the wire: composed description, argument descriptors, body. */
export interface PromptDefinition {
  name: string
  title: string
  description: string
  audience: ToolAudience
  writeTools: readonly string[]
  arguments: PromptArgumentDescriptor[]
  body: string
}
