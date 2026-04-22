import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubmissionsModule } from '../../src/canvas/submissions'
import { CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasSubmission } from '../../src/canvas/types'

describe('SubmissionsModule', () => {
  let client: CanvasHttpClient
  let submissions: SubmissionsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    submissions = new SubmissionsModule(client)
  })

  describe('list', () => {
    it('lists submissions for an assignment', async () => {
      const mockSubmissions: CanvasSubmission[] = [
        {
          id: 1,
          assignment_id: 10,
          user_id: 100,
          submitted_at: '2026-04-10T12:00:00Z',
          score: 95,
          grade: '95',
          body: 'My submission',
          url: null,
          attempt: 1,
          workflow_state: 'graded',
        },
        {
          id: 2,
          assignment_id: 10,
          user_id: 200,
          submitted_at: null,
          score: null,
          grade: null,
          body: null,
          url: null,
          attempt: null,
          workflow_state: 'unsubmitted',
        },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockSubmissions)

      const result = await submissions.list(1, 10)
      expect(result).toEqual(mockSubmissions)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/1/assignments/10/submissions', {
        include: ['submission_comments'],
      })
    })

    it('forwards explicit include[] plus student_ids and workflow_state filters', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await submissions.list(1, 10, {
        include: ['user', 'rubric_assessment'],
        student_ids: [5, 6],
        workflow_state: 'submitted',
        grouped: true,
      })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/1/assignments/10/submissions', {
        include: ['user', 'rubric_assessment'],
        student_ids: [5, 6],
        workflow_state: 'submitted',
        grouped: true,
      })
    })

    it('returns empty array when no submissions', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      const result = await submissions.list(1, 10)
      expect(result).toEqual([])
    })
  })

  describe('get', () => {
    it('gets a single submission by user ID', async () => {
      const mockSubmission: CanvasSubmission = {
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: '2026-04-10T12:00:00Z',
        score: 95,
        grade: '95',
        body: 'My submission',
        url: null,
        attempt: 1,
        workflow_state: 'graded',
        submission_comments: [
          {
            id: 1,
            author_id: 50,
            author_name: 'Prof Smith',
            comment: 'Great work!',
            created_at: '2026-04-11T08:00:00Z',
          },
        ],
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockSubmission)

      const result = await submissions.get(1, 10, 100)
      expect(result).toEqual(mockSubmission)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        { query: { include: ['submission_comments'] } },
      )
    })

    it('constructs correct URL for different IDs', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 5,
        assignment_id: 20,
        user_id: 300,
        submitted_at: null,
        score: null,
        grade: null,
        body: null,
        url: null,
        attempt: null,
        workflow_state: 'unsubmitted',
      })

      await submissions.get(42, 20, 300)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42/assignments/20/submissions/300',
        { query: { include: ['submission_comments'] } },
      )
    })

    it('honors caller-provided include', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: null,
        score: null,
        grade: null,
        body: null,
        url: null,
        attempt: null,
        workflow_state: 'submitted',
      })

      await submissions.get(1, 10, 100, { include: ['rubric_assessment', 'user'] })
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        { query: { include: ['rubric_assessment', 'user'] } },
      )
    })
  })

  describe('grade', () => {
    it('grades a submission with PUT and posted_grade', async () => {
      const mockResponse: CanvasSubmission = {
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: '2026-04-10T12:00:00Z',
        score: 95,
        grade: '95',
        body: 'My submission',
        url: null,
        attempt: 1,
        workflow_state: 'graded',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockResponse)

      const result = await submissions.grade(1, 10, 100, '95')
      expect(result).toMatchObject({ score: 95, grade: '95' })
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        {
          method: 'PUT',
          body: JSON.stringify({ submission: { posted_grade: '95' } }),
        },
      )
    })

    it('supports letter grades', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: null,
        score: null,
        grade: 'A',
        body: null,
        url: null,
        attempt: null,
        workflow_state: 'graded',
      })

      await submissions.grade(1, 10, 100, 'A')
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        {
          method: 'PUT',
          body: JSON.stringify({ submission: { posted_grade: 'A' } }),
        },
      )
    })
  })

  describe('listMy', () => {
    it('fetches submissions for self with student_ids=[self]', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await submissions.listMy(10)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/10/students/submissions', {
        student_ids: ['self'],
      })
    })

    it('uses the correct course ID in the URL', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])
      await submissions.listMy(99)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/99/students/submissions', {
        student_ids: ['self'],
      })
    })
  })

  describe('comment', () => {
    it('posts a comment on a submission with PUT and text_comment', async () => {
      const mockResponse: CanvasSubmission = {
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: '2026-04-10T12:00:00Z',
        score: 95,
        grade: '95',
        body: 'My submission',
        url: null,
        attempt: 1,
        workflow_state: 'graded',
      }

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockResponse)

      await submissions.comment(1, 10, 100, 'Great work!')
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        {
          method: 'PUT',
          body: JSON.stringify({ comment: { text_comment: 'Great work!' } }),
        },
      )
    })

    it('handles comments with special characters', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce({
        id: 1,
        assignment_id: 10,
        user_id: 100,
        submitted_at: null,
        score: null,
        grade: null,
        body: null,
        url: null,
        attempt: null,
        workflow_state: 'submitted',
      })

      const comment = 'Good job! Score: 95/100 — keep it up "student"'
      await submissions.comment(1, 10, 100, comment)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/1/assignments/10/submissions/100',
        {
          method: 'PUT',
          body: JSON.stringify({ comment: { text_comment: comment } }),
        },
      )
    })
  })
})
