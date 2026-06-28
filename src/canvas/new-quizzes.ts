import { CanvasApiError, type CanvasHttpClient } from './client'
import type { CanvasNewQuiz, CanvasNewQuizAccommodation, CanvasNewQuizItem } from './types'

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

  async create(courseId: number, payload: NewQuizPayload): Promise<CanvasNewQuiz> {
    return this.client.request<CanvasNewQuiz>(`/api/quiz/v1/courses/${courseId}/quizzes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async update(
    courseId: number,
    assignmentId: number,
    patch: NewQuizPayload,
  ): Promise<CanvasNewQuiz> {
    return this.client.request<CanvasNewQuiz>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
  }

  async delete(courseId: number, assignmentId: number): Promise<void> {
    await this.client.request<void>(`/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}`, {
      method: 'DELETE',
    })
  }

  async listItems(courseId: number, assignmentId: number): Promise<CanvasNewQuizItem[]> {
    return this.client.paginate<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items`,
    )
  }

  async getItem(
    courseId: number,
    assignmentId: number,
    itemId: string,
  ): Promise<CanvasNewQuizItem> {
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
    )
  }

  async createItem(
    courseId: number,
    assignmentId: number,
    input: NewQuizItemCreatePayload,
  ): Promise<CanvasNewQuizItem> {
    const wireBody: Record<string, unknown> = {
      entry_type: 'Item',
      points_possible: input.points_possible,
      entry: this.toWireItem(input.item),
    }
    if (input.position !== undefined) wireBody.position = input.position
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items`,
      { method: 'POST', body: JSON.stringify(wireBody) },
    )
  }

  async updateItem(
    courseId: number,
    assignmentId: number,
    itemId: string,
    patch: NewQuizItemUpdatePayload,
  ): Promise<CanvasNewQuizItem> {
    const wireBody: Record<string, unknown> = {}
    if (patch.position !== undefined) wireBody.position = patch.position
    if (patch.points_possible !== undefined) wireBody.points_possible = patch.points_possible
    if (patch.item !== undefined) wireBody.entry = this.toWireItem(patch.item)
    return this.client.request<CanvasNewQuizItem>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify(wireBody) },
    )
  }

  async deleteItem(courseId: number, assignmentId: number, itemId: string): Promise<void> {
    await this.client.request<void>(
      `/api/quiz/v1/courses/${courseId}/quizzes/${assignmentId}/items/${itemId}`,
      { method: 'DELETE' },
    )
  }

  async setAccommodation(
    courseId: number,
    userId: number,
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
    courseId: number,
    assignmentId: number,
    userId: number,
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
    courseId: number,
    userId: number,
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

  private trueFalseToWire(item: TrueFalseItem): Record<string, unknown> {
    return {
      interaction_type_slug: 'true-false',
      item_body: item.item_body,
      interaction_data: {
        choices: [
          { id: 'true', position: 1, item_body: 'True' },
          { id: 'false', position: 2, item_body: 'False' },
        ],
      },
      properties: {},
      scoring_data: {
        value: item.correct_answer ? 'true' : 'false',
      },
      scoring_algorithm: 'Equivalence',
    }
  }

  private essayToWire(item: EssayItem): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    if (item.word_count_min !== undefined || item.word_count_max !== undefined) {
      const wc: Record<string, unknown> = {}
      if (item.word_count_min !== undefined) wc.min = item.word_count_min
      if (item.word_count_max !== undefined) wc.max = item.word_count_max
      properties.word_count = wc
    }
    return {
      interaction_type_slug: 'essay',
      item_body: item.item_body,
      interaction_data: {
        rce_enabled: item.rich_text !== false,
      },
      properties,
      scoring_data: {},
      scoring_algorithm: 'None',
    }
  }

  private matchingToWire(item: MatchingItem): Record<string, unknown> {
    const matches = item.matches.map((m, i) => ({
      id: `match_${i}`,
      item_body: m.question,
    }))
    const correctResponses = item.matches.map((m, i) => ({
      id: `resp_${i}`,
      item_body: m.answer,
    }))
    const distractorResponses = (item.distractors ?? []).map((d, i) => ({
      id: `dist_${i}`,
      item_body: d,
    }))
    const scoringValue = item.matches.map((_, i) => ({
      id: `match_${i}`,
      match_id: `resp_${i}`,
    }))
    return {
      interaction_type_slug: 'matching',
      item_body: item.item_body,
      interaction_data: {
        matches,
        responses: [...correctResponses, ...distractorResponses],
      },
      properties: {},
      scoring_data: {
        value: scoringValue,
      },
      scoring_algorithm: 'Equivalence',
    }
  }

  private numericToWire(item: NumericItem): Record<string, unknown> {
    const answers = item.answers
    const first = answers[0]
    if (first === undefined) {
      throw new Error('numeric item must have at least one answer')
    }
    let scoringData: Record<string, unknown>
    let scoringAlgorithm: string
    if (first.kind === 'exact') {
      scoringData = { exact_answer: first.value, margin: first.margin ?? 0 }
      scoringAlgorithm = 'Exact'
    } else if (first.kind === 'range') {
      scoringData = { lower_bound: first.min, upper_bound: first.max }
      scoringAlgorithm = 'Range'
    } else {
      scoringData = { exact_answer: first.value, precision: first.precision }
      scoringAlgorithm = 'Precision'
    }
    return {
      interaction_type_slug: 'numeric',
      item_body: item.item_body,
      interaction_data: {},
      properties: {},
      scoring_data: scoringData,
      scoring_algorithm: scoringAlgorithm,
    }
  }
}
