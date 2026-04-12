import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasCourse } from '../../src/canvas/types'
import { courseTools } from '../../src/tools/courses'

describe('courseTools', () => {
  const mockCourse: CanvasCourse = {
    id: 1,
    name: 'Intro to Testing',
    course_code: 'TST101',
    workflow_state: 'available',
    enrollment_term_id: 1,
    total_students: 30,
  }

  function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
    return {
      courses: {
        list: vi.fn().mockResolvedValue([mockCourse]),
        get: vi.fn().mockResolvedValue(mockCourse),
        getSyllabus: vi.fn().mockResolvedValue('<p>Welcome to the course</p>'),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 3 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    expect(tools).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
  })

  describe('list_courses', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has enrollment_state in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      expect(tool.inputSchema).toHaveProperty('enrollment_state')
    })

    it('calls canvas.courses.list with no params when none provided', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      await tool.handler({})
      expect(canvas.courses.list).toHaveBeenCalledWith({})
    })

    it('passes enrollment_state to canvas.courses.list', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      await tool.handler({ enrollment_state: 'active' })
      expect(canvas.courses.list).toHaveBeenCalledWith({ enrollment_state: 'active' })
    })

    it('returns the course list from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = await tool.handler({})
      expect(result).toEqual([mockCourse])
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('get_course', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      expect(tool.inputSchema).toHaveProperty('course_id')
    })

    it('calls canvas.courses.get with the course_id', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      await tool.handler({ course_id: 42 })
      expect(canvas.courses.get).toHaveBeenCalledWith(42)
    })

    it('returns the course from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      const result = await tool.handler({ course_id: 1 })
      expect(result).toEqual(mockCourse)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('get_syllabus', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      expect(tool.inputSchema).toHaveProperty('course_id')
    })

    it('calls canvas.courses.getSyllabus with the course_id', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      await tool.handler({ course_id: 42 })
      expect(canvas.courses.getSyllabus).toHaveBeenCalledWith(42)
    })

    it('returns the syllabus HTML from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      const result = await tool.handler({ course_id: 1 })
      expect(result).toEqual({ course_id: 1, syllabus_body: '<p>Welcome to the course</p>' })
    })

    it('returns null syllabus when none set', async () => {
      const canvas = buildMockCanvas({
        courses: {
          list: vi.fn(),
          get: vi.fn(),
          getSyllabus: vi.fn().mockResolvedValue(null),
        } as unknown as CanvasClient['courses'],
      })
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      const result = await tool.handler({ course_id: 1 })
      expect(result).toEqual({ course_id: 1, syllabus_body: null })
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      expect(tool.description).toBeTruthy()
    })
  })
})
