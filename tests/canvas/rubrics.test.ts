import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RubricsModule } from '../../src/canvas/rubrics'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('RubricsModule', () => {
  let client: CanvasHttpClient
  let rubrics: RubricsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    rubrics = new RubricsModule(client)
  })

  it('lists rubrics for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, title: 'Essay Rubric', points_possible: 100, data: [] },
    ])
    const result = await rubrics.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/rubrics')
  })

  it('gets a single rubric', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      title: 'Essay Rubric',
      points_possible: 100,
      data: [],
    })
    const result = await rubrics.get(100, 1)
    expect(result).toMatchObject({ id: 1, title: 'Essay Rubric' })
    expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/rubrics/1')
  })

  it('gets rubric assessment for a submission', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      assignment_id: 10,
      user_id: 50,
    })
    await rubrics.getAssessment(100, 10, 50)
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/assignments/10/submissions/50?include[]=rubric_assessment',
    )
  })

  it('submits a rubric assessment', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 1,
      rubric_id: 5,
      score: 90,
      data: [],
    })
    const assessmentData = [{ criterion_id: 'c1', points: 90, comments: 'Good' }]
    await rubrics.submitAssessment(100, 5, assessmentData)
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/100/rubric_associations/5/rubric_assessments',
      {
        method: 'POST',
        body: JSON.stringify({ rubric_assessment: { data: assessmentData } }),
      },
    )
  })
})
