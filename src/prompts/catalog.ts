import { describeArgument } from './arguments'
import { GENERATED_SKILLS } from './skills.generated'
import type { GeneratedSkill, PromptArgumentDescriptor, PromptDefinition } from './types'
import { isAudienceVisibleForRole } from '../tools/roles'
import type { CanvasRole } from '../tools/types'

/** Reverse-DNS `_meta` namespace, matching package.json#mcpName. */
export const PROMPT_META_KEY = 'io.github.bruchris/canvas-lms-mcp'

/**
 * A host showing the picker to a person reads the description; one deciding
 * whether to offer the workflow at all reads `_meta`. Both say the same thing,
 * and both are derived, so neither can drift from the tool registry.
 */
function composeDescription(skill: GeneratedSkill): string {
  if (skill.writeTools.length === 0) return skill.description
  return (
    `${skill.description} Uses write tools: ${skill.writeTools.join(', ')}. ` +
    'The workflow asks you to confirm before each write.'
  )
}

function describeArguments(skill: GeneratedSkill): PromptArgumentDescriptor[] {
  return skill.argumentNames.map((name) => ({
    name,
    description: describeArgument(name),
    required: false,
  }))
}

/**
 * Prompt definitions for a role, or every one when the role is unset — the same
 * filter `getAllTools` applies to tools, reading the same visibility table, so a
 * host is never offered a workflow whose tools its role filter hides.
 *
 * Like the tool filter, this is UX and context reduction, not a security
 * boundary: Canvas enforces permissions server-side, and a prompt is inert text.
 */
export function buildPromptDefinitions(
  role?: CanvasRole,
  skills: readonly GeneratedSkill[] = GENERATED_SKILLS,
): PromptDefinition[] {
  return skills
    .filter((skill) => !role || isAudienceVisibleForRole(skill.audience, role))
    .map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: composeDescription(skill),
      audience: skill.audience,
      writeTools: skill.writeTools,
      arguments: describeArguments(skill),
      body: skill.body,
    }))
}

/**
 * The prompt text: the skill body, with a context block prepended only when the
 * caller supplied something. The block says the value came from the user rather
 * than asserting it is correct — the workflow's own steps still validate it.
 */
export function buildPromptText(
  definition: PromptDefinition,
  supplied: Readonly<Record<string, string>>,
): string {
  const lines = definition.arguments
    .map((argument) => [argument.name, supplied[argument.name]?.trim() ?? ''] as const)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `- ${name}: ${value}`)

  if (lines.length === 0) return definition.body
  return `Context supplied by the user:\n${lines.join('\n')}\n\n${definition.body}`
}

export function buildPromptMeta(definition: PromptDefinition): Record<string, unknown> {
  return {
    [PROMPT_META_KEY]: {
      audience: definition.audience,
      writeTools: [...definition.writeTools],
    },
  }
}
