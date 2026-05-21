import { describe, it, expect, vi } from 'vitest'
import { CoursesModule } from '../src/canvas/courses'
import type { CanvasHttpClient } from '../src/canvas/client'
import type { CanvasCourse } from '../src/canvas/types'

const COURSE_FIXTURE: CanvasCourse = {
  id: 1,
  name: 'Introduction to Biology',
  course_code: 'BIO101',
  workflow_state: 'available',
}

function makeMockClient(courses: CanvasCourse[] = [COURSE_FIXTURE]): CanvasHttpClient {
  return {
    paginate: vi.fn().mockResolvedValue(courses),
    request: vi.fn(),
  } as unknown as CanvasHttpClient
}

describe('CoursesModule.list', () => {
  it('returns courses with default include=term when no options are given', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    const result = await module.list()

    expect(result).toEqual([COURSE_FIXTURE])
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', { include: ['term'] })
  })

  it('does not send enrollment_role_id when not specified (regression: GH-138)', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    await module.list()

    const [, params] = (client.paginate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params).not.toHaveProperty('enrollment_role_id')
  })

  it('passes enrollment_role_id when explicitly set on the canvas client (not via tool schema)', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    await module.list({ enrollment_role_id: 42 })

    const [, params] = (client.paginate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params.enrollment_role_id).toBe(42)
  })

  it('filters by enrollment_state when provided', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    await module.list({ enrollment_state: 'active' })

    const [, params] = (client.paginate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params.enrollment_state).toBe('active')
  })

  it('filters by workflow state when provided', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    await module.list({ state: ['available'] })

    const [, params] = (client.paginate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params.state).toEqual(['available'])
  })

  it('uses provided include instead of default', async () => {
    const client = makeMockClient()
    const module = new CoursesModule(client)

    await module.list({ include: ['term', 'total_students'] })

    const [, params] = (client.paginate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params.include).toEqual(['term', 'total_students'])
  })

  it('returns an empty array when Canvas returns no courses', async () => {
    const client = makeMockClient([])
    const module = new CoursesModule(client)

    const result = await module.list()

    expect(result).toEqual([])
  })
})
