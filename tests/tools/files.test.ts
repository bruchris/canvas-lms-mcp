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

  const mockDownloadedFile = {
    type: 'text' as const,
    filename: 'syllabus.pdf',
    contentType: 'text/plain',
    size: 5,
    text: 'hello',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      files: {
        list: vi.fn().mockResolvedValue([mockFile]),
        listFolders: vi.fn().mockResolvedValue([mockFolder]),
        get: vi.fn().mockResolvedValue(mockFile),
        upload: vi.fn().mockResolvedValue(mockFile),
        delete: vi.fn().mockResolvedValue(mockFile),
        download: vi.fn().mockResolvedValue(mockDownloadedFile),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 7 tool definitions', () => {
    expect(fileTools(buildMockCanvas())).toHaveLength(7)
  })

  it('exports tools with correct names', () => {
    const names = fileTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_files',
      'list_folders',
      'get_file',
      'upload_file',
      'delete_file',
      'download_file',
      'find_duplicate_files',
    ])
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

    it('delegates to canvas.files.delete and returns the deleted file', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'delete_file')!
      const result = await tool.handler({ file_id: 99 })
      expect(canvas.files.delete).toHaveBeenCalledWith(99)
      expect(result).toMatchObject({ id: mockFile.id })
    })
  })

  describe('download_file', () => {
    it('has read-only annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'download_file')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.files.download with file_id and optional course_id', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'download_file')!
      const result = await tool.handler({ file_id: 42, course_id: 7 })
      expect(canvas.files.download).toHaveBeenCalledWith(42, 7)
      expect(result).toEqual(mockDownloadedFile)
    })

    it('passes undefined course_id when not provided', async () => {
      const canvas = buildMockCanvas()
      const tool = fileTools(canvas).find((t) => t.name === 'download_file')!
      await tool.handler({ file_id: 42 })
      expect(canvas.files.download).toHaveBeenCalledWith(42, undefined)
    })
  })

  describe('find_duplicate_files', () => {
    it('has read-only annotations', () => {
      const tool = fileTools(buildMockCanvas()).find((t) => t.name === 'find_duplicate_files')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('returns no duplicate groups when every file is unique', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'a.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 2,
              display_name: 'b.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 20,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result).toEqual({ duplicate_groups: [], total_redundant_copies: 0 })
    })

    it('returns an empty result for a course with no files', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([]),
          listFolders: vi.fn().mockResolvedValue([]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result).toEqual({ duplicate_groups: [], total_redundant_copies: 0 })
    })

    it('does not group same-name files that differ in size', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'notes.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 100,
              folder_id: 1,
            },
            {
              id: 2,
              display_name: 'notes.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 200,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result).toEqual({ duplicate_groups: [], total_redundant_copies: 0 })
    })

    it('groups files with matching name and size, resolving folder paths', async () => {
      const subFolder = {
        id: 2,
        name: 'Week 1',
        full_name: 'course files/Week 1',
        parent_folder_id: 1,
      }
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'syllabus.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 500,
              folder_id: 1,
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 2,
              display_name: 'syllabus.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 500,
              folder_id: 2,
              created_at: '2026-02-01T00:00:00Z',
            },
            {
              id: 3,
              display_name: 'other.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 999,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder, subFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result).toEqual({
        duplicate_groups: [
          {
            display_name: 'syllabus.pdf',
            size: 500,
            count: 2,
            files: [
              { id: 1, folder_path: 'course files', created_at: '2026-01-01T00:00:00Z' },
              { id: 2, folder_path: 'course files/Week 1', created_at: '2026-02-01T00:00:00Z' },
            ],
          },
        ],
        total_redundant_copies: 1,
      })
      expect(canvas.files.list).toHaveBeenCalledWith(1)
      expect(canvas.files.listFolders).toHaveBeenCalledWith(1)
    })

    it('scopes to a folder subtree when folder_id is provided', async () => {
      const subFolder = {
        id: 2,
        name: 'Week 1',
        full_name: 'course files/Week 1',
        parent_folder_id: 1,
      }
      const otherFolder = {
        id: 3,
        name: 'Week 2',
        full_name: 'course files/Week 2',
        parent_folder_id: null,
      }
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 2,
            },
            {
              id: 2,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 2,
            },
            {
              id: 3,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 3,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder, subFolder, otherFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1, folder_id: 1 })

      expect(result).toEqual({
        duplicate_groups: [
          {
            display_name: 'dup.pdf',
            size: 10,
            count: 2,
            files: [
              { id: 1, folder_path: 'course files/Week 1' },
              { id: 2, folder_path: 'course files/Week 1' },
            ],
          },
        ],
        total_redundant_copies: 1,
      })
    })

    it('scopes through a multi-level subtree (grandchild folders)', async () => {
      const child = { id: 2, name: 'Unit 1', full_name: 'course files/Unit 1', parent_folder_id: 1 }
      const grandchild = {
        id: 3,
        name: 'Readings',
        full_name: 'course files/Unit 1/Readings',
        parent_folder_id: 2,
      }
      const outside = {
        id: 4,
        name: 'Unit 2',
        full_name: 'course files/Unit 2',
        parent_folder_id: null,
      }
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 3,
            },
            {
              id: 2,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 3,
            },
            {
              id: 3,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 4,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder, child, grandchild, outside]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1, folder_id: 1 })

      expect(result.duplicate_groups).toHaveLength(1)
      expect(result.duplicate_groups[0].count).toBe(2)
      expect(result.duplicate_groups[0].files.map((f: { id: number }) => f.id)).toEqual([1, 2])
    })

    it('returns an empty result when folder_id does not match any known folder', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 2,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1, folder_id: 999 })

      expect(result).toEqual({ duplicate_groups: [], total_redundant_copies: 0 })
    })

    it('falls back to a placeholder folder_path when a file references an unknown folder', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 77,
            },
            {
              id: 2,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 77,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result.duplicate_groups[0].files).toEqual([
        { id: 1, folder_path: '(unknown folder 77)' },
        { id: 2, folder_path: '(unknown folder 77)' },
      ])
    })

    it('handles a group with 3+ files and computes total_redundant_copies as count - 1', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 2,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 3,
              display_name: 'dup.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result.duplicate_groups).toHaveLength(1)
      expect(result.duplicate_groups[0].count).toBe(3)
      expect(result.total_redundant_copies).toBe(2)
    })

    it('returns multiple independent duplicate groups in a single call', async () => {
      const canvas: CanvasClient = {
        files: {
          list: vi.fn().mockResolvedValue([
            {
              id: 1,
              display_name: 'a.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 2,
              display_name: 'a.pdf',
              content_type: 'application/pdf',
              url: '',
              size: 10,
              folder_id: 1,
            },
            {
              id: 3,
              display_name: 'b.docx',
              content_type: 'application/msword',
              url: '',
              size: 30,
              folder_id: 1,
            },
            {
              id: 4,
              display_name: 'b.docx',
              content_type: 'application/msword',
              url: '',
              size: 30,
              folder_id: 1,
            },
            {
              id: 5,
              display_name: 'unique.png',
              content_type: 'image/png',
              url: '',
              size: 40,
              folder_id: 1,
            },
          ]),
          listFolders: vi.fn().mockResolvedValue([mockFolder]),
        },
      } as unknown as CanvasClient
      const tool = fileTools(canvas).find((t) => t.name === 'find_duplicate_files')!

      const result = await tool.handler({ course_id: 1 })

      expect(result.duplicate_groups).toHaveLength(2)
      expect(
        result.duplicate_groups.map((g: { display_name: string }) => g.display_name).sort(),
      ).toEqual(['a.pdf', 'b.docx'])
      expect(result.total_redundant_copies).toBe(2)
    })
  })
})
