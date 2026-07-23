import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewQuizzesModule } from '../../src/canvas/new-quizzes'
import { CanvasApiError, CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasNewQuizAccommodation } from '../../src/canvas/types'

const COURSE_ID = 100
const ASSIGNMENT_ID = 42
const ITEM_ID = 'item-uuid-001'

function makeClient(): CanvasHttpClient {
  return new CanvasHttpClient({ token: 'test-token', baseUrl: 'https://canvas.example.com' })
}

function makeQuiz() {
  return {
    id: 1,
    title: 'My New Quiz',
    instructions: null,
    points_possible: 10,
    due_at: null,
    unlock_at: null,
    lock_at: null,
    published: false,
    assignment_id: ASSIGNMENT_ID,
  }
}

function makeItem(overrides: object = {}) {
  return {
    id: ITEM_ID,
    position: 1,
    points_possible: 5,
    entry_type: 'Item',
    entry: {
      interaction_type_slug: 'choice',
      item_body: '<p>Q</p>',
      interaction_data: {},
      properties: {},
    },
    ...overrides,
  }
}

describe('NewQuizzesModule', () => {
  let client: CanvasHttpClient
  let mod: NewQuizzesModule

  beforeEach(() => {
    client = makeClient()
    mod = new NewQuizzesModule(client)
  })

  // --- Quiz CRUD ---

  it('creates a quiz', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeQuiz())
    const result = await mod.create(COURSE_ID, { title: 'My New Quiz' })
    expect(result).toMatchObject({ id: 1, title: 'My New Quiz' })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('updates a quiz', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ ...makeQuiz(), published: true })
    const result = await mod.update(COURSE_ID, ASSIGNMENT_ID, { published: true })
    expect(result.published).toBe(true)
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}`,
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('deletes a quiz without throwing on 204', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await expect(mod.delete(COURSE_ID, ASSIGNMENT_ID)).resolves.toBeUndefined()
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  // --- Item reads ---

  it('lists quiz items using bare-array pagination', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([makeItem()])
    const result = await mod.listItems(COURSE_ID, ASSIGNMENT_ID)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items`,
    )
  })

  it('gets a single quiz item', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    const result = await mod.getItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID)
    expect(result.id).toBe(ITEM_ID)
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items/${ITEM_ID}`,
    )
  })

  // --- Item deletes ---

  it('deletes a quiz item without throwing on 204', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(undefined)
    await expect(mod.deleteItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID)).resolves.toBeUndefined()
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items/${ITEM_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  // --- createItem wire-format translations ---

  it('createItem: choice — produces correct wire body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 5,
      item: {
        interaction_type_slug: 'choice',
        item_body: '<p>What is 2+2?</p>',
        choices: [
          { id: 'a', item_body: '<p>3</p>' },
          { id: 'b', item_body: '<p>4</p>' },
        ],
        correct_choice_id: 'b',
      },
    })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"scoring_algorithm":"Equivalence"'),
      }),
    )
    const callArgs = vi.mocked(client.request).mock.calls[0]
    const body = JSON.parse(callArgs[1]!.body as string)
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 5,
      entry: {
        interaction_type_slug: 'choice',
        item_body: '<p>What is 2+2?</p>',
        interaction_data: {
          choices: [
            { id: 'a', position: 1, item_body: '<p>3</p>' },
            { id: 'b', position: 2, item_body: '<p>4</p>' },
          ],
        },
        scoring_data: { value: 'b' },
        scoring_algorithm: 'Equivalence',
      },
    })
  })

  it('createItem: true-false — produces correct wire body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'true-false',
        item_body: '<p>The sky is blue.</p>',
        correct_answer: true,
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 1,
      entry: {
        interaction_type_slug: 'true-false',
        item_body: '<p>The sky is blue.</p>',
        interaction_data: {
          choices: [
            { id: 'true', position: 1, item_body: 'True' },
            { id: 'false', position: 2, item_body: 'False' },
          ],
        },
        scoring_data: { value: 'true' },
        scoring_algorithm: 'Equivalence',
      },
    })
  })

  it('createItem: essay — produces correct wire body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 10,
      item: {
        interaction_type_slug: 'essay',
        item_body: '<p>Describe the water cycle.</p>',
        rich_text: true,
        word_count_min: 50,
        word_count_max: 300,
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 10,
      entry: {
        interaction_type_slug: 'essay',
        item_body: '<p>Describe the water cycle.</p>',
        interaction_data: { rce_enabled: true },
        properties: { word_count: { min: 50, max: 300 } },
        scoring_data: {},
        scoring_algorithm: 'None',
      },
    })
  })

  it('createItem: matching — produces correct wire body with scoring pairs', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 4,
      item: {
        interaction_type_slug: 'matching',
        item_body: '<p>Match the capitals.</p>',
        matches: [
          { question: 'France', answer: 'Paris' },
          { question: 'Germany', answer: 'Berlin' },
        ],
        distractors: ['London'],
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 4,
      entry: {
        interaction_type_slug: 'matching',
        item_body: '<p>Match the capitals.</p>',
        interaction_data: {
          matches: [
            { id: 'match_0', item_body: 'France' },
            { id: 'match_1', item_body: 'Germany' },
          ],
          responses: [
            { id: 'resp_0', item_body: 'Paris' },
            { id: 'resp_1', item_body: 'Berlin' },
            { id: 'dist_0', item_body: 'London' },
          ],
        },
        scoring_data: {
          value: [
            { id: 'match_0', match_id: 'resp_0' },
            { id: 'match_1', match_id: 'resp_1' },
          ],
        },
        scoring_algorithm: 'Equivalence',
      },
    })
  })

  it('createItem: numeric exact — produces Exact scoring algorithm', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>What is 2+2?</p>',
        answers: [{ kind: 'exact', value: 4, margin: 0 }],
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry: {
        interaction_type_slug: 'numeric',
        scoring_data: { exact_answer: 4, margin: 0 },
        scoring_algorithm: 'Exact',
      },
    })
  })

  it('createItem: numeric range — produces Range scoring algorithm', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>Approximate value of pi?</p>',
        answers: [{ kind: 'range', min: 3.1, max: 3.2 }],
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry: {
        interaction_type_slug: 'numeric',
        scoring_data: { lower_bound: 3.1, upper_bound: 3.2 },
        scoring_algorithm: 'Range',
      },
    })
  })

  it('createItem: numeric precision — produces Precision scoring algorithm', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>Value of pi to 2 decimal places?</p>',
        answers: [{ kind: 'precision', value: 3.14, precision: 2 }],
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      entry: {
        interaction_type_slug: 'numeric',
        scoring_data: { exact_answer: 3.14, precision: 2 },
        scoring_algorithm: 'Precision',
      },
    })
  })

  // --- updateItem ---

  it('updateItem: sends entry when item provided', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, {
      points_possible: 3,
      item: {
        interaction_type_slug: 'true-false',
        item_body: '<p>Updated.</p>',
        correct_answer: false,
      },
    })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items/${ITEM_ID}`,
      expect.objectContaining({ method: 'PATCH' }),
    )
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      points_possible: 3,
      entry: { scoring_data: { value: 'false' } },
    })
  })
})

