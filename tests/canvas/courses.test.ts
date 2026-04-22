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
    it('lists courses with default include[]=term', async () => {
      const mockCourses: CanvasCourse[] = [
        { id: 1, name: 'CS 101', course_code: 'CS101', workflow_state: 'available' },
        { id: 2, name: 'Math 201', course_code: 'MATH201', workflow_state: 'available' },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockCourses)

      const result = await courses.list()
      expect(result).toEqual(mockCourses)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        include: ['term'],
      })
    })

    it('passes enrollment_state filter', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await courses.list({ enrollment_state: 'completed' })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        include: ['term'],
        enrollment_state: 'completed',
      })
    })

    it('honors a caller-provided include list', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await courses.list({ include: ['teachers', 'total_students'] })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        include: ['teachers', 'total_students'],
      })
    })

    it('forwards state[] and exclude_blueprint_courses', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await courses.list({
        state: ['available', 'completed'],
        exclude_blueprint_courses: true,
      })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses', {
        include: ['term'],
        state: ['available', 'completed'],
        exclude_blueprint_courses: true,
      })
    })

    it('returns empty array when no courses', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await courses.list()
      expect(result).toEqual([])
    })
  })

  describe('get', () => {
    it('gets a single course with default include=[term, total_students]', async () => {
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
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1', {
        query: { include: ['term', 'total_students'] },
      })
    })

    it('honors caller-provided include', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 42,
        name: 'Art 300',
        course_code: 'ART300',
        workflow_state: 'available',
      })

      await courses.get(42, { include: ['teachers', 'permissions'], teacher_limit: 5 })
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42', {
        query: { include: ['teachers', 'permissions'], teacher_limit: 5 },
      })
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
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1', {
        query: { include: ['syllabus_body'] },
      })
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
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99', {
        query: { include: ['syllabus_body'] },
      })
    })
  })

  describe('create', () => {
    it('posts to accounts endpoint with course body', async () => {
      const mockCourse: CanvasCourse = {
        id: 10,
        name: 'New Course',
        course_code: 'NEW101',
        workflow_state: 'unpublished',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      const result = await courses.create({
        account_id: 1,
        name: 'New Course',
        course_code: 'NEW101',
      })
      expect(result).toEqual(mockCourse)
      expect(client.request).toHaveBeenCalledWith('/api/v1/accounts/1/courses', {
        method: 'POST',
        body: JSON.stringify({ course: { name: 'New Course', course_code: 'NEW101' } }),
      })
    })

    it('posts with only required fields when optionals omitted', async () => {
      const mockCourse: CanvasCourse = {
        id: 11,
        name: 'Minimal Course',
        course_code: '',
        workflow_state: 'unpublished',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      await courses.create({ account_id: 5, name: 'Minimal Course' })
      expect(client.request).toHaveBeenCalledWith('/api/v1/accounts/5/courses', {
        method: 'POST',
        body: JSON.stringify({ course: { name: 'Minimal Course' } }),
      })
    })

    it('includes start_at and end_at when provided', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 12,
        name: 'Dated Course',
        course_code: 'DAT101',
        workflow_state: 'unpublished',
      })

      await courses.create({
        account_id: 1,
        name: 'Dated Course',
        start_at: '2026-01-15T00:00:00Z',
        end_at: '2026-05-15T00:00:00Z',
      })
      expect(client.request).toHaveBeenCalledWith('/api/v1/accounts/1/courses', {
        method: 'POST',
        body: JSON.stringify({
          course: {
            name: 'Dated Course',
            start_at: '2026-01-15T00:00:00Z',
            end_at: '2026-05-15T00:00:00Z',
          },
        }),
      })
    })
  })

  describe('update', () => {
    it('puts to course endpoint with course body', async () => {
      const mockCourse: CanvasCourse = {
        id: 1,
        name: 'Renamed Course',
        course_code: 'REN101',
        workflow_state: 'available',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockCourse)

      const result = await courses.update(1, { name: 'Renamed Course', course_code: 'REN101' })
      expect(result).toEqual(mockCourse)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1', {
        method: 'PUT',
        body: JSON.stringify({ course: { name: 'Renamed Course', course_code: 'REN101' } }),
      })
    })

    it('sends only provided fields', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 1,
        name: 'CS 101',
        course_code: 'CS101',
        workflow_state: 'available',
      })

      await courses.update(1, { syllabus_body: '<p>Updated syllabus</p>' })
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/1', {
        method: 'PUT',
        body: JSON.stringify({ course: { syllabus_body: '<p>Updated syllabus</p>' } }),
      })
    })

    it('constructs correct URL for different course IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 99,
        name: 'Bio 100',
        course_code: 'BIO100',
        workflow_state: 'available',
      })

      await courses.update(99, { default_view: 'modules' })
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/99', {
        method: 'PUT',
        body: JSON.stringify({ course: { default_view: 'modules' } }),
      })
    })
  })
})
