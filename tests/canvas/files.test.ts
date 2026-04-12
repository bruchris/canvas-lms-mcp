import { describe, it, expect, vi, beforeEach } from 'vitest'
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
      { id: 1, display_name: 'syllabus.pdf', content_type: 'application/pdf', url: 'https://example.com/file', size: 1024, folder_id: 1 },
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
})