describe('NewQuizzesModule — accommodations', () => {
  const USER_ID = 42
  const mockAccommodation: CanvasNewQuizAccommodation = {
    user_id: USER_ID,
    time_multiplier: 1.5,
    extra_attempts: 1,
  }

  let client: CanvasHttpClient
  let mod: NewQuizzesModule

  beforeEach(() => {
    client = makeClient()
    vi.spyOn(client, 'request').mockResolvedValue(mockAccommodation)
    mod = new NewQuizzesModule(client)
  })

  describe('setAccommodation', () => {
    it('sends both fields and returns the record', async () => {
      const result = await mod.setAccommodation(COURSE_ID, USER_ID, 1.5, 1)
      expect(result).toEqual(mockAccommodation)
      expect(client.request).toHaveBeenCalledWith(
        `/api/quiz/v1/courses/${COURSE_ID}/accommodations`,
        expect.objectContaining({ method: 'POST' }),
      )
      const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
      expect(body).toEqual({ user_id: USER_ID, time_multiplier: 1.5, extra_attempts: 1 })
    })

    it('omits extra_attempts when undefined', async () => {
      await mod.setAccommodation(COURSE_ID, USER_ID, 1.5, undefined)
      const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
      expect(body).toEqual({ user_id: USER_ID, time_multiplier: 1.5 })
      expect(body).not.toHaveProperty('extra_attempts')
    })

    it('omits time_multiplier when undefined', async () => {
      await mod.setAccommodation(COURSE_ID, USER_ID, undefined, 2)
      const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string)
      expect(body).toEqual({ user_id: USER_ID, extra_attempts: 2 })
      expect(body).not.toHaveProperty('time_multiplier')
    })
  })

  describe('setQuizAccommodation', () => {
    it('sends to the per-quiz endpoint and returns the record', async () => {
      const result = await mod.setQuizAccommodation(COURSE_ID, ASSIGNMENT_ID, USER_ID, 1.5, 1)
      expect(result).toEqual(mockAccommodation)
      expect(client.request).toHaveBeenCalledWith(
        `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/accommodations`,
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('propagates errors', async () => {
      vi.mocked(client.request).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/quiz/v1/...'),
      )
      await expect(
        mod.setQuizAccommodation(COURSE_ID, ASSIGNMENT_ID, USER_ID, 1.5),
      ).rejects.toThrow('Not Found')
    })
  })

  describe('getAccommodation', () => {
    it('returns the record when it exists', async () => {
      const result = await mod.getAccommodation(COURSE_ID, USER_ID)
      expect(result).toEqual(mockAccommodation)
      expect(client.request).toHaveBeenCalledWith(
        `/api/quiz/v1/courses/${COURSE_ID}/accommodations/${USER_ID}`,
      )
    })

    it('returns null on 404', async () => {
      vi.mocked(client.request).mockRejectedValueOnce(
        new CanvasApiError('Not Found', 404, '/api/quiz/v1/...'),
      )
      const result = await mod.getAccommodation(COURSE_ID, USER_ID)
      expect(result).toBeNull()
    })

    it('propagates non-404 errors', async () => {
      vi.mocked(client.request).mockRejectedValueOnce(
        new CanvasApiError('Forbidden', 403, '/api/quiz/v1/...'),
      )
      await expect(mod.getAccommodation(COURSE_ID, USER_ID)).rejects.toThrow('Forbidden')
    })
  })
})
