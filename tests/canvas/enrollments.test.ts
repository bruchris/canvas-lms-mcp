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
})
