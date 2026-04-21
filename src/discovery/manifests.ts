import type { CanvasClient } from '../canvas'
import { toolDomainCatalog, type ToolDomainRegistration } from '../tools/catalog'
import type { ToolAnnotations, ToolAudience, ToolDefinition } from '../tools/types'
import { toolAudienceOverrides, workflowCatalog, type WorkflowCatalogEntry } from './catalog'

export interface ToolManifestEntry {
  name: string
  domain: string
  description: string
  annotations: ToolAnnotations
  access: 'read' | 'write'
  primaryAudience: ToolAudience
  relatedWorkflows: string[]
}

export interface ToolManifestDocument {
  schemaVersion: '1.0'
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
}

export interface ManifestBuildOptions {
  toolCatalog?: readonly ToolDomainRegistration[]
  workflowCatalog?: readonly WorkflowCatalogEntry[]
  toolAudienceOverrides?: Readonly<Record<string, ToolAudience>>
}

function createManifestCanvasProxy(): CanvasClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `Manifest generation accessed Canvas client during tool registration via "${String(property)}".`,
        )
      },
    },
  ) as CanvasClient
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

function getPrimaryAudience(
  toolName: string,
  defaultPrimaryAudience: ToolAudience,
  audienceOverrides: Readonly<Record<string, ToolAudience>> = toolAudienceOverrides,
): ToolAudience {
  return audienceOverrides[toolName] ?? defaultPrimaryAudience
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

function assertAudienceOverrideLinksExist(
  toolNames: Set<string>,
  audienceOverrides: Readonly<Record<string, ToolAudience>> = toolAudienceOverrides,
): void {
  for (const toolName of Object.keys(audienceOverrides)) {
    if (!toolNames.has(toolName)) {
      throw new Error(`Audience override references unknown tool "${toolName}".`)
    }
  }
}

export function buildToolManifest(options: ManifestBuildOptions = {}): ToolManifestDocument {
  const registeredTools = getRegisteredToolContexts(options.toolCatalog)
  const toolNames = new Set(registeredTools.map(({ tool }) => tool.name))

  assertAudienceOverrideLinksExist(toolNames, options.toolAudienceOverrides)
  assertWorkflowLinksExist(toolNames, options.workflowCatalog)

  const tools = registeredTools.map(({ tool, domain, defaultPrimaryAudience }) => ({
    name: tool.name,
    domain,
    description: tool.description,
    annotations: compactAnnotations(tool.annotations),
    access: getAccess(tool.name, tool.annotations),
    primaryAudience: getPrimaryAudience(
      tool.name,
      defaultPrimaryAudience,
      options.toolAudienceOverrides,
    ),
    relatedWorkflows: getRelatedWorkflowIds(tool.name, options.workflowCatalog),
  }))

  return {
    schemaVersion: '1.0',
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
