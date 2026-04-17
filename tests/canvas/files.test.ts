import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FilesModule } from '../../src/canvas/files'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('FilesModule', () => {
  let client: CanvasHttpClient
  let files: FilesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    files = new FilesModule(client)
  })

  it('lists files for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        display_name: 'syllabus.pdf',
        content_type: 'application/pdf',
        url: 'https://example.com/file',
        size: 1024,
        folder_id: 1,
      },
    ])
    const result = await files.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/files')
  })

  it('lists folders for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'course files', full_name: 'course files', parent_folder_id: null },
    ])
    const result = await files.listFolders(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/folders')
  })

  it('gets a single file', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      display_name: 'syllabus.pdf',
      content_type: 'application/pdf',
      url: 'https://example.com/file',
      size: 1024,
      folder_id: 1,
    })
    const result = await files.get(100, 1)
    expect(result).toMatchObject({ id: 1, display_name: 'syllabus.pdf' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/files/1')
  })

  describe('upload', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('completes multi-step upload when S3 returns a redirect', async () => {
      const uploadInfo = {
        upload_url: 'https://s3.example.com/upload',
        upload_params: { key: 'course/file', 'Content-Type': 'text/plain' },
      }
      const confirmedFile = {
        id: 42,
        display_name: 'notes.txt',
        filename: 'notes.txt',
        content_type: 'text/plain',
        url: 'https://canvas.example.com/files/42/download',
        size: 11,
        folder_id: 5,
      }

      vi.spyOn(client, 'request')
        .mockResolvedValueOnce(uploadInfo) // step 1: notify Canvas
        .mockResolvedValueOnce(confirmedFile) // step 3: confirm

      const mockS3Response = new Response(null, {
        status: 303,
        headers: { location: 'https://canvas.example.com/api/v1/files/42/confirm' },
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockS3Response))

      const result = await files.upload(100, 'notes.txt', btoa('hello world'), 'text/plain')

      expect(client.request).toHaveBeenNthCalledWith(
        1,
        '/api/v1/courses/100/files',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://s3.example.com/upload',
        expect.objectContaining({ redirect: 'manual' }),
      )
      expect(client.request).toHaveBeenNthCalledWith(
        2,
        'https://canvas.example.com/api/v1/files/42/confirm',
        { method: 'POST' },
      )
      expect(result).toMatchObject({ id: 42, display_name: 'notes.txt' })
    })

    it('includes parent_folder_path when provided', async () => {
      const confirmedFile = {
        id: 10,
        display_name: 'doc.pdf',
        content_type: 'application/pdf',
        url: 'https://canvas.example.com/files/10/download',
        size: 100,
        folder_id: 2,
      }
      vi.spyOn(client, 'request')
        .mockResolvedValueOnce({
          upload_url: 'https://s3.example.com/upload',
          upload_params: {},
        })
        .mockResolvedValueOnce(confirmedFile)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(null, {
            status: 303,
            headers: { location: 'https://canvas.example.com/api/v1/files/10/confirm' },
          }),
        ),
      )

      await files.upload(100, 'doc.pdf', btoa('data'), 'application/pdf', 'assignments/week1')

      expect(client.request).toHaveBeenNthCalledWith(
        1,
        '/api/v1/courses/100/files',
        expect.objectContaining({
          body: expect.stringContaining('assignments/week1'),
        }),
      )
    })

    it('returns file directly when upload_url returns 200', async () => {
      const uploadInfo = {
        upload_url: 'https://canvas.example.com/upload',
        upload_params: {},
      }
      const confirmedFile = {
        id: 7,
        display_name: 'img.png',
        content_type: 'image/png',
        url: 'https://canvas.example.com/files/7/download',
        size: 50,
        folder_id: 1,
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(uploadInfo)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify(confirmedFile), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      const result = await files.upload(100, 'img.png', btoa('png'), 'image/png')
      expect(result).toMatchObject({ id: 7 })
    })

    it('throws plain Error (not CanvasApiError) when S3 returns an error status', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response('Forbidden', { status: 403 })),
      )

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'File upload to storage failed (HTTP 403)',
      )
    })

    it('throws plain Error when S3 redirect has no Location header', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 303 })))

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'File upload redirect missing Location header',
      )
    })

    it('throws CanvasApiError when Canvas rejects step 1', async () => {
      const { CanvasApiError } = await import('../../src/canvas/client')
      vi.spyOn(client, 'request').mockRejectedValueOnce(
        new CanvasApiError('Bad request', 400, '/api/v1/courses/100/files'),
      )

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        CanvasApiError,
      )
    })

    it('throws descriptive error when S3 fetch fails with network error', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')))

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'Unable to reach file storage (s3.example.com)',
      )
    })

    it('throws descriptive error when S3 returns non-JSON 200 response', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response('<Error><Code>AccessDenied</Code></Error>', {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
        ),
      )

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'File upload response is not valid JSON',
      )
    })

    it('throws when S3 redirect Location hostname does not match Canvas base URL', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(null, {
            status: 303,
            headers: { location: 'https://evil.example.com/api/v1/files/42/confirm' },
          }),
        ),
      )

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'File upload redirect points to unexpected host (evil.example.com)',
      )
    })

    it('throws when S3 200 response has no id field', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        upload_url: 'https://s3.example.com/upload',
        upload_params: {},
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await expect(files.upload(100, 'file.txt', btoa('data'), 'text/plain')).rejects.toThrow(
        'File upload returned unexpected response (no file ID)',
      )
    })

    it('throws descriptive error when base64 input is invalid', async () => {
      await expect(
        files.upload(100, 'file.txt', 'not-valid-base64!!!', 'text/plain'),
      ).rejects.toThrow('Invalid base64 content')
    })
  })

  describe('delete', () => {
    it('returns the deleted file object from Canvas', async () => {
      const deletedFile = {
        id: 99,
        display_name: 'old.pdf',
        content_type: 'application/pdf',
        url: 'https://canvas.example.com/files/99/download',
        size: 2048,
        folder_id: 3,
      }
      vi.spyOn(client, 'request').mockResolvedValueOnce(deletedFile)
      const result = await files.delete(99)
      expect(result).toMatchObject({ id: 99, display_name: 'old.pdf' })
      expect(client.request).toHaveBeenCalledWith('/api/v1/files/99', { method: 'DELETE' })
    })
  })
})
