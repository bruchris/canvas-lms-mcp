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
    folder_id: 1,
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
        upload: vi.fn().mockResolvedValue(mockFile),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 5 tool definitions', () => {
    expect(fileTools(buildMockCanvas())).toHaveLength(5)
  })

  it('exports tools with correct names', () => {
    const names = fileTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_files', 'list_folders', 'get_file', 'upload_file', 'delete_file'])
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

  describe('upload_file', () => {
    it('has destructive annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'upload_file')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.upload with all params', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'upload_file')!
      const result = await tool.handler({
        course_id: 1,
        name: 'test.txt',
        content: 'aGVsbG8=',
        content_type: 'text/plain',
        parent_folder_path: 'week1',
      })
      expect(canvas.files.upload).toHaveBeenCalledWith(
        1,
        'test.txt',
        'aGVsbG8=',
        'text/plain',
        'week1',
      )
      expect(result).toEqual(mockFile)
    })

    it('passes undefined for omitted parent_folder_path', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'upload_file')!
      await tool.handler({
        course_id: 1,
        name: 'f.pdf',
        content: 'YQ==',
        content_type: 'application/pdf',
      })
      expect(canvas.files.upload).toHaveBeenCalledWith(
        1,
        'f.pdf',
        'YQ==',
        'application/pdf',
        undefined,
      )
    })
  })

  describe('delete_file', () => {
    it('has destructive annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'delete_file')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.delete and returns confirmation', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'delete_file')!
      const result = await tool.handler({ file_id: 99 })
      expect(canvas.files.delete).toHaveBeenCalledWith(99)
      expect(result).toEqual({ deleted: true, file_id: 99 })
    })
  })
})
