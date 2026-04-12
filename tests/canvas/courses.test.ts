import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CoursesModule } from '../../src/canvas/courses'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasCourse } from '../../src/canvas/types'

describe('CoursesModule', () => {
  let client: CanvasHttpClient
  let courses: CoursesModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    courses = new CoursesModule(client)
  })

  describe('list', () => {
    it('lists courses with pagination', async () => {
      const mockCourses: CanvasCourse[] = [
        { id: 1, name: 'CS 101', course_code: 'CS101', workflow_state: 'available' },
        { id: 2, name: 'Math 201', course_code: 'MATH201', workflow_state: 'available' },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockCourses)

      const result = await courses.list()
      expect(result).toEqual(mockCourses)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        'include[]': 'term',
      })
    })

    it('passes enrollment_state filter', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await courses.list({ enrollment_state: 'completed' })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        'include[]': 'term',
        enrollment_state: 'completed',
      })
    })

    it('omits enrollment_state when not provided', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await courses.list()
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        'include[]': 'term',
      })
    })

    it('returns empty array when no courses', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await courses.list()
      expect(result).toEqual([])
    })
  })

  describe('get', () => {
    it('gets a single course with term and total_students includes', async () => {
      const mockCourse: CanvasCourse = {
        id: 1,
        name: 'CS 101',
        course_code: 'CS101',
        workflow_state: 'available',
        total_students: 35,
        term: { id: 1, name: 'Fall 2026', start_at: null, end_at: null },
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      const result = await courses.get(1)
      expect(result).toEqual(mockCourse)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1?include[]=term&include[]=total_students',
      )
    })

    it('constructs correct URL for different course IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 42,
        name: 'Art 300',
        course_code: 'ART300',
        workflow_state: 'available',
      })

      await courses.get(42)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42?include[]=term&include[]=total_students',
      )
    })
  })

  describe('getSyllabus', () => {
    it('returns syllabus body when present', async () => {
      const mockCourse: CanvasCourse = {
        id: 1,
        name: 'CS 101',
        course_code: 'CS101',
        workflow_state: 'available',
        syllabus_body: '<p>Welcome to CS 101</p>',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      const result = await courses.getSyllabus(1)
      expect(result).toBe('<p>Welcome to CS 101</p>')
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1?include[]=syllabus_body',
      )
    })

    it('returns null when syllabus_body is undefined', async () => {
      const mockCourse: CanvasCourse = {
        id: 1,
        name: 'CS 101',
        course_code: 'CS101',
        workflow_state: 'available',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      const result = await courses.getSyllabus(1)
      expect(result).toBeNull()
    })

    it('constructs correct URL for different course IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 99,
        name: 'Bio 100',
        course_code: 'BIO100',
        workflow_state: 'available',
      })

      await courses.getSyllabus(99)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/99?include[]=syllabus_body',
      )
    })
  })
})
