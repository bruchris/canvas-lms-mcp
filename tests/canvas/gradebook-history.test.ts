import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasHttpClient } from '../../src/canvas/client'
import { GradebookHistoryModule } from '../../src/canvas/gradebook-history'
import type {
  CanvasGradebookHistoryDay,
  CanvasGradebookHistoryGrader,
  CanvasGradebookHistorySubmission,
  CanvasGradebookHistorySubmissionVersion,
} from '../../src/canvas/types'

describe('GradebookHistoryModule', () => {
  let client: CanvasHttpClient
  let gradebookHistory: GradebookHistoryModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    gradebookHistory = new GradebookHistoryModule(client)
  })

  describe('listDays', () => {
    it('requests the gradebook history days endpoint', async () => {
      const mockDays: CanvasGradebookHistoryDay[] = [
        {
          date: '2026-04-20',
          graders: [{ id: 7, name: 'Prof Smith', assignments: [101, 102] }],
        },
      ]

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockDays)

      const result = await gradebookHistory.listDays(42)

      expect(result).toEqual(mockDays)
      expect(client.request).toHaveBeenCalledWith('/api/v1/courses/42/gradebook_history/days')
    })
  })

  describe('getDay', () => {
    it('requests a specific gradebook history date', async () => {
      const mockGraders: CanvasGradebookHistoryGrader[] = [
        { id: 7, name: 'Prof Smith', assignments: [101, 102] },
      ]

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockGraders)

      const result = await gradebookHistory.getDay(42, '2026-04-20')

      expect(result).toEqual(mockGraders)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42/gradebook_history/2026-04-20',
      )
    })

    it('encodes special characters in the date path segment', async () => {
      vi.spyOn(client, 'request').mockResolvedValueOnce([])

      await gradebookHistory.getDay(42, '2026-04-20+section-a')

      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42/gradebook_history/2026-04-20%2Bsection-a',
      )
    })
  })

  describe('listSubmissions', () => {
    it('requests the nested submissions endpoint for a grader and assignment', async () => {
      const mockSubmissions: CanvasGradebookHistorySubmission[] = [
        {
          submission_id: 99,
          versions: [
            {
              id: 99,
              assignment_id: 101,
              user_id: 12,
              submitted_at: '2026-04-20T08:00:00Z',
              score: 95,
              grade: '95',
              body: null,
              url: null,
              attempt: 1,
              workflow_state: 'graded',
              new_grade: '95',
              previous_grade: '90',
            },
          ],
        },
      ]

      vi.spyOn(client, 'request').mockResolvedValueOnce(mockSubmissions)

      const result = await gradebookHistory.listSubmissions(42, '2026-04-20', 7, 101)

      expect(result).toEqual(mockSubmissions)
      expect(client.request).toHaveBeenCalledWith(
        '/api/v1/courses/42/gradebook_history/2026-04-20/graders/7/assignments/101/submissions',
      )
    })
  })

  describe('getFeed', () => {
    it('requests the gradebook history feed without filters by default', async () => {
      const mockFeed: CanvasGradebookHistorySubmissionVersion[] = [
        {
          id: 99,
          assignment_id: 101,
          user_id: 12,
          submitted_at: '2026-04-20T08:00:00Z',
          score: 95,
          grade: '95',
          body: null,
          url: null,
          attempt: 1,
          workflow_state: 'graded',
          assignment_name: 'Essay 1',
        },
      ]

      vi.spyOn(client, 'paginate').mockResolvedValueOnce(mockFeed)

      const result = await gradebookHistory.getFeed(42)

      expect(result).toEqual(mockFeed)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/42/gradebook_history/feed')
    })

    it('serializes optional feed filters into the query string', async () => {
      vi.spyOn(client, 'paginate').mockResolvedValueOnce([])

      await gradebookHistory.getFeed(42, {
        assignment_id: 101,
        user_id: 12,
        ascending: true,
      })

      expect(client.paginate).toHaveBeenCalledWith(
        '/api/v1/courses/42/gradebook_history/feed?assignment_id=101&user_id=12&ascending=true',
      )
    })
  })
})
