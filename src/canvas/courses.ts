import type { CanvasHttpClient } from './client'
import type { CanvasCourse } from './types'

export class CoursesModule {
  constructor(private client: CanvasHttpClient) {}

  async list(params?: { enrollment_state?: string }): Promise<CanvasCourse[]> {
    const queryParams: Record<string, string> = {
      'include[]': 'term',
    }
    if (params?.enrollment_state) {
      queryParams.enrollment_state = params.enrollment_state
    }
    return this.client.paginate<CanvasCourse>('/api/v1/courses', queryParams)
  }

  async get(courseId: number): Promise<CanvasCourse> {
    return this.client.request<CanvasCourse>(
      `/api/v1/courses/${courseId}?include[]=term&include[]=total_students`,
    )
  }

  async getSyllabus(courseId: number): Promise<string | null> {
    const course = await this.client.request<CanvasCourse>(
      `/api/v1/courses/${courseId}?include[]=syllabus_body`,
    )
    return course.syllabus_body ?? null
  }
}
