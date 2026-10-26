import { CanvasApiError, type CanvasHttpClient } from './client'
import type { CanvasNewQuiz, CanvasNewQuizAccommodation, CanvasNewQuizItem } from './types'
import type { CanvasId } from './id'

export interface NewQuizPayload {
  title?: string
  instructions?: string | null
  points_possible?: number
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
  published?: boolean
}

type ChoiceItem = {
  interaction_type_slug: 'choice'
  title?: string
  item_body: string
  choices: Array<{ id: string; item_body: string }>
  correct_choice_id: string
}

type TrueFalseItem = {
  interaction_type_slug: 'true-false'
  item_body: string
  correct_answer: boolean
}

type EssayItem = {
  interaction_type_slug: 'essay'
  item_body: string
  rich_text?: boolean
  word_count_min?: number
  word_count_max?: number
}

type MatchingItem = {
  interaction_type_slug: 'matching'
  item_body: string
  matches: Array<{ question: string; answer: string }>
  distractors?: string[]
}

type NumericAnswer =
  | { kind: 'exact'; value: number; margin?: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'precision'; value: number; precision: number }

type NumericItem = {
  interaction_type_slug: 'numeric'
  item_body: string
  answers: NumericAnswer[]
}

export type NewQuizItemInput = ChoiceItem | TrueFalseItem | EssayItem | MatchingItem | NumericItem

export interface NewQuizItemCreatePayload {
  position?: number
  points_possible: number
  item: NewQuizItemInput
}

export interface NewQuizItemUpdatePayload {
  position?: number
  points_possible?: number
  item?: NewQuizItemInput
}

export class NewQuizzesModule {
  constructor(private client: CanvasHttpClient) {}

  /**
   * The New Quizzes API expects quiz fields nested under a `quiz` key
   * (`quiz[title]`, `quiz[published]`, …), the same shape the Classic quizzes
   * endpoint uses. A flat body is rejected with `400 quiz is missing`.
   */
  async create(courseId: CanvasId, payload: NewQuizPayload): Promise<CanvasNewQuiz> {
    return this.client.request<CanvasNewQuiz>(`/api/quiz/v1/courses/${courseId}/quizzes`, {
      method: 'POST',
      body: JSON.stringify({ quiz: payload }),
    })
  }

