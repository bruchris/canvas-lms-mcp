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
        create: vi.fn().mockResolvedValue(mockCourse),
        update: vi.fn().mockResolvedValue(mockCourse),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 5 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    expect(tools).toHaveLength(5)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
    expect(names).toContain('create_course')
    expect(names).toContain('update_course')
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
          create: vi.fn(),
          update: vi.fn(),
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

  describe('create_course', () => {
    it('has destructiveHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('has required fields in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      expect(tool.inputSchema).toHaveProperty('account_id')
      expect(tool.inputSchema).toHaveProperty('name')
    })

    it('has optional fields in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      expect(tool.inputSchema).toHaveProperty('course_code')
      expect(tool.inputSchema).toHaveProperty('start_at')
      expect(tool.inputSchema).toHaveProperty('end_at')
    })

    it('calls canvas.courses.create with params', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      await tool.handler({ account_id: 1, name: 'New Course', course_code: 'NEW101' })
      expect(canvas.courses.create).toHaveBeenCalledWith({
        account_id: 1,
        name: 'New Course',
        course_code: 'NEW101',
        start_at: undefined,
        end_at: undefined,
      })
    })

    it('returns the created course', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      const result = await tool.handler({ account_id: 1, name: 'New Course' })
      expect(result).toEqual(mockCourse)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('update_course', () => {
    it('has destructiveHint, idempotentHint, and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      expect(tool.inputSchema).toHaveProperty('course_id')
    })

    it('has optional update fields in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      expect(tool.inputSchema).toHaveProperty('name')
      expect(tool.inputSchema).toHaveProperty('course_code')
      expect(tool.inputSchema).toHaveProperty('start_at')
      expect(tool.inputSchema).toHaveProperty('end_at')
      expect(tool.inputSchema).toHaveProperty('default_view')
      expect(tool.inputSchema).toHaveProperty('syllabus_body')
    })

    it('calls canvas.courses.update with course_id and fields', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      await tool.handler({ course_id: 1, name: 'Renamed', default_view: 'modules' })
      expect(canvas.courses.update).toHaveBeenCalledWith(1, {
        name: 'Renamed',
        default_view: 'modules',
      })
    })

    it('returns the updated course', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      const result = await tool.handler({ course_id: 1, name: 'Updated' })
      expect(result).toEqual(mockCourse)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      expect(tool.description).toBeTruthy()
    })
  })
})
