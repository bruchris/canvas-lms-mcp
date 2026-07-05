import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { CanvasFile, CanvasFolder } from '../canvas/types'
import type { ToolDefinition } from './types'

interface DuplicateFileEntry {
  id: number
  folder_path: string
  created_at?: string
}

interface DuplicateGroup {
  display_name: string
  size: number
  count: number
  files: DuplicateFileEntry[]
}

// Folders in the subtree rooted at `folderId`, including `folderId` itself. If
// `folderId` isn't present among `folders` (e.g. a stale/foreign id), the
// subtree is just `{ folderId }` — callers naturally get zero matching files
// rather than an error.
function collectFolderSubtree(folders: CanvasFolder[], folderId: number): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const folder of folders) {
    if (folder.parent_folder_id == null) continue
    const siblings = childrenByParent.get(folder.parent_folder_id) ?? []
    siblings.push(folder.id)
    childrenByParent.set(folder.parent_folder_id, siblings)
  }

  const subtree = new Set<number>([folderId])
  const queue = [folderId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const childId of childrenByParent.get(current) ?? []) {
      if (!subtree.has(childId)) {
        subtree.add(childId)
        queue.push(childId)
      }
    }
  }
  return subtree
}

function findDuplicateFiles(
  files: CanvasFile[],
  folders: CanvasFolder[],
  folderId?: number,
): { duplicate_groups: DuplicateGroup[]; total_redundant_copies: number } {
  const folderPathById = new Map(folders.map((f) => [f.id, f.full_name]))
  const scoped =
    folderId == null
      ? files
      : files.filter((f) => collectFolderSubtree(folders, folderId).has(f.folder_id))

  const groups = new Map<string, CanvasFile[]>()
  for (const file of scoped) {
    const key = JSON.stringify([file.display_name, file.size])
    const group = groups.get(key) ?? []
    group.push(file)
    groups.set(key, group)
  }

  const duplicate_groups: DuplicateGroup[] = []
  let total_redundant_copies = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    total_redundant_copies += group.length - 1
    duplicate_groups.push({
      display_name: group[0]!.display_name,
      size: group[0]!.size,
      count: group.length,
      files: group.map((f) => ({
        id: f.id,
        folder_path: folderPathById.get(f.folder_id) ?? `(unknown folder ${f.folder_id})`,
        ...(f.created_at !== undefined ? { created_at: f.created_at } : {}),
      })),
    })
  }

  return { duplicate_groups, total_redundant_copies }
}

export function fileTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'list_files',
      description: 'List all files in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.files.list(course_id)
      },
    },
    {
      name: 'list_folders',
      description: 'List all folders in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        return canvas.files.listFolders(course_id)
      },
    },
    {
      name: 'get_file',
      description: 'Get metadata for a single file by ID, including download URL.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        file_id: z.number().describe('The Canvas file ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const file_id = params.file_id as number
        return canvas.files.get(course_id, file_id)
      },
    },
    {
      name: 'upload_file',
      audience: 'educator',
      description:
        'Upload a file to a course. Content must be base64-encoded. Canvas performs a multi-step upload internally.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        name: z.string().describe('File name including extension'),
        content: z.string().describe('Base64-encoded file content'),
        content_type: z.string().describe('MIME type, e.g. "application/pdf" or "image/png"'),
        parent_folder_path: z
          .string()
          .optional()
          .describe('Destination folder path within the course, e.g. "subfolder/nested"'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const name = params.name as string
        const content = params.content as string
        const content_type = params.content_type as string
        const parent_folder_path = params.parent_folder_path as string | undefined
        return canvas.files.upload(course_id, name, content, content_type, parent_folder_path)
      },
    },
    {
      name: 'delete_file',
      audience: 'educator',
      description: 'Delete a file by ID. This action is permanent.',
      inputSchema: {
        file_id: z.number().describe('The Canvas file ID'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const file_id = params.file_id as number
        return canvas.files.delete(file_id)
      },
    },
    {
      name: 'download_file',
      description:
        'Download the content of a Canvas file by ID. Text files (plain text, HTML, JSON, XML, JavaScript) are returned as readable text. Binary files (images, PDFs, etc.) are returned as base64-encoded data. Files larger than 10 MB are refused.',
      inputSchema: {
        file_id: z.number().describe('The Canvas file ID'),
        course_id: z
          .number()
          .optional()
          .describe('Optional Canvas course ID to scope the file lookup'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const file_id = params.file_id as number
        const course_id = params.course_id as number | undefined
        return canvas.files.download(file_id, course_id)
      },
    },
    {
      name: 'find_duplicate_files',
      description:
        "Find duplicate files in a course's Files area — copies with the same name and size, " +
        'typically left behind by repeated course copies. Each duplicate gets flagged separately ' +
        'by accessibility checkers, so this surfaces them for cleanup with the existing ' +
        'delete_file tool. Groups by display name + size (Canvas file listings carry no content ' +
        'hash), so same-name files of different sizes are not considered duplicates.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        folder_id: z
          .number()
          .optional()
          .describe(
            'Optional Canvas folder ID to scope the search to that folder and its subfolders',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as number
        const folder_id = params.folder_id as number | undefined
        const [files, folders] = await Promise.all([
          canvas.files.list(course_id),
          canvas.files.listFolders(course_id),
        ])
        return findDuplicateFiles(files, folders, folder_id)
      },
    },
  ]
}
