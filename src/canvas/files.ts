import type { CanvasHttpClient } from './client'
import type { CanvasFile, CanvasFileUploadInfo, CanvasFolder, DownloadedFile } from './types'

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

const TEXT_CONTENT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
])

function isTextContentType(contentType: string): boolean {
  const base = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  return base.startsWith('text/') || TEXT_CONTENT_TYPES.has(base)
}

export class FilesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasFile[]> {
    return this.client.paginate<CanvasFile>(`/api/v1/courses/${courseId}/files`)
  }

  async listFolders(courseId: number): Promise<CanvasFolder[]> {
    return this.client.paginate<CanvasFolder>(`/api/v1/courses/${courseId}/folders`)
  }

  async get(courseId: number, fileId: number): Promise<CanvasFile> {
    return this.client.request<CanvasFile>(`/api/v1/courses/${courseId}/files/${fileId}`)
  }

  async upload(
    courseId: number,
    name: string,
    contentBase64: string,
    contentType: string,
    parentFolderPath?: string,
  ): Promise<CanvasFile> {
    const content = Buffer.from(contentBase64, 'base64')
    if (content.toString('base64') !== contentBase64) {
      throw new Error('Invalid base64 content: string is not valid base64 encoding')
    }

    // Step 1: Notify Canvas of the pending upload
    const uploadBody: Record<string, string> = {
      name,
      content_type: contentType,
      size: String(content.length),
    }
    if (parentFolderPath) {
      uploadBody.parent_folder_path = parentFolderPath
    }

    const uploadInfo = await this.client.request<CanvasFileUploadInfo>(
      `/api/v1/courses/${courseId}/files`,
      { method: 'POST', body: JSON.stringify(uploadBody) },
    )

    // Step 2: POST file to upload_url (may be S3 — must NOT add Authorization header)
    const form = new FormData()
    for (const [key, value] of Object.entries(uploadInfo.upload_params)) {
      form.append(key, value)
    }
    form.append('file', new Blob([content], { type: contentType }), name)

    // Use redirect: 'manual' so we can handle the 303 → Canvas confirm step ourselves
    let s3Response: Response
    try {
      s3Response = await fetch(uploadInfo.upload_url, {
        method: 'POST',
        body: form,
        redirect: 'manual',
      })
    } catch (networkErr) {
      let hostname: string
      try {
        hostname = new URL(uploadInfo.upload_url).hostname
      } catch {
        hostname = uploadInfo.upload_url
      }
      throw new Error(`Unable to reach file storage (${hostname})`, { cause: networkErr })
    }

    // Step 3: If S3 returned a redirect, POST to Canvas confirm URL
    if (s3Response.status >= 300 && s3Response.status < 400) {
      const confirmUrl = s3Response.headers.get('location')
      if (!confirmUrl) {
        throw new Error(`File upload redirect missing Location header (HTTP ${s3Response.status})`)
      }
      let confirmHostname: string
      try {
        confirmHostname = new URL(confirmUrl).hostname
      } catch {
        confirmHostname = ''
      }
      const canvasHostname = new URL(this.client.baseUrl).hostname
      if (confirmHostname !== canvasHostname) {
        throw new Error(
          `File upload redirect points to unexpected host (${confirmHostname}); expected Canvas host (${canvasHostname})`,
        )
      }
      return this.client.request<CanvasFile>(confirmUrl, { method: 'POST' })
    }

    if (!s3Response.ok) {
      const body = await s3Response.text()
      throw new Error(
        `File upload to storage failed (HTTP ${s3Response.status}): ${body.slice(0, 500)}`,
      )
    }

    const responseText = await s3Response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(responseText)
    } catch (parseErr) {
      throw new Error(
        `File upload response is not valid JSON (${parseErr instanceof Error ? parseErr.message : String(parseErr)}): ${responseText.slice(0, 500)}`,
        { cause: parseErr },
      )
    }
    if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) {
      throw new Error(
        `File upload returned unexpected response (no file ID): ${responseText.slice(0, 500)}`,
      )
    }
    return parsed as CanvasFile
  }

  async download(fileId: number, courseId?: number): Promise<DownloadedFile> {
    const endpoint =
      courseId != null ? `/api/v1/courses/${courseId}/files/${fileId}` : `/api/v1/files/${fileId}`
    const meta = await this.client.request<CanvasFile>(endpoint)

    if (meta.size > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `File too large to download (${meta.size.toLocaleString()} bytes; limit is 10 MB)`,
      )
    }

    const response = await fetch(meta.url)
    if (!response.ok) {
      throw new Error(`Failed to download file content (HTTP ${response.status})`)
    }

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader != null) {
      const declared = parseInt(contentLengthHeader, 10)
      if (!isNaN(declared) && declared > MAX_DOWNLOAD_BYTES) {
        throw new Error(
          `File too large to download (${declared.toLocaleString()} bytes declared; limit is 10 MB)`,
        )
      }
    }

    const contentType = (
      (response.headers.get('content-type') ?? meta.content_type).split(';')[0] ?? ''
    ).trim()
    const filename = meta.display_name ?? meta.filename ?? `file-${fileId}`
    const buffer = await response.arrayBuffer()

    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `File too large to download (${buffer.byteLength.toLocaleString()} bytes; limit is 10 MB)`,
      )
    }

    if (isTextContentType(contentType)) {
      return {
        type: 'text',
        filename,
        contentType,
        size: buffer.byteLength,
        text: Buffer.from(buffer).toString('utf-8'),
      }
    }

    return {
      type: 'resource',
      filename,
      contentType,
      size: buffer.byteLength,
      base64: Buffer.from(buffer).toString('base64'),
    }
  }

  async delete(fileId: number): Promise<CanvasFile> {
    return this.client.request<CanvasFile>(`/api/v1/files/${fileId}`, { method: 'DELETE' })
  }
}
