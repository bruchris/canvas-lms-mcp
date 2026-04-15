import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PeerReviewsModule } from '../../src/canvas/peer-reviews'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('PeerReviewsModule', () => {
  let client: CanvasHttpClient
  let peerReviews: PeerReviewsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    peerReviews = new PeerReviewsModule(client)
  })

  it('lists peer reviews for an assignment', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, assessor_id: 10, asset_id: 20, user_id: 10, workflow_state: 'assigned' },
    ])
    const result = await peerReviews.listForAssignment(1, 2)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/1/assignments/2/peer_reviews')
  })

  it('lists peer reviews for a submission', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 2, assessor_id: 11, asset_id: 30, user_id: 11, workflow_state: 'completed' },
    ])
    const result = await peerReviews.listForSubmission(1, 2, 3)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith(
      '/api/v1/courses/1/assignments/2/submissions/3/peer_reviews',
    )
  })

  it('creates a peer review via POST with user_id in body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      id: 3,
      assessor_id: 42,
      asset_id: 99,
      user_id: 42,
      workflow_state: 'assigned',
    })
    const result = await peerReviews.create(1, 2, 3, 42)
    expect(result).toMatchObject({ id: 3, user_id: 42 })
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/1/assignments/2/submissions/3/peer_reviews',
      {
        method: 'POST',
        body: JSON.stringify({ user_id: 42 }),
      },
    )
  })

  it('deletes a peer review via DELETE with user_id as query param', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await peerReviews.delete(1, 2, 3, 42)
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/courses/1/assignments/2/submissions/3/peer_reviews?user_id=42',
      { method: 'DELETE' },
    )
  })
})
