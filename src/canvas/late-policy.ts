import type { CanvasHttpClient } from './client'
import type { CanvasLatePolicy } from './types'

/**
 * Canvas late/missing submission policy for a course.
 *
 * The response is an envelope — `{ "late_policy": { ... } }` — so `get` unwraps
 * the inner object before returning it. Throws `CanvasApiError` on failure
 * (notably 403 for student tokens and 404 when no policy row exists yet); the
 * caller decides how to handle those statuses.
 */
export class LatePolicyModule {
  constructor(private client: CanvasHttpClient) {}

  async get(courseId: number): Promise<CanvasLatePolicy> {
    const envelope = await this.client.request<{ late_policy: CanvasLatePolicy }>(
      `/api/v1/courses/${courseId}/late_policy`,
    )
    return envelope.late_policy
  }
}
