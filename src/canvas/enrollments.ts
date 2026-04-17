import type { CanvasHttpClient } from './client'
import type { CanvasEnrollment } from './types'

export class EnrollmentsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(): Promise<CanvasEnrollment[]> {
    return this.client.paginate<CanvasEnrollment>('/api/v1/users/self/enrollments')
  }

  async enroll(
    courseId: number,
    userId: number,
    type: string,
    enrollmentState?: string,
  ): Promise<CanvasEnrollment> {
    const body: Record<string, unknown> = {
      enrollment: {
        user_id: userId,
        type,
        ...(enrollmentState ? { enrollment_state: enrollmentState } : {}),
      },
    }
    return this.client.request<CanvasEnrollment>(`/api/v1/courses/${courseId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async remove(courseId: number, enrollmentId: number, task: string): Promise<CanvasEnrollment> {
    return this.client.request<CanvasEnrollment>(
      `/api/v1/courses/${courseId}/enrollments/${enrollmentId}?task=${encodeURIComponent(task)}`,
      { method: 'DELETE' },
    )
  }

  async listMyGrades(courseId?: number): Promise<CanvasEnrollment[]> {
    if (courseId !== undefined) {
      return this.client.paginate<CanvasEnrollment>(`/api/v1/courses/${courseId}/enrollments`, {
        user_id: 'self',
        'include[]': 'grades',
      })
    }
    return this.client.paginate<CanvasEnrollment>('/api/v1/users/self/enrollments', {
      'include[]': 'grades',
    })
  }
}
