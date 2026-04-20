import { toolDomainCatalog } from '../tools/catalog'
import type { ToolAnnotations, ToolAudience, ToolDefinition } from '../tools/types'
import { toolAudienceOverrides, workflowCatalog } from './catalog'

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

function getRegisteredToolContexts(): RegisteredToolContext[] {
  const canvas = {} as never

  return toolDomainCatalog.flatMap((registration) =>
    registration.getTools(canvas).map((tool) => ({
      tool,
      domain: registration.domain,
      defaultPrimaryAudience: registration.defaultPrimaryAudience,
    })),
  )
}

function getAccess(annotations: ToolAnnotations): 'read' | 'write' {
  return annotations.destructiveHint ? 'write' : 'read'
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

function getRelatedWorkflowIds(toolName: string): string[] {
  return workflowCatalog
    .filter((workflow) => workflow.relatedTools.includes(toolName))
    .map((workflow) => workflow.id)
}

function getPrimaryAudience(toolName: string, defaultPrimaryAudience: ToolAudience): ToolAudience {
  return toolAudienceOverrides[toolName] ?? defaultPrimaryAudience
}

function assertWorkflowLinksExist(toolNames: Set<string>): void {
  for (const workflow of workflowCatalog) {
    for (const relatedTool of workflow.relatedTools) {
      if (!toolNames.has(relatedTool)) {
        throw new Error(`Workflow "${workflow.id}" references unknown tool "${relatedTool}".`)
      }
    }
  }
}

export function buildToolManifest(): ToolManifestDocument {
  const registeredTools = getRegisteredToolContexts()
  const toolNames = new Set(registeredTools.map(({ tool }) => tool.name))

  assertWorkflowLinksExist(toolNames)

  const tools = registeredTools.map(({ tool, domain, defaultPrimaryAudience }) => ({
    name: tool.name,
    domain,
    description: tool.description,
    annotations: compactAnnotations(tool.annotations),
    access: getAccess(tool.annotations),
    primaryAudience: getPrimaryAudience(tool.name, defaultPrimaryAudience),
    relatedWorkflows: getRelatedWorkflowIds(tool.name),
  }))

  return {
    schemaVersion: '1.0',
    packageName: 'canvas-lms-mcp',
    toolCount: tools.length,
    tools,
  }
}

export function buildWorkflowManifest(): WorkflowManifestDocument {
  const toolManifest = buildToolManifest()
  const toolNames = new Set(toolManifest.tools.map((tool) => tool.name))

  assertWorkflowLinksExist(toolNames)

  return {
    schemaVersion: '1.0',
    workflowCount: workflowCatalog.length,
    workflows: workflowCatalog,
  }
}
