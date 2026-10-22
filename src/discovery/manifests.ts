import type { CanvasClient } from '../canvas'
import { toolDomainCatalog, type ToolDomainRegistration } from '../tools/catalog'
import type { ToolAnnotations, ToolAudience, ToolDefinition } from '../tools/types'
import type { CanvasToolset } from '../tools/toolsets'
import { resolveTitle } from '../tools/titles'
import { createRegistryProbeClient } from '../tools/registry-probe'
import { workflowCatalog, type WorkflowCatalogEntry } from './catalog'

export interface ToolManifestEntry {
  name: string
  title: string
  domain: string
  description: string
  annotations: ToolAnnotations
  access: 'read' | 'write'
  primaryAudience: ToolAudience
  relatedWorkflows: string[]
  /**
   * Whether the tool advertises an `outputSchema` and returns validated
   * `structuredContent` alongside its (unchanged) text content. Migration is
   * per-tool, so during the rollout this is how a consumer tells which tools
   * carry a machine-readable contract. Added in schema version 1.1.
   */
  structuredOutput: boolean
  /**
   * The toolset this tool's domain belongs to (schema 1.2, GH #442 Phase 1).
   *
   * Published so a consumer can compute the surface `CANVAS_TOOLSETS=<x>`
   * yields without reimplementing the mapping, and so the documented
   * per-toolset counts have a generated oracle instead of a hand-kept number.
   */
  toolset: CanvasToolset
}

export interface ToolManifestDocument {
  /**
   * 1.1 added `structuredOutput` to every tool entry; 1.2 added `toolset`.
   * Both additive — a 1.0 or 1.1 reader keeps working.
   */
  schemaVersion: '1.2'
  packageName: 'canvas-lms-mcp'
  toolCount: number
  tools: ToolManifestEntry[]
}

export interface WorkflowManifestDocument {
  schemaVersion: '1.0'
  workflowCount: number
  workflows: typeof workflowCatalog
}

interface RegisteredToolContext {
  tool: ToolDefinition
  domain: string
  defaultPrimaryAudience: ToolAudience
  toolset: CanvasToolset
}

export interface ManifestBuildOptions {
  toolCatalog?: readonly ToolDomainRegistration[]
  workflowCatalog?: readonly WorkflowCatalogEntry[]
}

function createManifestCanvasProxy(): CanvasClient {
  return createRegistryProbeClient('Manifest generation')
}

function getRegisteredToolContexts(
  registrations: readonly ToolDomainRegistration[] = toolDomainCatalog,
): RegisteredToolContext[] {
  const canvas = createManifestCanvasProxy()

  return registrations.flatMap((registration) =>
    registration.getTools(canvas).map((tool) => ({
      tool,
      domain: registration.domain,
      defaultPrimaryAudience: registration.defaultPrimaryAudience,
      toolset: registration.toolset,
    })),
  )
}

function getAccess(toolName: string, annotations: ToolAnnotations): 'read' | 'write' {
  const isReadOnly = annotations.readOnlyHint === true
  const isDestructive = annotations.destructiveHint === true

  if (isReadOnly === isDestructive) {
    throw new Error(
      `Tool "${toolName}" must declare exactly one of readOnlyHint or destructiveHint.`,
    )
  }

  return isDestructive ? 'write' : 'read'
}

function compactAnnotations(annotations: ToolAnnotations): ToolAnnotations {
  const compacted: ToolAnnotations = {}

  if (annotations.readOnlyHint) {
    compacted.readOnlyHint = true
  }
  if (annotations.destructiveHint) {
    compacted.destructiveHint = true
  }
  if (annotations.idempotentHint) {
    compacted.idempotentHint = true
  }
  if (annotations.openWorldHint) {
    compacted.openWorldHint = true
  }

  return compacted
}

function getRelatedWorkflowIds(
  toolName: string,
  workflows: readonly WorkflowCatalogEntry[] = workflowCatalog,
): string[] {
  return workflows
    .filter((workflow) => workflow.relatedTools.includes(toolName))
    .map((workflow) => workflow.id)
}

/**
 * The tool's audience exactly as the server resolves it at runtime
 * (`tagAudience` in `src/tools/roles.ts`): the tool's own declared `audience`,
 * falling back to its domain's default. This is the single source of truth —
 * there is no separate manifest-only override table, so the published docs
 * can never disagree with what a role filter actually shows a caller.
 */
function getPrimaryAudience(
  tool: ToolDefinition,
  defaultPrimaryAudience: ToolAudience,
): ToolAudience {
  return tool.audience ?? defaultPrimaryAudience
}

function assertWorkflowLinksExist(
  toolNames: Set<string>,
  workflows: readonly WorkflowCatalogEntry[] = workflowCatalog,
): void {
  for (const workflow of workflows) {
    for (const relatedTool of workflow.relatedTools) {
      if (!toolNames.has(relatedTool)) {
        throw new Error(`Workflow "${workflow.id}" references unknown tool "${relatedTool}".`)
      }
    }
  }
}

export function buildToolManifest(options: ManifestBuildOptions = {}): ToolManifestDocument {
  const registeredTools = getRegisteredToolContexts(options.toolCatalog)
  const toolNames = new Set(registeredTools.map(({ tool }) => tool.name))

  assertWorkflowLinksExist(toolNames, options.workflowCatalog)

  const tools = registeredTools.map(({ tool, domain, defaultPrimaryAudience, toolset }) => ({
    name: tool.name,
    title: resolveTitle(tool.name, tool.title),
    domain,
    description: tool.description,
    annotations: compactAnnotations(tool.annotations),
    access: getAccess(tool.name, tool.annotations),
    primaryAudience: getPrimaryAudience(tool, defaultPrimaryAudience),
    relatedWorkflows: getRelatedWorkflowIds(tool.name, options.workflowCatalog),
    structuredOutput: tool.output !== undefined,
    toolset,
  }))

  return {
    schemaVersion: '1.2',
    packageName: 'canvas-lms-mcp',
    toolCount: tools.length,
    tools,
  }
}

export function buildWorkflowManifest(
  options: ManifestBuildOptions = {},
): WorkflowManifestDocument {
  const registeredTools = getRegisteredToolContexts(options.toolCatalog)
  const toolNames = new Set(registeredTools.map(({ tool }) => tool.name))

  assertWorkflowLinksExist(toolNames, options.workflowCatalog)

  return {
    schemaVersion: '1.0',
    workflowCount: (options.workflowCatalog ?? workflowCatalog).length,
    workflows: options.workflowCatalog ?? workflowCatalog,
  }
}
