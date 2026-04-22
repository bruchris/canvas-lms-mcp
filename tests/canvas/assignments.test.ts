import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssignmentsModule } from '../../src/canvas/assignments'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasAssignment, CanvasAssignmentGroup } from '../../src/canvas/types'

describe('AssignmentsModule', () => {
  let client: CanvasHttpClient
  let assignments: AssignmentsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    assignments = new AssignmentsModule(client)
  })

  describe('list', () => {
    it('lists assignments for a course', async () => {
      const mockAssignments: CanvasAssignment[] = [
        {
          id: 1,
          name: 'HW1',
          description: 'First homework',
          due_at: '2026-05-01T23:59:00Z',
          points_possible: 100,
          grading_type: 'points',
          submission_types: ['online_upload'],
          course_id: 100,
          allowed_attempts: -1,
        },
        {
          id: 2,
          name: 'HW2',
          description: null,
          due_at: null,
          points_possible: 50,
          grading_type: 'points',
          submission_types: ['online_text_entry'],
          course_id: 100,
          allowed_attempts: 3,
        },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockAssignments)

      const result = await assignments.list(100)
      expect(result).toEqual(mockAssignments)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/assignments', {})
    })

    it('returns empty array when no assignments', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await assignments.list(100)
      expect(result).toEqual([])
    })

    it('constructs correct URL for different course IDs', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await assignments.list(42)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/assignments', {})
    })

    it('forwards include[] and filters', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await assignments.list(100, {
        include: ['submission', 'all_dates'],
        bucket: 'upcoming',
        search_term: 'hw',
        assignment_ids: [1, 2, 3],
        order_by: 'due_at',
      })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/assignments', {
        include: ['submission', 'all_dates'],
        bucket: 'upcoming',
        search_term: 'hw',
        assignment_ids: [1, 2, 3],
        order_by: 'due_at',
      })
    })
  })

  describe('get', () => {
    it('gets a single assignment', async () => {
      const mockAssignment: CanvasAssignment = {
        id: 1,
        name: 'HW1',
        description: 'First homework',
        due_at: '2026-05-01T23:59:00Z',
        points_possible: 100,
        grading_type: 'points',
        submission_types: ['online_upload'],
        course_id: 100,
        allowed_attempts: -1,
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockAssignment)

      const result = await assignments.get(100, 1)
      expect(result).toEqual(mockAssignment)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments/1', {
        query: {},
      })
    })

    it('constructs correct URL for different IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 55,
        name: 'Quiz',
        description: null,
        due_at: null,
        points_possible: 10,
        grading_type: 'points',
        submission_types: ['online_quiz'],
        course_id: 42,
        allowed_attempts: 1,
      })

      await assignments.get(42, 55)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/assignments/55', {
        query: {},
      })
    })

    it('forwards include[] and flags', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 1,
        name: 'HW',
        description: null,
        due_at: null,
        points_possible: 10,
        grading_type: 'points',
        submission_types: [],
        course_id: 100,
        allowed_attempts: -1,
      })
      await assignments.get(100, 1, {
        include: ['submission', 'overrides'],
        all_dates: true,
      })
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments/1', {
        query: { include: ['submission', 'overrides'], all_dates: true },
      })
    })
  })

  describe('listGroups', () => {
    it('lists assignment groups for a course', async () => {
      const mockGroups: CanvasAssignmentGroup[] = [
        { id: 1, name: 'Homework', position: 1, group_weight: 40 },
        { id: 2, name: 'Exams', position: 2, group_weight: 60 },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockGroups)

      const result = await assignments.listGroups(100)
      expect(result).toEqual(mockGroups)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/assignment_groups', {})
    })

    it('returns empty array when no groups', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await assignments.listGroups(100)
      expect(result).toEqual([])
    })

    it('forwards include[] and filters', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await assignments.listGroups(100, {
        include: ['assignments', 'submission'],
        assignment_ids: [7, 8],
        grading_period_id: 5,
        scope_assignments_to_student: true,
      })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/assignment_groups', {
        include: ['assignments', 'submission'],
        assignment_ids: [7, 8],
        grading_period_id: 5,
        scope_assignments_to_student: true,
      })
    })
  })

  describe('create', () => {
    it('creates an assignment with required params', async () => {
      const mockAssignment: CanvasAssignment = {
        id: 10,
        name: 'New HW',
        description: null,
        due_at: null,
        points_possible: 0,
        grading_type: 'points',
        submission_types: ['none'],
        course_id: 100,
        allowed_attempts: -1,
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockAssignment)

      const result = await assignments.create(100, { name: 'New HW' })
      expect(result).toEqual(mockAssignment)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments', {
        method: 'POST',
        body: JSON.stringify({ assignment: { name: 'New HW' } }),
      })
    })

    it('creates an assignment with all optional params', async () => {
      const mockAssignment: CanvasAssignment = {
        id: 11,
        name: 'Full HW',
        description: '<p>Details</p>',
        due_at: '2026-06-01T23:59:00Z',
        points_possible: 50,
        grading_type: 'points',
        submission_types: ['online_upload'],
        course_id: 100,
        allowed_attempts: -1,
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockAssignment)

      await assignments.create(100, {
        name: 'Full HW',
        description: '<p>Details</p>',
        points_possible: 50,
        due_at: '2026-06-01T23:59:00Z',
        submission_types: ['online_upload'],
        assignment_group_id: 5,
      })

      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments', {
        method: 'POST',
        body: JSON.stringify({
          assignment: {
            name: 'Full HW',
            description: '<p>Details</p>',
            points_possible: 50,
            due_at: '2026-06-01T23:59:00Z',
            submission_types: ['online_upload'],
            assignment_group_id: 5,
          },
        }),
      })
    })
  })

  describe('update', () => {
    it('updates an assignment', async () => {
      const mockAssignment: CanvasAssignment = {
        id: 1,
        name: 'Updated HW',
        description: null,
        due_at: null,
        points_possible: 75,
        grading_type: 'points',
        submission_types: ['online_upload'],
        course_id: 100,
        allowed_attempts: -1,
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockAssignment)

      const result = await assignments.update(100, 1, { name: 'Updated HW', points_possible: 75 })
      expect(result).toEqual(mockAssignment)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments/1', {
        method: 'PUT',
        body: JSON.stringify({ assignment: { name: 'Updated HW', points_possible: 75 } }),
      })
    })

    it('constructs correct URL for different IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({} as CanvasAssignment)

      await assignments.update(42, 99, { name: 'Renamed' })
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/assignments/99', {
        method: 'PUT',
        body: JSON.stringify({ assignment: { name: 'Renamed' } }),
      })
    })
  })

  describe('delete', () => {
    it('deletes an assignment', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)

      await assignments.delete(100, 1)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/100/assignments/1', {
        method: 'DELETE',
      })
    })

    it('constructs correct URL for different IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)

      await assignments.delete(42, 99)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/assignments/99', {
        method: 'DELETE',
      })
    })
  })
})
