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
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/100/assignments',
      )
    })

    it('returns empty array when no assignments', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await assignments.list(100)
      expect(result).toEqual([])
    })

    it('constructs correct URL for different course IDs', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await assignments.list(42)
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/42/assignments',
      )
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
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/100/assignments/1',
      )
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
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42/assignments/55',
      )
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
      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/100/assignment_groups',
      )
    })

    it('returns empty array when no groups', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await assignments.listGroups(100)
      expect(result).toEqual([])
    })
  })
})
