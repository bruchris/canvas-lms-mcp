import type { CanvasHttpClient } from './client'
import type { CanvasGradingSchemeEntry, CanvasGradingStandard } from './types'

/**
 * Canvas grading standards (letter-to-percentage grading schemes).
 *
 * Canvas API asymmetry: the GET/response key is `grading_scheme` (plural),
 * while the POST body key is `grading_scheme_entry` (singular). The POST body
 * is flat — there is no `grading_standard:` wrapper. List endpoints return a
 * plain JSON array, so we use `client.paginate` (not `paginateEnvelope`).
 */
export class GradingStandardsModule {
  constructor(private client: CanvasHttpClient) {}

  async listForCourse(courseId: number): Promise<CanvasGradingStandard[]> {
    return this.client.paginate<CanvasGradingStandard>(
      `/api/v1/courses/${courseId}/grading_standards`,
    )
  }

  async listForAccount(accountId: number): Promise<CanvasGradingStandard[]> {
    return this.client.paginate<CanvasGradingStandard>(
      `/api/v1/accounts/${accountId}/grading_standards`,
    )
  }

  async createForCourse(
    courseId: number,
    title: string,
    schemeEntries: CanvasGradingSchemeEntry[],
  ): Promise<CanvasGradingStandard> {
    const sorted = [...schemeEntries].sort((a, b) => b.value - a.value)
    return this.client.request<CanvasGradingStandard>(
      `/api/v1/courses/${courseId}/grading_standards`,
      {
        method: 'POST',
        body: JSON.stringify({ title, grading_scheme_entry: sorted }),
      },
    )
  }

  async createForAccount(
    accountId: number,
    title: string,
    schemeEntries: CanvasGradingSchemeEntry[],
  ): Promise<CanvasGradingStandard> {
    const sorted = [...schemeEntries].sort((a, b) => b.value - a.value)
    return this.client.request<CanvasGradingStandard>(
      `/api/v1/accounts/${accountId}/grading_standards`,
      {
        method: 'POST',
        body: JSON.stringify({ title, grading_scheme_entry: sorted }),
      },
    )
  }
}
