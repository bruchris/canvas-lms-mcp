import type { CanvasHttpClient } from './client'
import type {
  CanvasRubric,
  CanvasRubricAssessment,
  CanvasRubricAssociation,
  CanvasSubmission,
} from './types'
import type { CanvasId } from './id'

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

  async get(courseId: CanvasId, rubricId: CanvasId): Promise<CanvasRubric> {
    return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics/${rubricId}`)
  }

  /** Canvas answers a rubric DELETE with the deleted rubric's body. */
  async delete(courseId: CanvasId, rubricId: CanvasId): Promise<CanvasRubric> {
    return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics/${rubricId}`, {
      method: 'DELETE',
    })
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

  async create(
    courseId: CanvasId,
    rubric: RubricCreateInput,
    association?: RubricAssociationInput,
  ): Promise<CanvasRubric> {
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

    return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics`, {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  }

  /**
   * Attach an existing rubric to an assignment via
   * `POST /courses/:id/rubric_associations`, so one rubric can be shared across
   * many assignments instead of `create` minting a duplicate per assignment.
   * Same bracket-notation form encoding as `create`.
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
    return this.client.request<CanvasRubricAssociation>(
      `/api/v1/courses/${courseId}/rubric_associations`,
      {
        method: 'POST',
        body: params.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    )
  }
}
