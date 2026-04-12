import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasFile, CanvasFolder } from '../../src/canvas/types'
import { fileTools } from '../../src/tools/files'

describe('fileTools', () => {
  const mockFile: CanvasFile = {
    id: 1,
    filename: 'syllabus.pdf',
    display_name: 'Syllabus',
    url: 'https://canvas.example.com/files/1/download',
    content_type: 'application/pdf',
    size: 12345,
  }

  const mockFolder: CanvasFolder = {
    id: 1,
    name: 'Course Files',
    full_name: 'course files',
    parent_folder_id: null,
    created_at: '2026-01-01T00:00:00Z',
    files_count: 5,
    folders_count: 2,
  }

  function buildMockCanvas(): CanvasClient {
    return {
      files: {
        list: vi.fn().mockResolvedValue([mockFile]),
        listFolders: vi.fn().mockResolvedValue([mockFolder]),
        get: vi.fn().mockResolvedValue(mockFile),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 3 tool definitions', () => {
    expect(fileTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const names = fileTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_files', 'list_folders', 'get_file'])
  })

  describe('list_files', () => {
    it('has read-only annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'list_files')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.list', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'list_files')!
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.files.list).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockFile])
    })
  })

  describe('list_folders', () => {
    it('has read-only annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'list_folders')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.listFolders', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'list_folders')!
      await tool.handler({ course_id: 1 })
      expect(canvas.files.listFolders).toHaveBeenCalledWith(1)
    })
  })

  describe('get_file', () => {
    it('has read-only annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'get_file')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.get', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'get_file')!
      await tool.handler({ course_id: 1, file_id: 1 })
      expect(canvas.files.get).toHaveBeenCalledWith(1, 1)
    })
  })
})
