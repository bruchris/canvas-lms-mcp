import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasPeerReview } from '../../src/canvas/types'
import { peerReviewTools } from '../../src/tools/peer-reviews'

describe('peerReviewTools', () => {
  const mockPeerReview: CanvasPeerReview = {
    id: 1,
    assessor_id: 5,
    user_id: 10,
    asset_id: 100,
    asset_type: 'Submission',
    workflow_state: 'assigned',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      peerReviews: {
        listForAssignment: vi.fn().mockResolvedValue([mockPeerReview]),
        listForSubmission: vi.fn().mockResolvedValue([mockPeerReview]),
        create: vi.fn().mockResolvedValue(mockPeerReview),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 4 tool definitions', () => {
    expect(peerReviewTools(buildMockCanvas())).toHaveLength(4)
  })

  it('exports tools with correct names', () => {
    const names = peerReviewTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_peer_reviews',
      'get_submission_peer_reviews',
      'create_peer_review',
      'delete_peer_review',
    ])
  })

  describe('list_peer_reviews', () => {
    it('has read-only annotations', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'list_peer_reviews')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.peerReviews.listForAssignment', async () => {
      const canvas = buildMockCanvas()
      const tool = peerReviewTools(canvas).find((t) => t.name === 'list_peer_reviews')!
      await tool.handler({ course_id: '1', assignment_id: '2' })
      expect(canvas.peerReviews.listForAssignment).toHaveBeenCalledWith('1', '2')
    })

    it('routes to get_submission_peer_reviews for the per-submission view and documents pagination', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'list_peer_reviews')!
      expect(tool.description).toContain('get_submission_peer_reviews')
      expect(tool.description).toMatch(/every page|pagin/i)
    })
  })

  describe('get_submission_peer_reviews', () => {
    it('has read-only annotations', () => {
      const tool = peerReviewTools(buildMockCanvas()).find(
        (t) => t.name === 'get_submission_peer_reviews',
      )!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.peerReviews.listForSubmission', async () => {
      const canvas = buildMockCanvas()
      const tool = peerReviewTools(canvas).find((t) => t.name === 'get_submission_peer_reviews')!
      await tool.handler({ course_id: '1', assignment_id: '2', submission_id: '3' })
      expect(canvas.peerReviews.listForSubmission).toHaveBeenCalledWith('1', '2', '3')
    })

    it('routes to list_peer_reviews for the whole-assignment view', () => {
      const tool = peerReviewTools(buildMockCanvas()).find(
        (t) => t.name === 'get_submission_peer_reviews',
      )!
      expect(tool.description).toContain('list_peer_reviews')
    })
  })

  describe('create_peer_review', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'create_peer_review')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.peerReviews.create', async () => {
      const canvas = buildMockCanvas()
      const tool = peerReviewTools(canvas).find((t) => t.name === 'create_peer_review')!
      await tool.handler({ course_id: '1', assignment_id: '2', submission_id: '3', user_id: '5' })
      expect(canvas.peerReviews.create).toHaveBeenCalledWith('1', '2', '3', '5')
    })
  })

  describe('delete_peer_review', () => {
    it('has destructive and openWorld annotations, with no idempotentHint claim', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'delete_peer_review')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.peerReviews.delete', async () => {
      const canvas = buildMockCanvas()
      const tool = peerReviewTools(canvas).find((t) => t.name === 'delete_peer_review')!
      await tool.handler({ course_id: '1', assignment_id: '2', submission_id: '3', user_id: '5' })
      expect(canvas.peerReviews.delete).toHaveBeenCalledWith('1', '2', '3', '5')
    })

    it('returns undefined from the handler, matching the "Operation completed successfully" ack path', async () => {
      const canvas = buildMockCanvas()
      const tool = peerReviewTools(canvas).find((t) => t.name === 'delete_peer_review')!
      const result = await tool.handler({
        course_id: '1',
        assignment_id: '2',
        submission_id: '3',
        user_id: '5',
      })
      expect(result).toBeUndefined()
    })

    it('describes removal as a reversible relationship removal, not an irreversible delete', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'delete_peer_review')!
      expect(tool.description).not.toMatch(/action is permanent/i)
      expect(tool.description).toMatch(/reversible/i)
      expect(tool.description).toContain('create_peer_review')
    })

    it('names the required permission and the sibling tools used to find the user_id', () => {
      const tool = peerReviewTools(buildMockCanvas()).find((t) => t.name === 'delete_peer_review')!
      expect(tool.description).toMatch(/requires?/i)
      expect(tool.description).toContain('list_peer_reviews')
      expect(tool.description).toContain('get_submission_peer_reviews')
    })
  })
})
