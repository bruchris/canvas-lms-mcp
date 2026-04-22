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
        create: vi.fn().mockResolvedValue(mockAssignment),
        update: vi.fn().mockResolvedValue(mockAssignment),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      ...overrides,
    } as unknown as CanvasClient
  }

  it('returns an array with 6 tool definitions', () => {
    const canvas = buildMockCanvas()
    const tools = assignmentTools(canvas)
    expect(tools).toHaveLength(6)
  })

  it('exports tools with correct names', () => {
    const canvas = buildMockCanvas()
    const tools = assignmentTools(canvas)
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_assignments')
    expect(names).toContain('get_assignment')
    expect(names).toContain('list_assignment_groups')
    expect(names).toContain('create_assignment')
    expect(names).toContain('update_assignment')
    expect(names).toContain('delete_assignment')
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

    it('calls canvas.assignments.list with the course_id and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      await tool.handler({ course_id: 42 })
      expect(canvas.assignments.list).toHaveBeenCalledWith(42, {})
    })

    it('forwards include[], bucket, and search_term', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignments')!
      await tool.handler({
        course_id: 42,
        include: ['submission', 'all_dates'],
        bucket: 'upcoming',
        search_term: 'hw',
      })
      expect(canvas.assignments.list).toHaveBeenCalledWith(42, {
        include: ['submission', 'all_dates'],
        bucket: 'upcoming',
        search_term: 'hw',
      })
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

    it('calls canvas.assignments.get with course_id, assignment_id and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(canvas.assignments.get).toHaveBeenCalledWith(1, 101, {})
    })

    it('forwards include[] and flags', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'get_assignment')!
      await tool.handler({
        course_id: 1,
        assignment_id: 101,
        include: ['submission', 'overrides'],
        all_dates: true,
      })
      expect(canvas.assignments.get).toHaveBeenCalledWith(1, 101, {
        include: ['submission', 'overrides'],
        all_dates: true,
      })
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

    it('calls canvas.assignments.listGroups with the course_id and empty opts', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      await tool.handler({ course_id: 42 })
      expect(canvas.assignments.listGroups).toHaveBeenCalledWith(42, {})
    })

    it('forwards include[] and filters', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'list_assignment_groups')!
      await tool.handler({
        course_id: 42,
        include: ['assignments', 'submission'],
        grading_period_id: 3,
      })
      expect(canvas.assignments.listGroups).toHaveBeenCalledWith(42, {
        include: ['assignments', 'submission'],
        grading_period_id: 3,
      })
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

  describe('create_assignment', () => {
    it('has destructiveHint and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'create_assignment')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id and name in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'create_assignment')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('name')
    })

    it('calls canvas.assignments.create with course_id and params', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'create_assignment')!
      await tool.handler({ course_id: 1, name: 'New HW', points_possible: 50 })
      expect(canvas.assignments.create).toHaveBeenCalledWith(1, {
        name: 'New HW',
        points_possible: 50,
      })
    })

    it('returns the created assignment', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'create_assignment')!
      const result = await tool.handler({ course_id: 1, name: 'New HW' })
      expect(result).toEqual(mockAssignment)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'create_assignment')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('update_assignment', () => {
    it('has destructiveHint, idempotentHint, and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'update_assignment')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id and assignment_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'update_assignment')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
    })

    it('calls canvas.assignments.update with course_id, assignment_id, and params', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'update_assignment')!
      await tool.handler({ course_id: 1, assignment_id: 101, name: 'Updated', points_possible: 75 })
      expect(canvas.assignments.update).toHaveBeenCalledWith(1, 101, {
        name: 'Updated',
        points_possible: 75,
      })
    })

    it('returns the updated assignment', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'update_assignment')!
      const result = await tool.handler({ course_id: 1, assignment_id: 101, name: 'Updated' })
      expect(result).toEqual(mockAssignment)
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'update_assignment')!
      expect(tool.description).toBeTruthy()
    })
  })

  describe('delete_assignment', () => {
    it('has destructiveHint, idempotentHint, and openWorldHint annotations', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'delete_assignment')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('has course_id and assignment_id in input schema', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'delete_assignment')!
      expect(tool.inputSchema).toHaveProperty('course_id')
      expect(tool.inputSchema).toHaveProperty('assignment_id')
    })

    it('calls canvas.assignments.delete with course_id and assignment_id', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'delete_assignment')!
      await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(canvas.assignments.delete).toHaveBeenCalledWith(1, 101)
    })

    it('returns undefined', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'delete_assignment')!
      const result = await tool.handler({ course_id: 1, assignment_id: 101 })
      expect(result).toBeUndefined()
    })

    it('has a description', () => {
      const canvas = buildMockCanvas()
      const tool = assignmentTools(canvas).find((t) => t.name === 'delete_assignment')!
      expect(tool.description).toBeTruthy()
    })
  })
})
