import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LatePolicyModule } from '../../src/canvas/late-policy'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

const mockLatePolicy = {
  id: 7,
  course_id: 100,
  missing_submission_deduction_enabled: true,
  missing_submission_deduction: 100,
  late_submission_deduction_enabled: true,
  late_submission_deduction: 10,
  late_submission_interval: 'day' as const,
  late_submission_minimum_percent_enabled: true,
  late_submission_minimum_percent: 50,
}

describe('LatePolicyModule', () => {
  let client: CanvasHttpClient
  let module: LatePolicyModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    module = new LatePolicyModule(client)
  })

  it('unwraps the late_policy envelope and hits the course late_policy endpoint', async () => {
    const requestSpy = vi
      .spyOn(client, 'request')
      .mockResolvedValueOnce({ late_policy: mockLatePolicy })
    const result = await module.get(100)
    expect(result).toEqual(mockLatePolicy)
    expect(requestSpy).toHaveBeenCalledWith('/api/v1/courses/100/late_policy')
  })

  it('propagates a 403 CanvasApiError (student tokens lack manage_grades)', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError('Forbidden', 403, '/api/v1/courses/100/late_policy'),
    )
    await expect(module.get(100)).rejects.toThrow(CanvasApiError)
  })

  it('propagates a 404 CanvasApiError (no late policy row exists yet)', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError('Not Found', 404, '/api/v1/courses/100/late_policy'),
    )
    await expect(module.get(100)).rejects.toMatchObject({ status: 404 })
  })
})
