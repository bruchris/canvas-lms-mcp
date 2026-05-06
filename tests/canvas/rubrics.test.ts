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

  describe('create', () => {
    const mockCreatedRubric = {
      id: 42,
      title: 'Essay Rubric',
      points_possible: 17,
      data: [],
    }

    it('POSTs bracket-notation form-data to the rubrics endpoint', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCreatedRubric)

      await rubrics.create(100, {
        title: 'Essay Rubric',
        criteria: [
          {
            description: 'Content Quality',
            points: 10,
            ratings: [
              { description: 'Excellent', points: 10 },
              { description: 'Good', points: 7 },
            ],
          },
        ],
      })

      const [endpoint, options] = vi.mocked(client.request).mock.calls[0]
      expect(endpoint).toBe('/api/v1/courses/100/rubrics')
      expect(options?.method).toBe('POST')
      expect(options?.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      const body = new URLSearchParams(options?.body as string)
      expect(body.get('rubric[title]')).toBe('Essay Rubric')
      expect(body.get('rubric[criteria][0][description]')).toBe('Content Quality')
      expect(body.get('rubric[criteria][0][points]')).toBe('10')
      expect(body.get('rubric[criteria][0][ratings][0][description]')).toBe('Excellent')
      expect(body.get('rubric[criteria][0][ratings][0][points]')).toBe('10')
      expect(body.get('rubric[criteria][0][ratings][1][description]')).toBe('Good')
      expect(body.get('rubric[criteria][0][ratings][1][points]')).toBe('7')
    })

    it('sorts ratings highest to lowest before encoding', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCreatedRubric)

      await rubrics.create(100, {
        title: 'Sorted Rubric',
        criteria: [
          {
            description: 'Writing',
            points: 10,
            ratings: [
              { description: 'Poor', points: 2 },
              { description: 'Excellent', points: 10 },
              { description: 'Good', points: 7 },
            ],
          },
        ],
      })

      const [, options] = vi.mocked(client.request).mock.calls[0]
      const body = new URLSearchParams(options?.body as string)
      expect(body.get('rubric[criteria][0][ratings][0][points]')).toBe('10')
      expect(body.get('rubric[criteria][0][ratings][1][points]')).toBe('7')
      expect(body.get('rubric[criteria][0][ratings][2][points]')).toBe('2')
    })

    it('includes rubric_association keys when association is provided', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCreatedRubric)

      await rubrics.create(
        100,
        {
          title: 'Linked Rubric',
          criteria: [
            {
              description: 'Thesis',
              points: 10,
              ratings: [
                { description: 'Excellent', points: 10 },
                { description: 'Poor', points: 0 },
              ],
            },
          ],
        },
        { assignment_id: 55, use_for_grading: true, purpose: 'grading' },
      )

      const [, options] = vi.mocked(client.request).mock.calls[0]
      const body = new URLSearchParams(options?.body as string)
      expect(body.get('rubric_association[association_id]')).toBe('55')
      expect(body.get('rubric_association[association_type]')).toBe('Assignment')
      expect(body.get('rubric_association[use_for_grading]')).toBe('true')
      expect(body.get('rubric_association[purpose]')).toBe('grading')
    })

    it('omits rubric_association keys when no association is provided', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCreatedRubric)

      await rubrics.create(100, {
        title: 'Standalone Rubric',
        criteria: [
          {
            description: 'Content',
            points: 5,
            ratings: [
              { description: 'Good', points: 5 },
              { description: 'Poor', points: 0 },
            ],
          },
        ],
      })

      const [, options] = vi.mocked(client.request).mock.calls[0]
      const body = new URLSearchParams(options?.body as string)
      expect(body.get('rubric_association[association_id]')).toBeNull()
    })
  })
})
