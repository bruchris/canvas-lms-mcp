import type { CanvasHttpClient } from './client'
import type { CanvasCourse } from './types'

export interface CreateCourseParams {
  account_id: number
  name: string
  course_code?: string
  start_at?: string
  end_at?: string
}

export interface UpdateCourseParams {
  name?: string
  course_code?: string
  start_at?: string
  end_at?: string
  default_view?: string
  syllabus_body?: string
}

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

  async create(params: CreateCourseParams): Promise<CanvasCourse> {
    const { account_id, ...courseFields } = params
    return this.client.request<CanvasCourse>(`/api/v1/accounts/${account_id}/courses`, {
      method: 'POST',
      body: JSON.stringify({ course: courseFields }),
    })
  }

  async update(courseId: number, params: UpdateCourseParams): Promise<CanvasCourse> {
    return this.client.request<CanvasCourse>(`/api/v1/courses/${courseId}`, {
      method: 'PUT',
      body: JSON.stringify({ course: params }),
    })
  }
}
