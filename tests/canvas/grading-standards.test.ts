import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GradingStandardsModule } from '../../src/canvas/grading-standards'
import { CanvasHttpClient, CanvasApiError } from '../../src/canvas/client'

const mockStandard = {
  id: 42,
  title: 'GPA 4.0 Scale',
  context_type: 'Course' as const,
  context_id: 100,
  grading_scheme: [
    { name: 'A', value: 0.94 },
    { name: 'B', value: 0.84 },
    { name: 'F', value: 0.0 },
  ],
}

const schemeEntries = [
  { name: 'A', value: 0.94 },
  { name: 'B', value: 0.84 },
  { name: 'F', value: 0.0 },
]

describe('GradingStandardsModule', () => {
  let client: CanvasHttpClient
  let module: GradingStandardsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    module = new GradingStandardsModule(client)
  })

  it('listForCourse returns standards and hits the course endpoint', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([mockStandard])
    const result = await module.listForCourse(100)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 42, title: 'GPA 4.0 Scale' })
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/grading_standards')
  })

  it('listForCourse returns an empty array when there are no standards', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
    const result = await module.listForCourse(100)
    expect(result).toEqual([])
  })

  it('listForAccount hits the account endpoint', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([mockStandard])
    const result = await module.listForAccount(1)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/accounts/1/grading_standards')
  })

  it('createForCourse posts with the singular grading_scheme_entry key', async () => {
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)
    const result = await module.createForCourse(100, 'GPA 4.0 Scale', schemeEntries)
    expect(result).toEqual(mockStandard)

    const [endpoint, options] = requestSpy.mock.calls[0]
    expect(endpoint).toBe('/api/v1/courses/100/grading_standards')
    expect(options?.method).toBe('POST')
    const body = JSON.parse(options?.body as string)
    expect(body.title).toBe('GPA 4.0 Scale')
    // POST body uses grading_scheme_entry (singular), NOT grading_scheme (plural).
    expect(body.grading_scheme).toBeUndefined()
    expect(body.grading_scheme_entry).toEqual([
      { name: 'A', value: 0.94 },
      { name: 'B', value: 0.84 },
      { name: 'F', value: 0.0 },
    ])
  })

  it('createForCourse sorts entries descending by value before posting', async () => {
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)
    await module.createForCourse(100, 'GPA 4.0 Scale', [
      { name: 'F', value: 0.0 },
      { name: 'B', value: 0.84 },
      { name: 'A', value: 0.94 },
    ])
    const body = JSON.parse(requestSpy.mock.calls[0][1]?.body as string)
    expect(body.grading_scheme_entry).toEqual([
      { name: 'A', value: 0.94 },
      { name: 'B', value: 0.84 },
      { name: 'F', value: 0.0 },
    ])
  })

  it('createForCourse does not mutate the caller input array', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)
    const input = [
      { name: 'F', value: 0.0 },
      { name: 'B', value: 0.84 },
      { name: 'A', value: 0.94 },
    ]
    await module.createForCourse(100, 'GPA 4.0 Scale', input)
    expect(input).toEqual([
      { name: 'F', value: 0.0 },
      { name: 'B', value: 0.84 },
      { name: 'A', value: 0.94 },
    ])
  })

  it('createForAccount posts to the account endpoint with the singular key, without mutating input', async () => {
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValueOnce(mockStandard)
    const input = [
      { name: 'F', value: 0.0 },
      { name: 'A', value: 0.94 },
      { name: 'B', value: 0.84 },
    ]
    await module.createForAccount(1, 'GPA 4.0 Scale', input)
    const [endpoint, options] = requestSpy.mock.calls[0]
    expect(endpoint).toBe('/api/v1/accounts/1/grading_standards')
    expect(options?.method).toBe('POST')
    const body = JSON.parse(options?.body as string)
    expect(body.grading_scheme).toBeUndefined()
    expect(body.grading_scheme_entry).toEqual([
      { name: 'A', value: 0.94 },
      { name: 'B', value: 0.84 },
      { name: 'F', value: 0.0 },
    ])
    // input array order is preserved (sort operates on a copy)
    expect(input).toEqual([
      { name: 'F', value: 0.0 },
      { name: 'A', value: 0.94 },
      { name: 'B', value: 0.84 },
    ])
  })

  it('propagates CanvasApiError from createForAccount (no client-layer catch)', async () => {
    vi.spyOn(client, 'request').mockRejectedValueOnce(
      new CanvasApiError('Forbidden', 403, '/api/v1/accounts/1/grading_standards'),
    )
    await expect(module.createForAccount(1, 'GPA 4.0 Scale', schemeEntries)).rejects.toThrow(
      CanvasApiError,
    )
  })
})
