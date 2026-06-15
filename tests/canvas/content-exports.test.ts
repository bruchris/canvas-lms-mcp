import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContentExportsModule } from '../../src/canvas/content-exports'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasContentExport } from '../../src/canvas/types'

const COURSE_ID = 100
const EXPORT_ID = 42

const BASE_EXPORT: CanvasContentExport = {
  id: EXPORT_ID,
  export_type: 'common_cartridge',
  workflow_state: 'created',
  progress_url: null,
  attachment: null,
  user_id: 99,
  created_at: '2026-06-14T10:00:00Z',
  updated_at: '2026-06-14T10:00:00Z',
}

const EXPORTING_EXPORT: CanvasContentExport = {
  ...BASE_EXPORT,
  workflow_state: 'exporting',
  progress_url: 'https://canvas.example.com/api/v1/progress/999',
}

const EXPORTED_EXPORT: CanvasContentExport = {
  ...BASE_EXPORT,
  workflow_state: 'exported',
  progress_url: 'https://canvas.example.com/api/v1/progress/999',
  attachment: {
    url: 'https://s3.example.com/course_42.imscc',
    filename: 'course_42_export.imscc',
  },
}

const FAILED_EXPORT: CanvasContentExport = {
  ...BASE_EXPORT,
  workflow_state: 'failed',
  progress_url: null,
}

describe('ContentExportsModule', () => {
  let client: CanvasHttpClient
  let mod: ContentExportsModule

  beforeEach(() => {
    client = new CanvasHttpClient({ token: 'test-token', baseUrl: 'https://canvas.example.com' })
    mod = new ContentExportsModule(client)
  })

  it('creates a content export with a flat export_type body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(BASE_EXPORT)
    const result = await mod.create(COURSE_ID, 'common_cartridge')
    expect(result).toMatchObject({ id: EXPORT_ID, workflow_state: 'created', attachment: null })
    expect(client.request).toHaveBeenCalledWith(
      `/api/v1/courses/${COURSE_ID}/content_exports`,
      expect.objectContaining({ method: 'POST' }),
    )
    // Body is flat JSON ({ export_type }), NOT wrapped in a content_export envelope.
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toEqual({ export_type: 'common_cartridge' })
  })

  it.each(['common_cartridge', 'qti', 'zip'] as const)(
    'creates a %s export',
    async (exportType) => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({ ...BASE_EXPORT, export_type: exportType })
      await mod.create(COURSE_ID, exportType)
      const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
      expect(body).toEqual({ export_type: exportType })
    },
  )

  it('gets an in-progress export (attachment null, progress_url present)', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(EXPORTING_EXPORT)
    const result = await mod.get(COURSE_ID, EXPORT_ID)
    expect(result.attachment).toBeNull()
    expect(result.progress_url).not.toBeNull()
    expect(client.request).toHaveBeenCalledWith(
      `/api/v1/courses/${COURSE_ID}/content_exports/${EXPORT_ID}`,
    )
  })

  it('gets a finished export and surfaces the attachment download URL', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(EXPORTED_EXPORT)
    const result = await mod.get(COURSE_ID, EXPORT_ID)
    expect(result.workflow_state).toBe('exported')
    expect(result.attachment?.url).toBe('https://s3.example.com/course_42.imscc')
    expect(result.attachment?.filename).toBe('course_42_export.imscc')
  })

  it('gets a failed export without throwing (attachment null)', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(FAILED_EXPORT)
    const result = await mod.get(COURSE_ID, EXPORT_ID)
    expect(result.workflow_state).toBe('failed')
    expect(result.attachment).toBeNull()
  })

  it('lists content exports for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([EXPORTED_EXPORT, BASE_EXPORT])
    const result = await mod.list(COURSE_ID)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith(`/api/v1/courses/${COURSE_ID}/content_exports`)
  })

  // --- Error propagation (CanvasApiError must surface, never be swallowed) ---

  it('surfaces a CanvasApiError with status 404 from get', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ errors: [{ message: 'The specified resource does not exist.' }] }),
    } as unknown as Response)
    await expect(mod.get(COURSE_ID, 999)).rejects.toMatchObject({
      name: 'CanvasApiError',
      status: 404,
    })
  })

  it('surfaces a CanvasApiError with status 403 from create', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: 'user not authorized to perform that action' }),
    } as unknown as Response)
    await expect(mod.create(COURSE_ID, 'zip')).rejects.toMatchObject({
      name: 'CanvasApiError',
      status: 403,
    })
  })
})