  async update(
    courseId: CanvasId,
    assignmentId: CanvasId,
    patch: NewQuizPayload,
  ): Promise<CanvasNewQuiz> {
    return this.client.request<CanvasNewQuiz>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}`,
      { method: 'PATCH', body: JSON.stringify({ quiz: patch }) },
    )
  }

  async delete(courseId: CanvasId, assignmentId: CanvasId): Promise<void> {
    await this.client.request<void>(`/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}`, {
      method: 'DELETE',
    })
  }

  async listItems(courseId: CanvasId, assignmentId: CanvasId): Promise<CanvasNewQuizItem[]> {
    return this.client.paginate<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items`,
    )
  }

  async getItem(
    courseId: CanvasId,
    assignmentId: CanvasId,
    itemId: string,
  ): Promise<CanvasNewQuizItem> {
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
    )
  }

  /**
   * The New Quizzes Items API expects item fields nested under an `item` key
   * (`item[entry_type]`, `item[points_possible]`, `item[entry][...]`). Flat
   * fields would not be bound to the `item` parameter.
   */
  async createItem(
    courseId: CanvasId,
    assignmentId: CanvasId,
    input: NewQuizItemCreatePayload,
  ): Promise<CanvasNewQuizItem> {
    const wireItem: Record<string, unknown> = {
      entry_type: 'Item',
      points_possible: input.points_possible,
      entry: this.toWireItem(input.item),
    }
    if (input.position !== undefined) wireItem.position = input.position
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items`,
      { method: 'POST', body: JSON.stringify({ item: wireItem }) },
    )
  }

  async updateItem(
    courseId: CanvasId,
    assignmentId: CanvasId,
    itemId: string,
    patch: NewQuizItemUpdatePayload,
  ): Promise<CanvasNewQuizItem> {
    const wireItem: Record<string, unknown> = {}
    if (patch.position !== undefined) wireItem.position = patch.position
    if (patch.points_possible !== undefined) wireItem.points_possible = patch.points_possible
    if (patch.item !== undefined) wireItem.entry = this.toWireItem(patch.item)
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify({ item: wireItem }) },
    )
  }

  async deleteItem(courseId: CanvasId, assignmentId: CanvasId, itemId: string): Promise<void> {
    await this.client.request<void>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
      { method: 'DELETE' },
    )
  }

  async setAccommodation(
    courseId: CanvasId,
    userId: CanvasId,
    timeMultiplier?: number,
    extraAttempts?: number,
  ): Promise<CanvasNewQuizAccommodation> {
    const body: Record<string, unknown> = { user_id: userId }
    if (timeMultiplier !== undefined) body.time_multiplier = timeMultiplier
    if (extraAttempts !== undefined) body.extra_attempts = extraAttempts
    return this.client.request<CanvasNewQuizAccommodation>(
      `/api/quiz/v1/courses/${courseId}/accommodations`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  }

  async setQuizAccommodation(
    courseId: CanvasId,
    assignmentId: CanvasId,
    userId: CanvasId,
    timeMultiplier?: number,
    extraAttempts?: number,
  ): Promise<CanvasNewQuizAccommodation> {
    const body: Record<string, unknown> = { user_id: userId }
    if (timeMultiplier !== undefined) body.time_multiplier = timeMultiplier
    if (extraAttempts !== undefined) body.extra_attempts = extraAttempts
    return this.client.request<CanvasNewQuizAccommodation>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/accommodations`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  }

  async getAccommodation(
    courseId: CanvasId,
    userId: CanvasId,
  ): Promise<CanvasNewQuizAccommodation | null> {
    try {
      return await this.client.request<CanvasNewQuizAccommodation>(
        `/api/quiz/v1/courses/${courseId}/accommodations/${userId}`,
      )
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 404) return null
      throw err
    }
  }

  private toWireItem(item: NewQuizItemInput): Record<string, unknown> {
    switch (item.interaction_type_slug) {
      case 'choice':
        return this.choiceToWire(item)
      case 'true-false':
        return this.trueFalseToWire(item)
      case 'essay':
        return this.essayToWire(item)
      case 'matching':
        return this.matchingToWire(item)
      case 'numeric':
        return this.numericToWire(item)
    }
  }

  private choiceToWire(item: ChoiceItem): Record<string, unknown> {
    return {
      interaction_type_slug: 'choice',
      // Canvas documents the item heading as `item[entry][title]`.
      ...(item.title !== undefined ? { title: item.title } : {}),
      item_body: item.item_body,
      interaction_data: {
        choices: item.choices.map((c, i) => ({
          id: c.id,
          position: i + 1,
          item_body: c.item_body,
        })),
      },
      properties: {
        shuffle_rules: { choices: { shuffled: true } },
      },
      scoring_data: {
        value: item.correct_choice_id,
      },
      // Equivalence hard-coded per CTO direction; not exposed to callers
      scoring_algorithm: 'Equivalence',
    }
  }

  /**
   * Canvas stores true-false items as a pair of choice labels plus a boolean
   * answer. The older `interaction_data.choices` + string `"true"` body was
   * accepted by the API but is not the shape the New Quizzes editor reads.
   */
  private trueFalseToWire(item: TrueFalseItem): Record<string, unknown> {
    return {
      interaction_type_slug: 'true-false',
      item_body: item.item_body,
      interaction_data: {
        true_choice: 'True',
        false_choice: 'False',
      },
      properties: {},
      scoring_data: {
        value: item.correct_answer,
      },
      scoring_algorithm: 'Equivalence',
    }
  }

  /**
   * Word limits belong in `interaction_data`, not `properties`: Canvas rejects
   * an unknown `properties` key outright (`properties contains keys not in
   * schema ["word_count"]`), and `scoring_data.value` — the grading notes —
   * must be present or Canvas answers `scoring_data: can't be blank`.
   */
  private essayToWire(item: EssayItem): Record<string, unknown> {
    const hasMin = item.word_count_min !== undefined
    const hasMax = item.word_count_max !== undefined
    const limited = hasMin || hasMax
    const interactionData: Record<string, unknown> = {
      rce: item.rich_text !== false,
      essay: null,
      word_count: limited,
      // Canvas documents essay file upload as always false.
      file_upload: false,
      spell_check: true,
      word_limit_enabled: limited,
    }
    // Canvas treats the two bounds as a pair — "if enabled, max and min must be
    // set to word count values" — so a partial pair is an invalid item. The MCP
    // input schema rejects it (src/tools/new-quizzes.ts); library callers get
    // their input passed through unchanged to Canvas's own 422 rather than a
    // bound this client invented for them.
    if (hasMin) interactionData.word_limit_min = String(item.word_count_min)
    if (hasMax) interactionData.word_limit_max = String(item.word_count_max)
    return {
      interaction_type_slug: 'essay',
      item_body: item.item_body,
      interaction_data: interactionData,
      properties: {},
      scoring_data: { value: '' },
      scoring_algorithm: 'None',
    }
  }

  /**
   * Canvas keys a matching item by question: `interaction_data.questions` holds
   * the prompts, `interaction_data.answers` is the flat pool shown to the
   * student, `scoring_data.value` maps question id to the correct answer text,
   * and `scoring_data.edit_data` is what the editor reads back.
   *
   * The answer pool is sorted and deduplicated on purpose. Emitting it in
   * question order would hand the student the key, and a duplicate entry would
   * show the same option twice.
   */
  private matchingToWire(item: MatchingItem): Record<string, unknown> {
    const questions = item.matches.map((m, i) => ({
      id: `match_${i}`,
      item_body: m.question,
    }))
    const correctAnswers = item.matches.map((m) => m.answer)
    const distractors = [...new Set(item.distractors ?? [])].filter(
      (d) => !correctAnswers.includes(d),
    )
    const answers = [...new Set([...correctAnswers, ...distractors])].sort()
    const value: Record<string, string> = {}
    item.matches.forEach((m, i) => {
      value[`match_${i}`] = m.answer
    })
    return {
      interaction_type_slug: 'matching',
      item_body: item.item_body,
      interaction_data: {
        answers,
        questions,
      },
      properties: {
        shuffle_rules: { questions: { shuffled: true } },
      },
      scoring_data: {
        value,
        edit_data: {
          matches: item.matches.map((m, i) => ({
            answer_body: m.answer,
            question_id: `match_${i}`,
            question_body: m.question,
          })),
          distractors,
        },
      },
      // PartialDeep credits each correct pair; Canvas accepts only this or
      // DeepEquals, which is all-or-nothing.
      scoring_algorithm: 'PartialDeep',
    }
  }

  /**
   * Canvas takes every accepted numeric answer as one entry in
   * `scoring_data.value`, each tagged with its own response type, under the
   * single `Numeric` algorithm. The per-answer algorithms the older body used
   * (`Exact`, `Range`, `Precision`) do not exist.
   */
  private numericToWire(item: NumericItem): Record<string, unknown> {
    if (item.answers.length === 0) {
      throw new Error('numeric item must have at least one answer')
    }
    return {
      interaction_type_slug: 'numeric',
      item_body: item.item_body,
      interaction_data: {},
      properties: {},
      scoring_data: {
        value: item.answers.map((answer, i) => numericAnswerToWire(answer, String(i + 1))),
      },
      scoring_algorithm: 'Numeric',
    }
  }
}

