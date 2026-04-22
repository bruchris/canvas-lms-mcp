import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnrollmentsModule } from '../../src/canvas/enrollments'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('EnrollmentsModule', () => {
  let client: CanvasHttpClient
  let enrollments: EnrollmentsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    enrollments = new EnrollmentsModule(client)
  })

  it('lists enrollments for current user', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      {
        id: 1,
        course_id: 100,
        user_id: 1,
        type: 'StudentEnrollment',
        role: 'StudentEnrollment',
        enrollment_state: 'active',
      },
    ])
    const result = await enrollments.list()
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/enrollments', {})
  })

  it('forwards include and filters when listing user enrollments', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    await enrollments.list({
      type: ['StudentEnrollment'],
      state: ['active'],
      include: ['grades', 'current_points'],
      grading_period_id: 7,
    })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/enrollments', {
      type: ['StudentEnrollment'],
      state: ['active'],
      include: ['grades', 'current_points'],
      grading_period_id: 7,
    })
  })

  it('lists course-scoped enrollments with filters', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    await enrollments.listForCourse(100, {
      type: ['StudentEnrollment', 'TeacherEnrollment'],
      state: ['active'],
      include: ['grades', 'avatar_url'],
      user_id: 'self',
    })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/enrollments', {
      type: ['StudentEnrollment', 'TeacherEnrollment'],
      state: ['active'],
      include: ['grades', 'avatar_url'],
      user_id: 'self',
    })
  })

  it('returns empty array when no enrollments', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await enrollments.list()
    expect(result).toEqual([])
  })

  it('enrolls a user in a course', async () => {
    const mockEnrollment = {
      id: 10,
      course_id: 100,
      user_id: 5,
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'invited',
    }
    vi.spyOn(client, 'request').mockResolvedValueOnce(mockEnrollment)
    const result = await enrollments.enroll(100, 5, 'StudentEnrollment')
    expect(result).toMatchObject({ id: 10, type: 'StudentEnrollment' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/enrollments', {
      method: 'POST',
      body: JSON.stringify({ enrollment: { user_id: 5, type: 'StudentEnrollment' } }),
    })
  })

  it('enrolls a user with explicit enrollment_state', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ id: 11, type: 'TeacherEnrollment' })
    await enrollments.enroll(100, 5, 'TeacherEnrollment', 'active')
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        enrollment: { user_id: 5, type: 'TeacherEnrollment', enrollment_state: 'active' },
      }),
    })
  })

  it('removes an enrollment', async () => {
    const mockEnrollment = {
      id: 10,
      course_id: 100,
      user_id: 5,
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      enrollment_state: 'deleted',
    }
    vi.spyOn(client, 'request').mockResolvedValueOnce(mockEnrollment)
    const result = await enrollments.remove(100, 10, 'delete')
    expect(result).toMatchObject({ id: 10 })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/enrollments/10?task=delete', {
      method: 'DELETE',
    })
  })

  describe('listMyGrades', () => {
    it('fetches all enrollments with grades when no courseId', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await enrollments.listMyGrades()
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/enrollments', {
        include: ['grades'],
      })
    })

    it('fetches course-specific enrollments with grades when courseId provided', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await enrollments.listMyGrades(42)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/enrollments', {
        user_id: 'self',
        include: ['grades'],
      })
    })
  })
})
