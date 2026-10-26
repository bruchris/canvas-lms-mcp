import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewQuizzesModule, type NewQuizItemInput } from '../../src/canvas/new-quizzes'
import { CanvasApiError, CanvasHttpClient } from '../../src/canvas/client'
import type { CanvasNewQuizAccommodation } from '../../src/canvas/types'

const COURSE_ID = 100
const ASSIGNMENT_ID = 42
const ITEM_ID = 'item-uuid-001'

/** The `entry` object as it travels on the wire, before Canvas widens it. */
type WireEntry = {
  interaction_type_slug: string
  title?: string
  item_body: string
  interaction_data: Record<string, unknown>
  properties: Record<string, unknown>
  scoring_data: Record<string, never> & { value?: unknown }
  scoring_algorithm: string
}

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

  it('creates a quiz with the fields nested under `quiz`', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeQuiz())
    const result = await mod.create(COURSE_ID, { title: 'My New Quiz' })
    expect(result).toMatchObject({ id: 1, title: 'My New Quiz' })
    expect(client.request).toHaveBeenCalledWith(`/api/quiz/v1/courses/${COURSE_ID}/quizzes`, {
      method: 'POST',
      body: JSON.stringify({ quiz: { title: 'My New Quiz' } }),
    })
  })

  it('updates a quiz with the patch nested under `quiz`', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce({ ...makeQuiz(), published: true })
    const result = await mod.update(COURSE_ID, ASSIGNMENT_ID, { published: true })
    expect(result.published).toBe(true)
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}`,
      { method: 'PATCH', body: JSON.stringify({ quiz: { published: true } }) },
    )
  })

  it('never sends quiz fields at the top level of the body', async () => {
    // Regression: a flat body is rejected by Canvas with `400 quiz is missing`.
    vi.spyOn(client, 'request').mockResolvedValue(makeQuiz())
    await mod.create(COURSE_ID, { title: 'Flat?', published: false })
    await mod.update(COURSE_ID, ASSIGNMENT_ID, { title: 'Flat?' })
    for (const call of vi.mocked(client.request).mock.calls) {
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>
      expect(Object.keys(body)).toEqual(['quiz'])
    }
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
  //
  // Every expected shape below is taken from the Canvas "New Quiz Items" REST
  // docs (Appendix: Question Types) and was confirmed against live Canvas in
  // GitHub issue #485. Canvas rejects anything else with a 422.

  it('createItem: choice — produces correct wire body', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 5,
      item: {
        interaction_type_slug: 'choice',
        title: 'Arithmetic 1',
        item_body: '<p>What is 2+2?</p>',
        choices: [
          { id: 'a', item_body: '<p>3</p>' },
          { id: 'b', item_body: '<p>4</p>' },
        ],
        correct_choice_id: 'b',
      },
    })
    const callArgs = vi.mocked(client.request).mock.calls[0]
    const body = JSON.parse(callArgs[1]!.body as string).item
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 5,
      entry: {
        interaction_type_slug: 'choice',
        // Regression (#485): `title` was accepted by the tool and then dropped
        // before the request. Canvas documents it as `item[entry][title]`.
        title: 'Arithmetic 1',
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

  it('createItem: choice — omits `title` entirely when the caller gives none', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 5,
      item: {
        interaction_type_slug: 'choice',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '<p>1</p>' },
          { id: 'b', item_body: '<p>2</p>' },
        ],
        correct_choice_id: 'a',
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect('title' in entry).toBe(false)
  })

  it('createItem: true-false — sends true_choice/false_choice and a boolean value', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'true-false',
        item_body: '<p>The sky is blue.</p>',
        correct_answer: true,
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 1,
      entry: {
        interaction_type_slug: 'true-false',
        item_body: '<p>The sky is blue.</p>',
        interaction_data: { true_choice: 'True', false_choice: 'False' },
        properties: {},
        scoring_data: { value: true },
        scoring_algorithm: 'Equivalence',
      },
    })
  })

  it('createItem: true-false — a false answer is the boolean false, not the string', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'true-false',
        item_body: '<p>Fish are mammals.</p>',
        correct_answer: false,
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data.value).toBe(false)
  })

  it('createItem: true-false — never sends the editor-incompatible `choices` shape', async () => {
    // Regression (#485): the old wire body sent `interaction_data.choices` and
    // the string "true", which Canvas stored but the New Quizzes editor could
    // not round-trip.
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: { interaction_type_slug: 'true-false', item_body: '<p>T</p>', correct_answer: true },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.interaction_data).not.toHaveProperty('choices')
    expect(entry.scoring_data.value).not.toBe('true')
  })

  it('createItem: essay — sends documented interaction_data and a string scoring value', async () => {
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
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 10,
      entry: {
        interaction_type_slug: 'essay',
        item_body: '<p>Describe the water cycle.</p>',
        interaction_data: {
          rce: true,
          essay: null,
          word_count: true,
          file_upload: false,
          spell_check: true,
          word_limit_enabled: true,
          word_limit_min: '50',
          word_limit_max: '300',
        },
        properties: {},
        // Regression (#485): Canvas answered `scoring_data: can't be blank` for
        // the old `scoring_data: {}`. `value` carries the grading notes.
        scoring_data: { value: '' },
        scoring_algorithm: 'None',
      },
    })
  })

  it('createItem: essay — no word limits means no word_limit_* keys and the flag off', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 10,
      item: {
        interaction_type_slug: 'essay',
        item_body: '<p>Discuss.</p>',
        rich_text: false,
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.interaction_data).toMatchObject({
      rce: false,
      word_count: false,
      word_limit_enabled: false,
    })
    expect(entry.interaction_data).not.toHaveProperty('word_limit_min')
    expect(entry.interaction_data).not.toHaveProperty('word_limit_max')
  })

  it('createItem: essay — never sends undocumented `properties` keys', async () => {
    // Regression (#485): Canvas answered
    // `properties contains keys not in schema ["word_count"]`.
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 10,
      item: {
        interaction_type_slug: 'essay',
        item_body: '<p>Discuss.</p>',
        rich_text: true,
        word_count_min: 50,
        word_count_max: 300,
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.properties).toEqual({})
  })

  it('createItem: matching — sends answers/questions, a value map and edit_data', async () => {
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
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body).toMatchObject({
      entry_type: 'Item',
      points_possible: 4,
      entry: {
        interaction_type_slug: 'matching',
        item_body: '<p>Match the capitals.</p>',
        interaction_data: {
          // Sorted and deduplicated: the answer pool must not reveal the key by
          // listing correct answers in question order.
          answers: ['Berlin', 'London', 'Paris'],
          questions: [
            { id: 'match_0', item_body: 'France' },
            { id: 'match_1', item_body: 'Germany' },
          ],
        },
        properties: { shuffle_rules: { questions: { shuffled: true } } },
        scoring_data: {
          value: { match_0: 'Paris', match_1: 'Berlin' },
          edit_data: {
            matches: [
              { answer_body: 'Paris', question_id: 'match_0', question_body: 'France' },
              { answer_body: 'Berlin', question_id: 'match_1', question_body: 'Germany' },
            ],
            distractors: ['London'],
          },
        },
        // Regression (#485): Canvas answered
        // `Value Equivalence not found in ["DeepEquals", "PartialDeep"]`.
        scoring_algorithm: 'PartialDeep',
      },
    })
  })

  it('createItem: matching — deduplicates distractors and drops ones equal to an answer', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 4,
      item: {
        interaction_type_slug: 'matching',
        item_body: '<p>Match.</p>',
        matches: [
          { question: 'a', answer: 'aa' },
          { question: 'b', answer: 'bb' },
        ],
        distractors: ['ff', 'ff', 'aa'],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.interaction_data.answers).toEqual(['aa', 'bb', 'ff'])
    expect(entry.scoring_data.edit_data.distractors).toEqual(['ff'])
  })

  it('createItem: matching — no distractors yields an empty distractor list', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 4,
      item: {
        interaction_type_slug: 'matching',
        item_body: '<p>Match.</p>',
        matches: [
          { question: 'a', answer: 'aa' },
          { question: 'b', answer: 'bb' },
        ],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data.edit_data.distractors).toEqual([])
    expect(entry.interaction_data).not.toHaveProperty('matches')
    expect(entry.interaction_data).not.toHaveProperty('responses')
  })

  it('createItem: numeric — sends every answer in Canvas’s Numeric shape', async () => {
    // The four-answers-in-one-item case from #485, confirmed stored as sent by
    // live Canvas on 2026-10-22.
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>How many?</p>',
        answers: [
          { kind: 'exact', value: 200 },
          { kind: 'exact', value: 200, margin: 3 },
          { kind: 'range', min: 190, max: 210 },
          { kind: 'precision', value: 200.0001, precision: 4 },
        ],
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body.entry).toMatchObject({
      interaction_type_slug: 'numeric',
      interaction_data: {},
      properties: {},
      scoring_data: {
        value: [
          { id: '1', type: 'exactResponse', value: '200' },
          { id: '2', type: 'marginOfError', value: '200', margin: '3', margin_type: 'absolute' },
          { id: '3', type: 'withinARange', start: '190', end: '210' },
          {
            id: '4',
            type: 'preciseResponse',
            value: '200.0001',
            precision: '4',
            precision_type: 'decimals',
          },
        ],
      },
      // Regression (#485): Canvas answered
      // `Value Exact not found in ["Numeric"]`.
      scoring_algorithm: 'Numeric',
    })
  })

  it('createItem: numeric — does not drop answers after the first', async () => {
    // Regression (#485): `numericToWire` used only `answers[0]`.
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>How many?</p>',
        answers: [
          { kind: 'exact', value: 1 },
          { kind: 'exact', value: 2 },
          { kind: 'exact', value: 3 },
        ],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data.value).toHaveLength(3)
    expect(entry.scoring_data.value.map((a: { value: string }) => a.value)).toEqual(['1', '2', '3'])
  })

  it('createItem: numeric — a zero margin stays an exactResponse', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>What is 2+2?</p>',
        answers: [{ kind: 'exact', value: 4, margin: 0 }],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data.value).toEqual([{ id: '1', type: 'exactResponse', value: '4' }])
  })

  it('createItem: numeric — pads a precise answer to at least `precision` decimals', async () => {
    // Canvas rejects a preciseResponse whose value carries fewer decimals than
    // its precision ("Must provide at least same number of decimals as
    // precision"), and `3.10` reaches us as the number 3.1.
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'numeric',
        item_body: '<p>Pi to 3 decimals?</p>',
        answers: [
          { kind: 'precision', value: 3.1, precision: 3 },
          { kind: 'precision', value: 3.14159, precision: 2 },
        ],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data.value[0].value).toBe('3.100')
    // More decimals than the precision is accepted by Canvas and preserved.
    expect(entry.scoring_data.value[1].value).toBe('3.14159')
  })

  it('createItem: numeric — never sends the legacy flat scoring keys', async () => {
    vi.spyOn(client, 'request').mockResolvedValue(makeItem())
    const answers = [
      [{ kind: 'exact' as const, value: 4, margin: 1 }],
      [{ kind: 'range' as const, min: 1, max: 2 }],
      [{ kind: 'precision' as const, value: 3.14, precision: 2 }],
    ]
    for (const a of answers) {
      await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 2,
        item: { interaction_type_slug: 'numeric', item_body: '<p>Q</p>', answers: a },
      })
    }
    for (const call of vi.mocked(client.request).mock.calls) {
      const entry = JSON.parse(call[1]!.body as string).item.entry
      expect(entry.scoring_data).not.toHaveProperty('exact_answer')
      expect(entry.scoring_data).not.toHaveProperty('margin')
      expect(entry.scoring_data).not.toHaveProperty('lower_bound')
      expect(entry.scoring_data).not.toHaveProperty('upper_bound')
      expect(entry.scoring_data).not.toHaveProperty('precision')
      expect(entry.scoring_algorithm).toBe('Numeric')
    }
  })

  it('createItem: numeric — throws when given no answers', async () => {
    vi.spyOn(client, 'request').mockResolvedValue(makeItem())
    await expect(
      mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 2,
        item: { interaction_type_slug: 'numeric', item_body: '<p>Q</p>', answers: [] },
      }),
    ).rejects.toThrow(/at least one answer/)
    expect(client.request).not.toHaveBeenCalled()
  })

  // --- Round trip against Canvas's documented stored shapes ---

  it('every item type round-trips: what we send is what Canvas stores and returns', async () => {
    // Canvas echoes the `entry` it stored. For each type, post the item, take
    // the exact `entry` we sent back as the stored item, and assert the fields
    // that decide how the item scores survive unchanged.
    const cases: Array<{ input: NewQuizItemInput; checks: (entry: WireEntry) => void }> = [
      {
        input: {
          interaction_type_slug: 'choice',
          title: 'T',
          item_body: '<p>Q</p>',
          choices: [
            { id: 'a', item_body: '<p>1</p>' },
            { id: 'b', item_body: '<p>2</p>' },
          ],
          correct_choice_id: 'b',
        },
        checks: (entry) => {
          expect(entry.title).toBe('T')
          expect(entry.scoring_data).toEqual({ value: 'b' })
        },
      },
      {
        input: { interaction_type_slug: 'true-false', item_body: '<p>Q</p>', correct_answer: true },
        checks: (entry) => {
          expect(entry.interaction_data).toEqual({ true_choice: 'True', false_choice: 'False' })
          expect(entry.scoring_data).toEqual({ value: true })
        },
      },
      {
        input: {
          interaction_type_slug: 'essay',
          item_body: '<p>Q</p>',
          word_count_min: 10,
          word_count_max: 20,
        },
        checks: (entry) => {
          expect(entry.interaction_data).toMatchObject({
            word_limit_enabled: true,
            word_limit_min: '10',
            word_limit_max: '20',
          })
          expect(entry.scoring_data).toEqual({ value: '' })
        },
      },
      {
        input: {
          interaction_type_slug: 'matching',
          item_body: '<p>Q</p>',
          matches: [
            { question: 'a', answer: 'aa' },
            { question: 'b', answer: 'bb' },
          ],
          distractors: ['cc'],
        },
        checks: (entry) => {
          expect(entry.interaction_data).toEqual({
            answers: ['aa', 'bb', 'cc'],
            questions: [
              { id: 'match_0', item_body: 'a' },
              { id: 'match_1', item_body: 'b' },
            ],
          })
          expect(entry.scoring_algorithm).toBe('PartialDeep')
        },
      },
      {
        input: {
          interaction_type_slug: 'numeric',
          item_body: '<p>Q</p>',
          answers: [
            { kind: 'range', min: 1, max: 2 },
            { kind: 'exact', value: 5 },
          ],
        },
        checks: (entry) => {
          expect(entry.scoring_algorithm).toBe('Numeric')
          expect(entry.scoring_data.value).toHaveLength(2)
        },
      },
    ]

    for (const { input, checks } of cases) {
      const requestSpy = vi.spyOn(client, 'request')
      requestSpy.mockReset()
      // POST: echo back the entry Canvas received, the way Canvas does.
      requestSpy.mockImplementation((_path, init) => {
        const sent = JSON.parse((init?.body as string) ?? '{}').item
        return Promise.resolve(makeItem({ entry: sent.entry }) as never)
      })
      const created = await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 1,
        item: input,
      })
      const stored = created.entry as unknown as WireEntry
      expect(stored.interaction_type_slug).toBe(input.interaction_type_slug)
      checks(stored)

      // GET: reading the stored item back changes nothing.
      requestSpy.mockReset()
      requestSpy.mockResolvedValueOnce(makeItem({ entry: stored }) as never)
      const fetched = await mod.getItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID)
      expect(fetched.entry).toEqual(stored)
    }
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
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body).toMatchObject({
      points_possible: 3,
      entry: { scoring_data: { value: false } },
    })
  })

  // Regression: item fields must be nested under `item`, not sent flat.
  it('createItem: sends the exact body nested under `item`', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      position: 2,
      points_possible: 1,
      item: { interaction_type_slug: 'true-false', item_body: '<p>T</p>', correct_answer: true },
    })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items`,
      {
        method: 'POST',
        body: JSON.stringify({
          item: {
            entry_type: 'Item',
            points_possible: 1,
            entry: {
              interaction_type_slug: 'true-false',
              item_body: '<p>T</p>',
              interaction_data: { true_choice: 'True', false_choice: 'False' },
              properties: {},
              scoring_data: { value: true },
              scoring_algorithm: 'Equivalence',
            },
            position: 2,
          },
        }),
      },
    )
  })
  it('updateItem: sends the exact body nested under `item`', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, {
      position: 4,
      points_possible: 3,
    })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}/items/${ITEM_ID}`,
      { method: 'PATCH', body: JSON.stringify({ item: { position: 4, points_possible: 3 } }) },
    )
  })

  it('item create/update never send item fields at the top level', async () => {
    vi.spyOn(client, 'request').mockResolvedValue(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: { interaction_type_slug: 'true-false', item_body: '<p>T</p>', correct_answer: true },
    })
    await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, { points_possible: 2 })
    for (const call of vi.mocked(client.request).mock.calls) {
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>
      expect(Object.keys(body)).toEqual(['item'])
    }
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
