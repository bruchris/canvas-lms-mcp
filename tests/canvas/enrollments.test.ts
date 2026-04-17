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
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/users/self/enrollments')
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
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/enrollments/10?task=delete',
      { method: 'DELETE' },
    )
  })
})
