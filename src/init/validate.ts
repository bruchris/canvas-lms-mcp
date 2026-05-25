import { CanvasApiError, CanvasHttpClient } from '../canvas/client'

export interface ValidateResult {
  ok: boolean
  displayName?: string
  status?: number
  hint?: string
}

interface UsersSelfResponse {
  id?: number
  name?: string
}

const SOFT_FAIL_HINT = 'Canvas unreachable, continue anyway?'

export async function pingUsersSelf(token: string, baseUrl: string): Promise<ValidateResult> {
  const client = new CanvasHttpClient({ token, baseUrl })
  try {
    const user = await client.request<UsersSelfResponse>('/users/self')
    return { ok: true, displayName: user?.name }
  } catch (error) {
    if (error instanceof CanvasApiError) {
      if (error.status === 401) {
        return { ok: false, status: 401, hint: 'Token is invalid or expired' }
      }
      if (error.status >= 500) {
        return { ok: false, status: error.status, hint: SOFT_FAIL_HINT }
      }
      return { ok: false, status: error.status, hint: 'Unexpected error' }
    }
    return { ok: false, hint: SOFT_FAIL_HINT }
  }
}
