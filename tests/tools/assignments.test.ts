import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasAssignment, CanvasAssignmentGroup } from '../../src/canvas/types'
import { assignmentTools } from '../../src/tools/assignments'

describe('assignmentTools', () => {
  const mockAssignment: CanvasAssignment = {
    id: 101,
    name: 'Homework 1',
    description: '<p>First assignment</p>',
    due_at: '2026-05-01T23:59:00Z',
    points_possible: 100,
    grading_type: 'points',
    submission_types: ['online_upload'],
    course_id: 1,
    allowed_attempts: -1,
  }

  const mockGroup: CanvasAssignmentGroup = {
    id: 10,
    name: 'Homework',
    position: 1,
    group_weight: 40,
  }

  function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
    return {
      assignments: {
        list: vi.fn().mockResolvedValue([mockAssignment]),
        get: vi.fn().mockResolvedValue(mockAssignment),
        listGroups: vi.fn().mockResolvedValue([mockGroup]),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 3 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = assignmentTools(canvas)
    expect(tools).toHaveLength(3)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = assignmentTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_assignments')
    expect(names).toContain('get_assignment')
    expect(names).toContain('list_assignment_groups')
  })

  describe('list_assignments', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      expect(tool.inputSchema).toHaveProperty('course_id')
    })

    it('calls canvas.assignments.list with the course_id', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      await tool.handler({ course_id: 42 })
      expect(canvas.assignments.list).toHaveBeenCalledWith(42)
    })

    it('returns the assignment list from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      const result = await tool.handler({ course_id: 1 })
      expect(result).toEqual([mockAssignment])
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('get_assignment', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id and assignment_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
    })

    it('calls canvas.assignments.get with course_id and assignment_id', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(canvas.assignments.get).toHaveBeenCalledWith(1, 101)
    })

    it('returns the assignment from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      const result = await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(result).toEqual(mockAssignment)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('list_assignment_groups', () => {
    it('has readOnlyHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      expect(tool.inputSchema).toHaveProperty('course_id')
    })

    it('calls canvas.assignments.listGroups with the course_id', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      await tool.handler({ course_id: 42 })
      expect(canvas.assignments.listGroups).toHaveBeenCalledWith(42)
    })

    it('returns the assignment groups from Canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      const result = await tool.handler({ course_id: 1 })
      expect(result).toEqual([mockGroup])
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      expect(tool.description).toBeTruthy()
    })
  })
})
