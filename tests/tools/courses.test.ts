import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasCourse } from '../../src/canvas/types'
import { courseTools } from '../../src/tools/courses'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import {
  FIXTURE_SECTION_PLAIN,
  FIXTURE_SECTION_WITH_STUDENTS,
  SECTION_REAL_NAMES,
} from '../fixtures/sections'

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
        listSections: vi.fn().mockResolvedValue([FIXTURE_SECTION_PLAIN]),
        create: vi.fn().mockResolvedValue(mockCourse),
        update: vi.fn().mockResolvedValue(mockCourse),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 6 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    expect(tools).toHaveLength(6)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = courseTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
    expect(names).toContain('list_sections')
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

    it('has fields in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      expect(tool.inputSchema).toHaveProperty('fields')
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

    it('forwards state, include, and exclude_blueprint_courses', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      await tool.handler({
        state: ['available', 'completed'],
        include: ['total_students'],
        exclude_blueprint_courses: true,
      })
      expect(canvas.courses.list).toHaveBeenCalledWith({
        state: ['available', 'completed'],
        include: ['total_students'],
        exclude_blueprint_courses: true,
      })
    })

    it('returns the course list from Canvas when fields is omitted (full mode)', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = await tool.handler({})
      expect(result).toEqual([mockCourse])
    })

    it('returns the full course list when fields="full"', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = await tool.handler({ fields: 'full' })
      expect(result).toEqual([mockCourse])
    })

    it('returns slim projection when fields="slim"', async () => {
      const courseWithTerm: CanvasCourse = {
        ...mockCourse,
        term: { id: 5, name: 'Fall 2026', start_at: null, end_at: null },
      }
      const canvas = buildMockCanvas()
      ;(canvas.courses.list as ReturnType<typeof vi.fn>).mockResolvedValue([courseWithTerm])
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = await tool.handler({ fields: 'slim' })
      expect(result).toEqual([
        {
          id: 1,
          name: 'Intro to Testing',
          course_code: 'TST101',
          term: 'Fall 2026',
          workflow_state: 'available',
        },
      ])
    })

    it('slim mode sets term to null when course has no term', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = await tool.handler({ fields: 'slim' })
      expect((result as Array<{ term: unknown }>)[0].term).toBeNull()
    })

    it('slim mode does not include extra fields', async () => {
      const courseWithExtras: CanvasCourse = {
        ...mockCourse,
        total_students: 30,
        syllabus_body: 'lots of text',
        term: { id: 1, name: 'Spring', start_at: null, end_at: null },
      }
      const canvas = buildMockCanvas()
      ;(canvas.courses.list as ReturnType<typeof vi.fn>).mockResolvedValue([courseWithExtras])
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      const result = (await tool.handler({ fields: 'slim' })) as Array<Record<string, unknown>>
      expect(result[0]).not.toHaveProperty('total_students')
      expect(result[0]).not.toHaveProperty('syllabus_body')
      expect(result[0]).not.toHaveProperty('enrollment_term_id')
    })

    it('slim mode ignores the include param', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'list_courses')!
      await tool.handler({ fields: 'slim', include: ['total_students'] })
      expect(canvas.courses.list).toHaveBeenCalledWith({})
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

    it('calls canvas.courses.get with the course_id and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      await tool.handler({ course_id: '42' })
      expect(canvas.courses.get).toHaveBeenCalledWith('42', {})
    })

    it('forwards include[] to canvas.courses.get', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      await tool.handler({ course_id: '42', include: ['teachers', 'permissions'] })
      expect(canvas.courses.get).toHaveBeenCalledWith('42', {
        include: ['teachers', 'permissions'],
      })
    })

    it('forwards teacher_limit to canvas.courses.get', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      await tool.handler({ course_id: '42', teacher_limit: 5 })
      expect(canvas.courses.get).toHaveBeenCalledWith('42', { teacher_limit: 5 })
    })

    it('returns the course from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_course')!
      const result = await tool.handler({ course_id: '1' })
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
      await tool.handler({ course_id: '42' })
      expect(canvas.courses.getSyllabus).toHaveBeenCalledWith('42')
    })

    it('returns the syllabus HTML from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'get_syllabus')!
      const result = await tool.handler({ course_id: '1' })
      expect(result).toEqual({ course_id: '1', syllabus_body: '<p>Welcome to the course</p>' })
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
      const result = await tool.handler({ course_id: '1' })
      expect(result).toEqual({ course_id: '1', syllabus_body: null })
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
      await tool.handler({ account_id: '1', name: 'New Course', course_code: 'NEW101' })
      expect(canvas.courses.create).toHaveBeenCalledWith({
        account_id: '1',
        name: 'New Course',
        course_code: 'NEW101',
      })
    })

    it('returns the created course', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'create_course')!
      const result = await tool.handler({ account_id: '1', name: 'New Course' })
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
      expect(tool.inputSchema).toHaveProperty('apply_assignment_group_weights')
      expect(tool.inputSchema).toHaveProperty('hide_final_grades')
    })

    it('passes apply_assignment_group_weights and hide_final_grades through', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      await tool.handler({
        course_id: '1',
        apply_assignment_group_weights: false,
        hide_final_grades: true,
      })
      expect(canvas.courses.update).toHaveBeenCalledWith('1', {
        apply_assignment_group_weights: false,
        hide_final_grades: true,
      })
    })

    it('calls canvas.courses.update with course_id and fields', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      await tool.handler({ course_id: '1', name: 'Renamed', default_view: 'modules' })
      expect(canvas.courses.update).toHaveBeenCalledWith('1', {
        name: 'Renamed',
        default_view: 'modules',
      })
    })

    it('returns the updated course', async () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      const result = await tool.handler({ course_id: '1', name: 'Updated' })
      expect(result).toEqual(mockCourse)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = courseTools(canvas).find((t) => t.name === 'update_course')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('list_sections', () => {
    // A real on-disk root, never the default: the default resolves to the
    // user's own state directory, which both pollutes it and makes the
    // `Student N` counter depend on whatever else has run on this machine.
    let tmpRoot: string

    beforeEach(async () => {
      tmpRoot = await mkdtemp(join(tmpdir(), 'list-sections-tool-'))
    })

    afterEach(async () => {
      await rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    function sectionsTool(canvas: CanvasClient, ps?: Pseudonymizer) {
      return courseTools(canvas, ps).find((t) => t.name === 'list_sections')!
    }

    it('is read-only and open-world', () => {
      const tool = sectionsTool(buildMockCanvas())
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.courses.listSections with empty opts', async () => {
      const canvas = buildMockCanvas()
      const result = await sectionsTool(canvas).handler({ course_id: '7' })
      expect(canvas.courses.listSections).toHaveBeenCalledWith('7', {})
      expect(result).toEqual([FIXTURE_SECTION_PLAIN])
    })

    it('forwards include[] and search_term', async () => {
      const canvas = buildMockCanvas()
      await sectionsTool(canvas).handler({
        course_id: '7',
        include: ['total_students', 'permissions'],
        search_term: 'Mon',
      })
      expect(canvas.courses.listSections).toHaveBeenCalledWith('7', {
        include: ['total_students', 'permissions'],
        search_term: 'Mon',
      })
    })

    it('exposes only the two non-PII include[] values Canvas documents', () => {
      // The roster includes (`students`, `enrollments`, `avatar_url`) are
      // deliberately absent: requesting them would embed `user_json` objects in
      // every section. A widening of this enum is the change that makes the
      // Pseudonymizer wrap below load-bearing, so pin the enum here.
      const tool = sectionsTool(buildMockCanvas())
      const include = tool.inputSchema.include as unknown as {
        safeParse: (v: unknown) => { success: boolean }
      }
      expect(include.safeParse(['total_students', 'permissions']).success).toBe(true)
      expect(include.safeParse(['students']).success).toBe(false)
      expect(include.safeParse(['enrollments']).success).toBe(false)
      expect(include.safeParse(['avatar_url']).success).toBe(false)
    })

    it('pseudonymizes a students payload when the flag is on (fail-closed wrap)', async () => {
      // Canvas cannot produce this payload for the request this tool makes, so
      // the fixture stands in for a widened include[] or an instance that
      // returns the field unasked. Without this the wrap would be untested.
      const canvas = buildMockCanvas({
        courses: {
          listSections: vi.fn().mockResolvedValue([FIXTURE_SECTION_WITH_STUDENTS]),
        },
      } as unknown as Partial<CanvasClient>)
      const ps = new Pseudonymizer({
        baseUrl: 'https://school.instructure.com/api/v1',
        rootDir: tmpRoot,
        env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' },
        auditLog: () => undefined,
      })

      const result = await sectionsTool(canvas, ps).handler({ course_id: '7' })
      const serialized = JSON.stringify(result)
      for (const name of SECTION_REAL_NAMES) {
        expect(serialized, `"${name}" survived pseudonymization`).not.toContain(name)
      }
      expect(serialized).toContain('Student 1')
    })

    it('control: the same payload keeps its names with no pseudonymizer', async () => {
      const canvas = buildMockCanvas({
        courses: {
          listSections: vi.fn().mockResolvedValue([FIXTURE_SECTION_WITH_STUDENTS]),
        },
      } as unknown as Partial<CanvasClient>)

      const result = await sectionsTool(canvas).handler({ course_id: '7' })
      expect(JSON.stringify(result)).toContain('Priya Raman')
    })
  })
})
