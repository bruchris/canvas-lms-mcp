import { CanvasApiError, type CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type {
  CanvasRubric,
  CanvasRubricAssessment,
  CanvasRubricAssociation,
  CanvasRubricCreateResult,
  CanvasSubmission,
} from './types'
import type { CanvasId } from './id'

export type RubricInclude =
  | 'assessments'
  | 'graded_assessments'
  | 'peer_assessments'
  | 'associations'
  | 'assignment_associations'
  | 'course_associations'
  | 'account_associations'

export interface GetRubricOptions {
  include?: ReadonlyArray<RubricInclude>
}

export interface RubricRatingInput {
  description: string
  points: number
}

export interface RubricCriterionInput {
  description: string
  points: number
  ratings: RubricRatingInput[]
}

export interface RubricCreateInput {
  title: string
  criteria: RubricCriterionInput[]
}

export interface RubricAssociationInput {
  assignment_id: CanvasId
  use_for_grading?: boolean
  purpose?: string
}

export interface RubricAttachOptions {
  use_for_grading?: boolean
  hide_score_total?: boolean
  /** Defaults to `grading`. */
  purpose?: string
}

export class RubricsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: CanvasId): Promise<CanvasRubric[]> {
    return this.client.paginate<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics`)
  }

  async get(
    courseId: CanvasId,
    rubricId: CanvasId,
    options: GetRubricOptions = {},
  ): Promise<CanvasRubric> {
    if (!options.include || options.include.length === 0) {
      return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics/${rubricId}`)
    }
    const query: CanvasQueryParams = {}
    query.include = options.include
    return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics/${rubricId}`, {
      query,
    })
  }

  /** Canvas answers the DELETE with the deleted rubric inside a `{ rubric }` envelope, which this unwraps. */
  async delete(courseId: CanvasId, rubricId: CanvasId): Promise<CanvasRubric> {
    const envelope = await this.client.request<{ rubric: CanvasRubric }>(
      `/api/v1/courses/${courseId}/rubrics/${rubricId}`,
      { method: 'DELETE' },
    )
    return envelope.rubric
  }

  async getAssessment(
    courseId: CanvasId,
    assignmentId: CanvasId,
    userId: CanvasId,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=rubric_assessment`,
    )
  }

  async submitAssessment(
    courseId: CanvasId,
    associationId: CanvasId,
    data: CanvasRubricAssessment['data'],
  ): Promise<CanvasRubricAssessment> {
    return this.client.request<CanvasRubricAssessment>(
      `/api/v1/courses/${courseId}/rubric_associations/${associationId}/rubric_assessments`,
      {
        method: 'POST',
        body: JSON.stringify({ rubric_assessment: { data } }),
      },
    )
  }

  /** Canvas returns an envelope and reports association validation failures with HTTP 200. */
  async create(
    courseId: CanvasId,
    rubric: RubricCreateInput,
    association?: RubricAssociationInput,
  ): Promise<CanvasRubricCreateResult> {
    const params = new URLSearchParams()
    params.append('rubric[title]', rubric.title)

    rubric.criteria.forEach((criterion, ci) => {
      params.append(`rubric[criteria][${ci}][description]`, criterion.description)
      params.append(`rubric[criteria][${ci}][points]`, String(criterion.points))

      // Sort ratings highest → lowest before encoding
      const sortedRatings = [...criterion.ratings].sort((a, b) => b.points - a.points)
      sortedRatings.forEach((rating, ri) => {
        params.append(`rubric[criteria][${ci}][ratings][${ri}][description]`, rating.description)
        params.append(`rubric[criteria][${ci}][ratings][${ri}][points]`, String(rating.points))
      })
    })

    if (association) {
      params.append('rubric_association[association_id]', String(association.assignment_id))
      params.append('rubric_association[association_type]', 'Assignment')
      if (association.use_for_grading !== undefined) {
        params.append('rubric_association[use_for_grading]', String(association.use_for_grading))
      }
      if (association.purpose) {
        params.append('rubric_association[purpose]', association.purpose)
      }
    }

    const endpoint = `/api/v1/courses/${courseId}/rubrics`
    const result = await this.client.request<
      (CanvasRubricCreateResult & { error?: false }) | { error: true; messages?: string[] }
    >(endpoint, {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (result.error === true) {
      throw new CanvasApiError(
        result.messages?.join('; ') || 'Canvas rejected the rubric',
        422,
        endpoint,
      )
    }
    return result
  }

  /**
   * Attach an existing rubric to an assignment via
   * `POST /courses/:id/rubric_associations`, so one rubric can be shared across
   * many assignments instead of `create` minting a duplicate per assignment.
   * Same bracket-notation form encoding as `create`.
   * Canvas returns the full rubric beside the association; only the association is
   * returned, so looping over many assignments does not repeat the criteria.
   */
  async associate(
    courseId: CanvasId,
    rubricId: CanvasId,
    assignmentId: CanvasId,
    options: RubricAttachOptions = {},
  ): Promise<CanvasRubricAssociation> {
    const params = new URLSearchParams()
    params.append('rubric_association[rubric_id]', String(rubricId))
    params.append('rubric_association[association_id]', String(assignmentId))
    params.append('rubric_association[association_type]', 'Assignment')
    params.append('rubric_association[purpose]', options.purpose ?? 'grading')
    if (options.use_for_grading !== undefined) {
      params.append('rubric_association[use_for_grading]', String(options.use_for_grading))
    }
    if (options.hide_score_total !== undefined) {
      params.append('rubric_association[hide_score_total]', String(options.hide_score_total))
    }
    const envelope = await this.client.request<{
      rubric: CanvasRubric
      rubric_association: CanvasRubricAssociation
    }>(`/api/v1/courses/${courseId}/rubric_associations`, {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return envelope.rubric_association
  }
}