/** Canvas carries numeric answer values as strings. */
function numericAnswerToWire(answer: NumericAnswer, id: string): Record<string, unknown> {
  switch (answer.kind) {
    case 'range':
      return {
        id,
        type: 'withinARange',
        start: String(answer.min),
        end: String(answer.max),
      }
    case 'precision':
      return {
        id,
        type: 'preciseResponse',
        value: withAtLeastDecimals(answer.value, answer.precision),
        precision: String(answer.precision),
        precision_type: 'decimals',
      }
    case 'exact':
      // A margin turns the answer into a tolerance band; Canvas has no
      // "exact with margin" response type.
      if (answer.margin !== undefined && answer.margin !== 0) {
        return {
          id,
          type: 'marginOfError',
          value: String(answer.value),
          margin: String(answer.margin),
          margin_type: 'absolute',
        }
      }
      return { id, type: 'exactResponse', value: String(answer.value) }
  }
}

/**
 * Canvas rejects a `preciseResponse` whose value carries fewer decimals than
 * its precision ("Must provide at least same number of decimals as
 * precision"). A caller writing 3.10 hands us the number 3.1, so pad it back
 * out; a value with more decimals than the precision is left alone.
 */
function withAtLeastDecimals(value: number, precision: number): string {
  const digits = Math.min(Math.max(Math.trunc(precision), 0), 100)
  const raw = String(value)
  const dot = raw.indexOf('.')
  const decimals = dot === -1 ? 0 : raw.length - dot - 1
  if (!raw.includes('e') && !raw.includes('E') && decimals >= digits) return raw
  return value.toFixed(digits)
}
