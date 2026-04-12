import type { CanvasHttpClient } from './client'
import type { CanvasRubric, CanvasRubricAssessment, CanvasSubmission } from './types'

export class RubricsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(courseId: number): Promise<CanvasRubric[]> {
    return this.client.paginate<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics`)
  }

  async get(courseId: number, rubricId: number): Promise<CanvasRubric> {
    return this.client.request<CanvasRubric>(`/api/v1/courses/${courseId}/rubrics/${rubricId}`)
  }

  async getAssessment(
    courseId: number,
    assignmentId: number,
    userId: number,
  ): Promise<CanvasSubmission> {
    return this.client.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=rubric_assessment`,
    )
  }

  async submitAssessment(
    courseId: number,
    associationId: number,
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
}
