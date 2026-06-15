import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { contentExportsTools } from '../../src/tools/content-exports'
import type { CanvasContentExport } from '../../src/canvas/types'

const mockExport: CanvasContentExport = {
  id: 42,
  export_type: 'common_cartridge',
  workflow_state: 'created',
  progress_url: null,
  attachment: null,
  user_id: 99,
  created_at: '2026-06-14T10:00:00Z',
  updated_at: '2026-06-14T10:00:00Z',
}

const mockExported: CanvasContentExport = {
  ...mockExport,
  workflow_state: 'exported',
  progress_url: 'https://canvas.example.com/api/v1/progress/999',
  attachment: { url: 'https://s3.example.com/course_42.imscc', filename: 'course_42_export.imscc' },
}

function buildMockCanvas(): CanvasClient {
  return {
    contentExports: {
      create: vi.fn().mockResolvedValue(mockExport),
      get: vi.fn().mockResolvedValue(mockExported),
      list: vi.fn().mockResolvedValue([mockExported, mockExport]),
    },
  } as unknown as CanvasClient
}

describe('contentExportsTools', () => {
  it('returns 3 tool definitions', () => {
    expect(contentExportsTools(buildMockCanvas())).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const names = contentExportsTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['create_content_export', 'get_content_export', 'list_content_exports'])
  })

  describe('annotations', () => {
    it('create_content_export has destructiveHint + openWorldHint', () => {
      const tool = contentExportsTools(buildMockCanvas()).find(
        (t) => t.name === 'create_content_export',
      )!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('get_content_export has readOnlyHint + openWorldHint', () => {
      const tool = contentExportsTools(buildMockCanvas()).find(
        (t) => t.name === 'get_content_export',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('list_content_exports has readOnlyHint + openWorldHint', () => {
      const tool = contentExportsTools(buildMockCanvas()).find(
        (t) => t.name === 'list_content_exports',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })
  })

  describe('create_content_export', () => {
    it.each(['common_cartridge', 'qti', 'zip'] as const)(
      'delegates a %s export to canvas.contentExports.create',
      async (exportType) => {
        const canvas = buildMockCanvas()
        const tool = contentExportsTools(canvas).find((t) => t.name === 'create_content_export')!
        const result = await tool.handler({ course_id: 7, export_type: exportType })
        expect(canvas.contentExports.create).toHaveBeenCalledWith(7, exportType)
        expect(result).toEqual(mockExport)
      },
    )
  })

  describe('get_content_export', () => {
    it('delegates to canvas.contentExports.get and surfaces the attachment URL', async () => {
      const canvas = buildMockCanvas()
      const tool = contentExportsTools(canvas).find((t) => t.name === 'get_content_export')!
      const result = (await tool.handler({ course_id: 7, export_id: 42 })) as CanvasContentExport
      expect(canvas.contentExports.get).toHaveBeenCalledWith(7, 42)
      expect(result.attachment?.url).toBe('https://s3.example.com/course_42.imscc')
    })
  })

  describe('list_content_exports', () => {
    it('delegates to canvas.contentExports.list', async () => {
      const canvas = buildMockCanvas()
      const tool = contentExportsTools(canvas).find((t) => t.name === 'list_content_exports')!
      const result = await tool.handler({ course_id: 7 })
      expect(canvas.contentExports.list).toHaveBeenCalledWith(7)
      expect(result).toEqual([mockExported, mockExport])
    })
  })
})
