import type { CanvasHttpClient } from './client'
import type { CanvasFile, CanvasFileUploadInfo, CanvasFolder } from './types'

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
    } catch (err) {
      let hostname: string
      try {
        hostname = new URL(uploadInfo.upload_url).hostname
      } catch {
        hostname = uploadInfo.upload_url
      }
      throw new Error(`Unable to reach file storage (${hostname})`)
    }

    // Step 3: If S3 returned a redirect, POST to Canvas confirm URL
    if (s3Response.status >= 300 && s3Response.status < 400) {
      const confirmUrl = s3Response.headers.get('location')
      if (!confirmUrl) {
        throw new Error(`File upload redirect missing Location header (HTTP ${s3Response.status})`)
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
    } catch (err) {
      throw new Error(
        `File upload response is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${responseText.slice(0, 500)}`,
      )
    }
    return parsed as CanvasFile
  }

  async delete(fileId: number): Promise<CanvasFile> {
    return this.client.request<CanvasFile>(`/api/v1/files/${fileId}`, { method: 'DELETE' })
  }
}
