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
 * Prompt definitions for a role, or every one when the role is unset.
 *
 * The filter reads each skill's **own declared audience** — the `metadata`
 * audience its `SKILL.md` frontmatter carries — through the same
 * `isAudienceVisibleForRole` predicate and the same visibility table
 * `getAllTools` applies to a tool's audience. That is the whole of it.
 *
 * ~~It deliberately does *not* check the tools a skill body names~~ —
 * superseded 2026-10-22 (BRU-3128). It now also drops any skill that names a
 * registered tool which is **not** in `availableToolNames`, which is how
 * "no prompt advertises a tool this server does not serve" holds across every
 * narrowing control at once: toolsets, read-only, the destructive gate, the
 * opt-in domain gates, and role. One mechanism rather than one per control,
 * and derived from the set actually registered rather than a parallel map.
 *
 * The original objection — that narrowing a skill to the intersection of its
 * tools' audiences would make it disappear from roles it is written for — was
 * measured rather than inherited: across student/teacher/admin, 0 of the 30
 * visible skills name a registered tool their role cannot see, and no skill
 * names either default-off submission tool. So the default and all three role
 * surfaces are unchanged, and the filter bites only when an operator asks for
 * a narrower surface.
 *
 * Omitting `availableToolNames` skips the tool check entirely, which is what
 * keeps `buildPromptDefinitions()` usable as "every skill" for the docs and
 * count tests.
 *
 * Like the tool filter, this is UX and context reduction, not a security
 * boundary: Canvas enforces permissions server-side, and a prompt is inert text.
 * `_meta.writeTools` publishes the derived set so a host can filter further.
 */
export function buildPromptDefinitions(
  role?: CanvasRole,
  skills: readonly GeneratedSkill[] = GENERATED_SKILLS,
  availableToolNames?: ReadonlySet<string>,
): PromptDefinition[] {
  return skills
    .filter((skill) => !role || isAudienceVisibleForRole(skill.audience, role))
    .filter(
      (skill) => !availableToolNames || skill.tools.every((name) => availableToolNames.has(name)),
    )
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
 * Every argument in the vocabulary is a Canvas ID, so a value has no legitimate
 * reason to span lines. Collapsing whitespace keeps one supplied value on one
 * rendered line: without it, a value like `42\n- assignment_id: 999` forges a
 * context line for an argument the caller never supplied, and a value
 * containing a blank line escapes the block entirely to put arbitrary text
 * above the workflow. The value is still shown in full — only its layout is
 * normalised.
 */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
    .map((argument) => [argument.name, flatten(supplied[argument.name] ?? '')] as const)
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
