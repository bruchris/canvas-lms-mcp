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
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw new Error('Invalid base64 content: contains characters outside the base64 alphabet')
    }
    const content = Buffer.from(contentBase64, 'base64')

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
      const hostname = new URL(uploadInfo.upload_url).hostname
      throw new Error(
        `Failed to connect to file storage (${hostname}): ${err instanceof Error ? err.message : String(err)}`,
      )
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
    } catch {
      throw new Error(
        `File upload response is not valid JSON: ${responseText.slice(0, 500)}`,
      )
    }
    return parsed as CanvasFile
  }

  async delete(fileId: number): Promise<CanvasFile> {
    return this.client.request<CanvasFile>(`/api/v1/files/${fileId}`, { method: 'DELETE' })
  }
}
