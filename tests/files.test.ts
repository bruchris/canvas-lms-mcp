import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FilesModule } from '../src/canvas/files'
import type { CanvasHttpClient } from '../src/canvas/client'
import type { CanvasFile } from '../src/canvas/types'

const BASE_META: CanvasFile = {
  id: 42,
  display_name: 'notes.txt',
  filename: 'notes.txt',
  content_type: 'text/plain',
  url: 'https://cdn.example.com/files/42/download?token=abc',
  size: 12,
  folder_id: 1,
}

function makeMockClient(requestImpl: (endpoint: string) => unknown): CanvasHttpClient {
  return { request: vi.fn().mockImplementation(requestImpl) } as unknown as CanvasHttpClient
}

function makeResponse(options: {
  ok?: boolean
  status?: number
  contentType?: string
  contentLength?: string | null
  body: string | Uint8Array
}): Response {
  const {
    ok = true,
    status = 200,
    contentType = 'text/plain',
    contentLength = null,
    body,
  } = options
  const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    ok,
    status,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return contentType
        if (name === 'content-length') return contentLength
        return null
      },
    },
    arrayBuffer: async () => bodyBytes.buffer as ArrayBuffer,
  } as unknown as Response
}

describe('FilesModule.download', () => {
  let client: CanvasHttpClient
  let files: FilesModule

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns text content for text/plain file', async () => {
    client = makeMockClient(() => ({ ...BASE_META, content_type: 'text/plain', size: 5 }))
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ contentType: 'text/plain', body: 'hello' })),
    )

    const result = await files.download(42)

    expect(result.type).toBe('text')
    expect(result.text).toBe('hello')
    expect(result.contentType).toBe('text/plain')
    expect(result.filename).toBe('notes.txt')
    expect(result.base64).toBeUndefined()
  })

  it('uses /api/v1/courses/:courseId/files/:fileId when courseId is provided', async () => {
    client = makeMockClient(() => ({ ...BASE_META }))
    files = new FilesModule(client)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: 'hi' })))

    await files.download(42, 7)

    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/7/files/42')
  })

  it('uses /api/v1/files/:fileId when courseId is omitted', async () => {
    client = makeMockClient(() => ({ ...BASE_META }))
    files = new FilesModule(client)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: 'hi' })))

    await files.download(42)

    expect(client.request).toHaveBeenCalledWith('/api/v1/files/42')
  })

  it('returns resource with base64 for binary file (application/pdf)', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    client = makeMockClient(() => ({ ...BASE_META, content_type: 'application/pdf', size: 4 }))
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ contentType: 'application/pdf', body: pdfBytes })),
    )

    const result = await files.download(42)

    expect(result.type).toBe('resource')
    expect(result.base64).toBe(Buffer.from(pdfBytes).toString('base64'))
    expect(result.text).toBeUndefined()
  })

  it('returns text for application/json', async () => {
    const json = '{"key":"value"}'
    client = makeMockClient(() => ({
      ...BASE_META,
      content_type: 'application/json',
      size: json.length,
    }))
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ contentType: 'application/json', body: json })),
    )

    const result = await files.download(42)

    expect(result.type).toBe('text')
    expect(result.text).toBe(json)
  })

  it('returns resource for application/octet-stream (binary fallthrough)', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10])
    client = makeMockClient(() => ({
      ...BASE_META,
      content_type: 'application/octet-stream',
      size: 3,
    }))
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(makeResponse({ contentType: 'application/octet-stream', body: bytes })),
    )

    const result = await files.download(42)

    expect(result.type).toBe('resource')
    expect(result.base64).toBeDefined()
  })

  it('rejects file larger than 10 MB based on metadata size', async () => {
    const oversizedMeta = { ...BASE_META, size: 11 * 1024 * 1024 }
    client = makeMockClient(() => oversizedMeta)
    files = new FilesModule(client)

    await expect(files.download(42)).rejects.toThrow('too large')
  })

  it('rejects file when Content-Length header exceeds 10 MB', async () => {
    client = makeMockClient(() => ({ ...BASE_META, size: 100 })) // metadata says small
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse({ contentLength: String(11 * 1024 * 1024), body: 'small' }),
        ),
    )

    await expect(files.download(42)).rejects.toThrow('too large')
  })

  it('throws when the signed download URL returns a non-OK response', async () => {
    client = makeMockClient(() => ({ ...BASE_META }))
    files = new FilesModule(client)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 403, body: '' })),
    )

    await expect(files.download(42)).rejects.toThrow('HTTP 403')
  })

  it('propagates CanvasApiError from metadata lookup (404)', async () => {
    const { CanvasApiError } = await import('../src/canvas/client')
    client = makeMockClient(() => {
      throw new CanvasApiError('Not Found', 404, '/api/v1/files/99')
    })
    files = new FilesModule(client)

    await expect(files.download(99)).rejects.toThrow('Not Found')
  })
})
