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

  // --- quiz_settings (BRU-3212) ---

  it('nests quiz_settings under quiz on create, with every flat field sent', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeQuiz())
    await mod.create(COURSE_ID, {
      title: 'Timed quiz',
      quiz_settings: {
        calculator_type: 'scientific',
        one_at_a_time_type: 'question',
        allow_backtracking: false,
        shuffle_answers: true,
        shuffle_questions: true,
        require_student_access_code: true,
        student_access_code: 'secret',
        has_time_limit: true,
        session_time_limit_in_seconds: 1800,
      },
    })
    expect(client.request).toHaveBeenCalledWith(`/api/quiz/v1/courses/${COURSE_ID}/quizzes`, {
      method: 'POST',
      body: JSON.stringify({
        quiz: {
          title: 'Timed quiz',
          quiz_settings: {
            calculator_type: 'scientific',
            one_at_a_time_type: 'question',
            allow_backtracking: false,
            shuffle_answers: true,
            shuffle_questions: true,
            require_student_access_code: true,
            student_access_code: 'secret',
            has_time_limit: true,
            session_time_limit_in_seconds: 1800,
          },
        },
      }),
    })
  })

  it('sends multiple_attempts exactly as given on update, without fetching or merging prior values', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeQuiz())
    // Only two of the six multiple_attempts sub-fields are supplied; Canvas
    // treats this nested object as replaced whole, so the client must not add
    // the other four, read the quiz first, or otherwise fill them in.
    await mod.update(COURSE_ID, ASSIGNMENT_ID, {
      quiz_settings: {
        multiple_attempts: {
          multiple_attempts_enabled: true,
          max_attempts: 3,
        },
      },
    })
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          quiz: {
            quiz_settings: {
              multiple_attempts: { multiple_attempts_enabled: true, max_attempts: 3 },
            },
          },
        }),
      },
    )
  })

  it('passes multiple_attempts: null through to clear it', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeQuiz())
    await mod.update(COURSE_ID, ASSIGNMENT_ID, {
      quiz_settings: { multiple_attempts: null },
    })
    expect(client.request).toHaveBeenCalledWith(
      `/api/quiz/v1/courses/${COURSE_ID}/quizzes/${ASSIGNMENT_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ quiz: { quiz_settings: { multiple_attempts: null } } }),
      },
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

  it('createItem: multi-answer — sends choices, every correct id, and PartialScore', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 2,
      item: {
        interaction_type_slug: 'multi-answer',
        title: 'Primes',
        item_body: '<p>Which are prime?</p>',
        choices: [
          { id: 'a', item_body: '<p>2</p>' },
          { id: 'b', item_body: '<p>4</p>' },
          { id: 'c', item_body: '<p>5</p>' },
        ],
        correct_choice_ids: ['a', 'c'],
        scoring: 'partial',
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body).toEqual({
      entry_type: 'Item',
      points_possible: 2,
      entry: {
        interaction_type_slug: 'multi-answer',
        title: 'Primes',
        item_body: '<p>Which are prime?</p>',
        interaction_data: {
          choices: [
            { id: 'a', position: 1, item_body: '<p>2</p>' },
            { id: 'b', position: 2, item_body: '<p>4</p>' },
            { id: 'c', position: 3, item_body: '<p>5</p>' },
          ],
        },
        properties: { shuffle_rules: { choices: { shuffled: true } } },
        scoring_data: { value: ['a', 'c'] },
        scoring_algorithm: 'PartialScore',
      },
    })
  })

  it('createItem: multi-answer — all_or_nothing scoring sends AllOrNothing', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '<p>1</p>' },
          { id: 'b', item_body: '<p>2</p>' },
        ],
        correct_choice_ids: ['b'],
        scoring: 'all_or_nothing',
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_algorithm).toBe('AllOrNothing')
    expect(entry.scoring_data).toEqual({ value: ['b'] })
  })

  it('createItem: multi-answer — no scoring given means PartialScore and no title key', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '<p>1</p>' },
          { id: 'b', item_body: '<p>2</p>' },
        ],
        correct_choice_ids: ['a', 'b'],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_algorithm).toBe('PartialScore')
    expect('title' in entry).toBe(false)
  })

  it('createItem: multi-answer — a repeated correct id is sent once', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
      points_possible: 1,
      item: {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '<p>1</p>' },
          { id: 'b', item_body: '<p>2</p>' },
        ],
        correct_choice_ids: ['a', 'a'],
      },
    })
    const entry = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item.entry
    expect(entry.scoring_data).toEqual({ value: ['a'] })
  })

  it('createItem: multi-answer — throws on a correct id that is not a choice, before any request', async () => {
    const requestSpy = vi.spyOn(client, 'request')
    await expect(
      mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 1,
        item: {
          interaction_type_slug: 'multi-answer',
          item_body: '<p>Q</p>',
          choices: [
            { id: 'a', item_body: '<p>1</p>' },
            { id: 'b', item_body: '<p>2</p>' },
          ],
          correct_choice_ids: ['a', 'z'],
        },
      }),
    ).rejects.toThrow('not found: z')
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('updateItem: multi-answer — sends the same entry createItem would', async () => {
    vi.spyOn(client, 'request').mockResolvedValueOnce(makeItem())
    await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, {
      item: {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '<p>1</p>' },
          { id: 'b', item_body: '<p>2</p>' },
        ],
        correct_choice_ids: ['b'],
        scoring: 'all_or_nothing',
      },
    })
    const body = JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
    expect(body.entry).toMatchObject({
      interaction_type_slug: 'multi-answer',
      scoring_data: { value: ['b'] },
      scoring_algorithm: 'AllOrNothing',
    })
  })

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
          interaction_type_slug: 'multi-answer',
          item_body: '<p>Q</p>',
          choices: [
            { id: 'a', item_body: '<p>1</p>' },
            { id: 'b', item_body: '<p>2</p>' },
            { id: 'c', item_body: '<p>3</p>' },
          ],
          correct_choice_ids: ['a', 'c'],
          scoring: 'all_or_nothing',
        },
        checks: (entry) => {
          expect(entry.scoring_data).toEqual({ value: ['a', 'c'] })
          expect(entry.scoring_algorithm).toBe('AllOrNothing')
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

  // --- rich-fill-blank (BRU-3213) ---

  describe('createItem: rich-fill-blank', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

    async function entryFor(item: NewQuizItemInput): Promise<WireEntry> {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem() as never)
      await mod.createItem(COURSE_ID, ASSIGNMENT_ID, { points_possible: 1, item })
      return JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
        .entry as WireEntry
    }

    /** The blank ids Canvas sees, read off interaction_data in blank order. */
    function blankIds(entry: WireEntry): string[] {
      return (entry.interaction_data.blanks as Array<{ id: string }>).map((b) => b.id)
    }

    /** Every `id="blank_…"` marker in the emitted item_body, in body order. */
    function markers(entry: WireEntry): string[] {
      return [...entry.item_body.matchAll(/id="blank_([^"]+)"/g)].map((m) => m[1])
    }

    it('open-entry: one blank, no per-blank config, is TextCloseEnough on the backticked text', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>The capital of France is `Paris`.</p>',
        blanks: [{ answer_type: 'open_entry' }],
      })
      const [id] = blankIds(entry)
      expect(id).toMatch(UUID_RE)
      expect(entry.item_body).toBe(
        `<p>The capital of France is <span id="blank_${id}"></span>.</p>`,
      )
      expect(entry.interaction_data).toEqual({ blanks: [{ id, answer_type: 'openEntry' }] })
      expect(entry.properties).toEqual({
        shuffle_rules: { blanks: { children: { '0': { children: null } } } },
      })
      expect(entry.scoring_data).toEqual({
        value: [
          {
            id,
            scoring_data: {
              value: 'Paris',
              blank_text: 'Paris',
              ignore_case: true,
              edit_distance: 1,
            },
            scoring_algorithm: 'TextCloseEnough',
          },
        ],
        // Canvas's own working copy keeps the backticks (new_quiz_items.html).
        working_item_body: '<p>The capital of France is `Paris`.</p>',
      })
      expect(entry.scoring_algorithm).toBe('MultipleMethods')
    })

    it('open-entry: ignore_case and edit_distance are passed through', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`Mitochondria` make ATP.</p>',
        blanks: [{ answer_type: 'open_entry', ignore_case: false, edit_distance: 0 }],
      })
      const row = (entry.scoring_data.value as Array<{ scoring_data: Record<string, unknown> }>)[0]
      expect(row.scoring_data).toEqual({
        value: 'Mitochondria',
        blank_text: 'Mitochondria',
        ignore_case: false,
        edit_distance: 0,
      })
    })

    it('open-entry: several answers default to TextInChoices with the list as the value', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`Tulips` are pink.</p>',
        blanks: [{ answer_type: 'open_entry', answers: ['Tulips', 'Peonies'] }],
      })
      const [row] = entry.scoring_data.value as Array<Record<string, unknown>>
      expect(row.scoring_algorithm).toBe('TextInChoices')
      // blank_text stays the teacher-visible text; value holds every accepted answer.
      expect(row.scoring_data).toEqual({ value: ['Tulips', 'Peonies'], blank_text: 'Tulips' })
    })

    it.each([
      ['contains', 'TextContainsAnswer'],
      ['regex', 'TextRegex'],
      ['any_of', 'TextInChoices'],
      ['close_enough', 'TextCloseEnough'],
    ] as const)('open-entry: match %s maps to %s', async (match, algorithm) => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>and I `love` you</p>',
        blanks: [{ answer_type: 'open_entry', match }],
      })
      const [row] = entry.scoring_data.value as Array<Record<string, unknown>>
      expect(row.scoring_algorithm).toBe(algorithm)
      const data = row.scoring_data as Record<string, unknown>
      // Only TextInChoices carries a list; only TextCloseEnough carries the
      // closeness knobs.
      expect(data.value).toEqual(match === 'any_of' ? ['love'] : 'love')
      expect('edit_distance' in data).toBe(match === 'close_enough')
    })

    it('open-entry: answers override the value but never the teacher-visible blank_text', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>a three letter word: `you`</p>',
        blanks: [{ answer_type: 'open_entry', match: 'regex', answers: ['[a-z][a-z][a-z]'] }],
      })
      const [row] = entry.scoring_data.value as Array<Record<string, unknown>>
      expect(row.scoring_data).toEqual({ value: '[a-z][a-z][a-z]', blank_text: 'you' })
    })

    it('dropdown: emits positioned choices and scores the correct choice id under Equivalence', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>Tulips are `pink`.</p>',
        blanks: [{ answer_type: 'dropdown', choices: ['pink', 'yellow', 'green'] }],
      })
      const [id] = blankIds(entry)
      const blank = (entry.interaction_data.blanks as Array<Record<string, unknown>>)[0]
      const choices = blank.choices as Array<{ id: string; position: number; item_body: string }>
      expect(blank.answer_type).toBe('dropdown')
      expect(choices.map((c) => [c.position, c.item_body])).toEqual([
        [1, 'pink'],
        [2, 'yellow'],
        [3, 'green'],
      ])
      for (const c of choices) expect(c.id).toMatch(UUID_RE)
      const [row] = entry.scoring_data.value as Array<Record<string, unknown>>
      expect(row).toEqual({
        id,
        scoring_data: { value: choices[0].id, blank_text: 'pink' },
        scoring_algorithm: 'Equivalence',
      })
      // A dropdown's options are shuffled, like every other choice list here.
      expect(entry.properties).toEqual({
        shuffle_rules: {
          blanks: { children: { '0': { children: { choices: { shuffled: true } } } } },
        },
      })
    })

    it('word-bank: shares one pool, points the blank at its choice id, and keeps distractors', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>and I `love` you</p>',
        blanks: [{ answer_type: 'word_bank' }],
        word_bank_choices: ['hate', 'love', 'kinda like'],
        reuse_word_bank_choices: true,
      })
      const [id] = blankIds(entry)
      const interaction = entry.interaction_data as {
        blanks: Array<Record<string, unknown>>
        word_bank_choices: Array<{ id: string; item_body: string }>
        reuse_word_bank_choices: boolean
      }
      // Canvas documents `choices: null` on a wordbank blank — the pool is shared.
      expect(interaction.blanks[0]).toEqual({ id, answer_type: 'wordbank', choices: null })
      expect(interaction.word_bank_choices.map((w) => w.item_body)).toEqual([
        'hate',
        'love',
        'kinda like',
      ])
      expect(interaction.reuse_word_bank_choices).toBe(true)
      const love = interaction.word_bank_choices.find((w) => w.item_body === 'love')!
      expect(love.id).toMatch(UUID_RE)
      const [row] = entry.scoring_data.value as Array<Record<string, unknown>>
      expect(row).toEqual({
        id,
        scoring_data: { value: 'love', choice_id: love.id, blank_text: 'love' },
        scoring_algorithm: 'TextEquivalence',
      })
    })

    it('word-bank: reuse defaults to false', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`love`</p>',
        blanks: [{ answer_type: 'word_bank' }],
        word_bank_choices: ['love', 'hate'],
      })
      expect(
        (entry.interaction_data as { reuse_word_bank_choices: boolean }).reuse_word_bank_choices,
      ).toBe(false)
    })

    it('omits the word bank keys entirely when no blank uses one', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`Paris`</p>',
        blanks: [{ answer_type: 'open_entry' }],
      })
      expect('word_bank_choices' in entry.interaction_data).toBe(false)
      expect('reuse_word_bank_choices' in entry.interaction_data).toBe(false)
    })

    it('mixes all three blank modes in one item, in body order', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        title: 'Flowers',
        item_body: '<p>`Roses` are `red`, and I `love` you.</p>',
        blanks: [
          { answer_type: 'open_entry' },
          { answer_type: 'dropdown', choices: ['red', 'blue'] },
          { answer_type: 'word_bank' },
        ],
        word_bank_choices: ['love', 'hate'],
      })
      expect(entry.title).toBe('Flowers')
      const ids = blankIds(entry)
      expect(ids).toHaveLength(3)
      expect(
        (entry.interaction_data.blanks as Array<{ answer_type: string }>).map((b) => b.answer_type),
      ).toEqual(['openEntry', 'dropdown', 'wordbank'])
      expect(
        (entry.scoring_data.value as Array<{ scoring_algorithm: string }>).map(
          (r) => r.scoring_algorithm,
        ),
      ).toEqual(['TextCloseEnough', 'Equivalence', 'TextEquivalence'])
      // Only the two choice-backed blanks shuffle.
      expect(entry.properties).toEqual({
        shuffle_rules: {
          blanks: {
            children: {
              '0': { children: null },
              '1': { children: { choices: { shuffled: true } } },
              '2': { children: { choices: { shuffled: true } } },
            },
          },
        },
      })
      expect(entry.item_body).toBe(
        `<p><span id="blank_${ids[0]}"></span> are <span id="blank_${ids[1]}"></span>, and I <span id="blank_${ids[2]}"></span> you.</p>`,
      )
      expect(entry.scoring_data.working_item_body).toBe(
        '<p>`Roses` are `red`, and I `love` you.</p>',
      )
    })

    it('markers in item_body are exactly the blank ids, in order, and every id is a v4 UUID', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`a` `b` `c`</p>',
        blanks: [
          { answer_type: 'open_entry' },
          { answer_type: 'open_entry' },
          { answer_type: 'open_entry' },
        ],
      })
      const ids = blankIds(entry)
      // The pairing between a rendered blank and its scoring row is carried by
      // this id, so a mismatch here is the one failure Canvas cannot repair.
      expect(markers(entry)).toEqual(ids)
      expect(new Set(ids).size).toBe(3)
      for (const id of ids) expect(id).toMatch(UUID_RE)
      expect((entry.scoring_data.value as Array<{ id: string }>).map((r) => r.id)).toEqual(ids)
    })

    it('generates fresh ids on every call', async () => {
      const item: NewQuizItemInput = {
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`a`</p>',
        blanks: [{ answer_type: 'open_entry' }],
      }
      const first = blankIds(await entryFor(item))
      const second = blankIds(await entryFor(item))
      expect(first).not.toEqual(second)
    })

    it('leaves a backtick-free body alone — there is nothing to mark', async () => {
      await expect(
        mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
          points_possible: 1,
          item: {
            interaction_type_slug: 'rich-fill-blank',
            item_body: '<p>No blanks here.</p>',
            blanks: [{ answer_type: 'open_entry' }],
          },
        }),
      ).rejects.toThrow(/backtick/i)
    })

    it.each([
      [
        'a blank count that disagrees with the body',
        {
          item_body: '<p>`a` and `b`</p>',
          blanks: [{ answer_type: 'open_entry' as const }],
        },
        /marks 2 blank\(s\) but 1/,
      ],
      [
        'an unmatched backtick',
        {
          item_body: '<p>`a` and `b</p>',
          blanks: [{ answer_type: 'open_entry' as const }],
        },
        /unmatched backtick/i,
      ],
      [
        'an empty blank',
        {
          item_body: '<p>`` is empty</p>',
          blanks: [{ answer_type: 'open_entry' as const }],
        },
        /cannot be empty/i,
      ],
      [
        'a dropdown that does not list its own answer',
        {
          item_body: '<p>`pink`</p>',
          blanks: [{ answer_type: 'dropdown' as const, choices: ['red', 'blue'] }],
        },
        /must list its answer "pink"/,
      ],
      [
        'a dropdown with a repeated choice',
        {
          item_body: '<p>`pink`</p>',
          blanks: [{ answer_type: 'dropdown' as const, choices: ['pink', 'pink'] }],
        },
        /choices must be unique/i,
      ],
      [
        'a word-bank blank with no pool',
        {
          item_body: '<p>`love`</p>',
          blanks: [{ answer_type: 'word_bank' as const }],
        },
        /word_bank_choices/,
      ],
      [
        'a word-bank answer missing from the pool',
        {
          item_body: '<p>`love`</p>',
          blanks: [{ answer_type: 'word_bank' as const }],
          word_bank_choices: ['hate', 'kinda like'],
        },
        /must be one of word_bank_choices/,
      ],
      [
        'a pool with a repeated word',
        {
          item_body: '<p>`love`</p>',
          blanks: [{ answer_type: 'word_bank' as const }],
          word_bank_choices: ['love', 'love'],
        },
        /word_bank_choices must be unique/i,
      ],
      [
        'a pool no blank uses',
        {
          item_body: '<p>`Paris`</p>',
          blanks: [{ answer_type: 'open_entry' as const }],
          word_bank_choices: ['love'],
        },
        /no blank uses a word bank/i,
      ],
      [
        'several answers under a single-answer match',
        {
          item_body: '<p>`Tulips`</p>',
          blanks: [
            { answer_type: 'open_entry' as const, match: 'contains' as const, answers: ['a', 'b'] },
          ],
        },
        /use match "any_of"/,
      ],
      [
        'an empty answers list',
        {
          item_body: '<p>`Tulips`</p>',
          blanks: [{ answer_type: 'open_entry' as const, answers: [] }],
        },
        /at least one answer/i,
      ],
    ])('rejects %s', async (_name, partial, expected) => {
      await expect(
        mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
          points_possible: 1,
          item: { interaction_type_slug: 'rich-fill-blank', ...partial } as NewQuizItemInput,
        }),
      ).rejects.toThrow(expected)
    })

    it('round-trips: Canvas stores the three-mode item as sent, and a read back changes nothing', async () => {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      // POST: echo back the entry Canvas received, the way Canvas does.
      spy.mockImplementation((_path, init) => {
        const sent = JSON.parse((init?.body as string) ?? '{}').item
        return Promise.resolve(makeItem({ entry: sent.entry }) as never)
      })
      const created = await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 3,
        item: {
          interaction_type_slug: 'rich-fill-blank',
          item_body: '<p>`Roses` are `red`, and I `love` you.</p>',
          blanks: [
            { answer_type: 'open_entry', answers: ['Roses', 'Tulips'] },
            { answer_type: 'dropdown', choices: ['red', 'blue'] },
            { answer_type: 'word_bank' },
          ],
          word_bank_choices: ['love', 'hate'],
        },
      })
      const stored = created.entry as unknown as WireEntry
      expect(stored.interaction_type_slug).toBe('rich-fill-blank')
      expect(markers(stored)).toEqual(blankIds(stored))
      expect(stored.scoring_algorithm).toBe('MultipleMethods')

      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem({ entry: stored }) as never)
      const fetched = await mod.getItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID)
      expect(fetched.entry).toEqual(stored)
    })

    it('updateItem sends the same rich-fill-blank entry', async () => {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem() as never)
      await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, {
        item: {
          interaction_type_slug: 'rich-fill-blank',
          item_body: '<p>`Paris`</p>',
          blanks: [{ answer_type: 'open_entry' }],
        },
      })
      const call = vi.mocked(client.request).mock.calls[0]
      expect(call[1]!.method).toBe('PATCH')
      const entry = JSON.parse(call[1]!.body as string).item.entry as WireEntry
      expect(entry.interaction_type_slug).toBe('rich-fill-blank')
      expect(entry.scoring_algorithm).toBe('MultipleMethods')
      expect(markers(entry)).toEqual(blankIds(entry))
    })
  })

  // --- ordering (BRU-3214) ---

  describe('createItem: ordering', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

    async function entryFor(item: NewQuizItemInput): Promise<WireEntry> {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem() as never)
      await mod.createItem(COURSE_ID, ASSIGNMENT_ID, { points_possible: 1, item })
      return JSON.parse(vi.mocked(client.request).mock.calls[0][1]!.body as string).item
        .entry as WireEntry
    }

    it('sends choices keyed by their own id and the correct order under DeepEquals', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these from youngest to oldest.</p>',
        choices: ['ava', 'blake', 'skylar'],
      })
      const choices = entry.interaction_data.choices as Record<
        string,
        { id: string; item_body: string }
      >
      const ids = Object.keys(choices)
      expect(ids).toHaveLength(3)
      for (const id of ids) {
        expect(id).toMatch(UUID_RE)
        // Each entry is keyed by its own id.
        expect(choices[id]!.id).toBe(id)
      }
      // The choices map preserves no inherent order (it's an object), so the
      // correct sequence lives only in scoring_data.value, read off in input
      // order.
      const byText = Object.fromEntries(Object.values(choices).map((c) => [c.item_body, c.id]))
      expect(entry.scoring_data).toEqual({
        value: [byText.ava, byText.blake, byText.skylar],
      })
      expect(entry.scoring_algorithm).toBe('DeepEquals')
    })

    it('defaults properties: empty labels, shuffle_rules null, labels and paragraph off', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
      })
      expect(entry.properties).toEqual({
        top_label: '',
        bottom_label: '',
        shuffle_rules: null,
        include_labels: false,
        display_answers_paragraph: false,
      })
    })

    it('a given top_label or bottom_label turns include_labels on by default', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
        top_label: 'youngest',
        bottom_label: 'oldest',
      })
      expect(entry.properties).toEqual({
        top_label: 'youngest',
        bottom_label: 'oldest',
        shuffle_rules: null,
        include_labels: true,
        display_answers_paragraph: false,
      })
    })

    it('include_labels and display_answers_paragraph are passed through explicitly', async () => {
      const entry = await entryFor({
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
        top_label: 'youngest',
        include_labels: false,
        display_answers_paragraph: true,
      })
      expect(entry.properties).toMatchObject({
        include_labels: false,
        display_answers_paragraph: true,
      })
    })

    it('title is passed through when given, omitted otherwise', async () => {
      const withTitle = await entryFor({
        interaction_type_slug: 'ordering',
        title: 'Order by age',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
      })
      expect(withTitle.title).toBe('Order by age')

      const withoutTitle = await entryFor({
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
      })
      expect('title' in withoutTitle).toBe(false)
    })

    it('generates fresh ids on every call', async () => {
      const item: NewQuizItemInput = {
        interaction_type_slug: 'ordering',
        item_body: '<p>Order these.</p>',
        choices: ['one', 'two'],
      }
      const first = Object.keys(
        (await entryFor(item)).interaction_data.choices as Record<string, unknown>,
      )
      const second = Object.keys(
        (await entryFor(item)).interaction_data.choices as Record<string, unknown>,
      )
      expect(first).not.toEqual(second)
    })

    it('rejects fewer than 2 choices, before any request', async () => {
      await expect(
        mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
          points_possible: 1,
          item: {
            interaction_type_slug: 'ordering',
            item_body: '<p>Order these.</p>',
            choices: ['only-one'],
          },
        }),
      ).rejects.toThrow(/at least 2 entries/)
    })

    it('round-trips: Canvas stores the item as sent, and a read back changes nothing', async () => {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      spy.mockImplementation((_path, init) => {
        const sent = JSON.parse((init?.body as string) ?? '{}').item
        return Promise.resolve(makeItem({ entry: sent.entry }) as never)
      })
      const created = await mod.createItem(COURSE_ID, ASSIGNMENT_ID, {
        points_possible: 5,
        item: {
          interaction_type_slug: 'ordering',
          item_body: '<p>Order these from youngest to oldest.</p>',
          choices: ['ava', 'blake', 'skylar'],
          top_label: 'youngest',
          bottom_label: 'oldest',
        },
      })
      const stored = created.entry as unknown as WireEntry
      expect(stored.interaction_type_slug).toBe('ordering')
      expect(stored.scoring_algorithm).toBe('DeepEquals')
      const choiceIds = Object.keys(stored.interaction_data.choices as Record<string, unknown>)
      expect((stored.scoring_data.value as string[]).sort()).toEqual([...choiceIds].sort())

      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem({ entry: stored }) as never)
      const fetched = await mod.getItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID)
      expect(fetched.entry).toEqual(stored)
    })

    it('updateItem sends the same ordering entry', async () => {
      const spy = vi.spyOn(client, 'request')
      spy.mockReset()
      spy.mockResolvedValueOnce(makeItem() as never)
      await mod.updateItem(COURSE_ID, ASSIGNMENT_ID, ITEM_ID, {
        item: {
          interaction_type_slug: 'ordering',
          item_body: '<p>Order these.</p>',
          choices: ['one', 'two'],
        },
      })
      const call = vi.mocked(client.request).mock.calls[0]
      expect(call[1]!.method).toBe('PATCH')
      const entry = JSON.parse(call[1]!.body as string).item.entry as WireEntry
      expect(entry.interaction_type_slug).toBe('ordering')
      expect(entry.scoring_algorithm).toBe('DeepEquals')
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
