import { randomUUID } from 'node:crypto'
import { CanvasApiError, type CanvasHttpClient } from './client'
import type { CanvasNewQuiz, CanvasNewQuizAccommodation, CanvasNewQuizItem } from './types'
import type { CanvasId } from './id'

/**
 * Canvas replaces `multiple_attempts` as a whole object on every PATCH: a
 * caller who sends only `multiple_attempts_enabled` clears every other
 * sub-field (`max_attempts`, `score_to_keep`, …) rather than leaving them at
 * their current value. This client does not fetch-then-merge — it passes the
 * object through exactly as given, so a partial object really does mean a
 * partial replacement.
 */
export interface QuizSettingsMultipleAttempts {
  multiple_attempts_enabled?: boolean
  attempt_limit?: boolean
  max_attempts?: number
  score_to_keep?: 'average' | 'first' | 'highest' | 'latest'
  cooling_period?: boolean
  cooling_period_seconds?: number
}

/**
 * Scoped to the flat session settings plus `multiple_attempts`. IP-address
 * filtering (`filter_ip_address`, `filters`) and `result_view_settings` are
 * deliberately out of scope for this tool (BRU-3212) and are not accepted
 * here.
 */
export interface QuizSettingsPayload {
  calculator_type?: 'none' | 'basic' | 'scientific'
  one_at_a_time_type?: 'none' | 'question'
  allow_backtracking?: boolean
  shuffle_answers?: boolean
  shuffle_questions?: boolean
  require_student_access_code?: boolean
  student_access_code?: string
  has_time_limit?: boolean
  session_time_limit_in_seconds?: number
  multiple_attempts?: QuizSettingsMultipleAttempts | null
}

export interface NewQuizPayload {
  title?: string
  instructions?: string | null
  points_possible?: number
  due_at?: string | null
  unlock_at?: string | null
  lock_at?: string | null
  published?: boolean
  quiz_settings?: QuizSettingsPayload
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

type MultiAnswerItem = {
  interaction_type_slug: 'multi-answer'
  title?: string
  item_body: string
  choices: Array<{ id: string; item_body: string }>
  correct_choice_ids: string[]
  scoring?: 'partial' | 'all_or_nothing'
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

/**
 * How an open-entry blank is scored. Each value maps to one of the four
 * algorithms Canvas documents on an `openEntry` blank:
 * `close_enough` → TextCloseEnough, `contains` → TextContainsAnswer,
 * `any_of` → TextInChoices, `regex` → TextRegex.
 */
export type RichFillBlankMatch = 'close_enough' | 'contains' | 'any_of' | 'regex'

export type RichFillBlankBlank =
  | {
      answer_type: 'open_entry'
      /** Accepted answers. Defaults to the blank's own backticked text. */
      answers?: string[]
      match?: RichFillBlankMatch
      /** `close_enough` only. */
      ignore_case?: boolean
      /** `close_enough` only: Levenshtein distance still counted correct. */
      edit_distance?: number
    }
  | { answer_type: 'dropdown'; choices: string[] }
  | { answer_type: 'word_bank' }

/**
 * A fill-in-the-blank item. `item_body` is written with each blank's correct
 * answer wrapped in backticks — the same convention Canvas itself uses for
 * `scoring_data.working_item_body` — and `blanks` holds one entry per
 * backticked segment, in body order. The blank ids, the `<span id="blank_…">`
 * markers, the dropdown and word-bank choice ids and `working_item_body` are
 * all derived from that one source, so they cannot drift apart.
 */
type RichFillBlankItem = {
  interaction_type_slug: 'rich-fill-blank'
  title?: string
  item_body: string
  blanks: RichFillBlankBlank[]
  /** Shared pool for every `word_bank` blank; extra entries are distractors. */
  word_bank_choices?: string[]
  reuse_word_bank_choices?: boolean
}

export type NewQuizItemInput =
  | ChoiceItem
  | TrueFalseItem
  | EssayItem
  | MatchingItem
  | MultiAnswerItem
  | NumericItem
  | RichFillBlankItem

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
      case 'multi-answer':
        return this.multiAnswerToWire(item)
      case 'numeric':
        return this.numericToWire(item)
      case 'rich-fill-blank':
        return this.richFillBlankToWire(item)
    }
  }

  /**
   * Canvas keys a fill-in-the-blank item by blank id: each blank appears in
   * `interaction_data.blanks`, is positioned in `item_body` by a
   * `<span id="blank_<id>">` marker, and is scored by the matching row in
   * `scoring_data.value`. The teacher's working copy,
   * `scoring_data.working_item_body`, carries the same text with the answers
   * back in backticks.
   *
   * The item-level algorithm is always `MultipleMethods`; the real algorithm
   * sits on each blank's own row, because the three blank kinds are scored
   * differently (new_quiz_items.html, "Rich Fill In The Blank").
   */
  private richFillBlankToWire(item: RichFillBlankItem): Record<string, unknown> {
    const problem = richFillBlankProblem(item)
    if (problem !== null) throw new Error(problem)

    const { texts, render } = parseBlankBody(item.item_body)
    const blankIds = texts.map(() => randomUUID() as string)
    const wordBank = (item.word_bank_choices ?? []).map((word) => ({
      id: randomUUID() as string,
      item_body: word,
    }))

    const wireBlanks: Array<Record<string, unknown>> = []
    const scoringRows: Array<Record<string, unknown>> = []
    const shuffleChildren: Record<string, unknown> = {}

    item.blanks.forEach((blank, index) => {
      const id = blankIds[index]
      const blankText = texts[index]!
      // A dropdown or word bank shows a choice list, so its options are
      // shuffled, as everywhere else in this module. An open entry has no
      // list to shuffle.
      shuffleChildren[String(index)] =
        blank.answer_type === 'open_entry'
          ? { children: null }
          : { children: { choices: { shuffled: true } } }

      switch (blank.answer_type) {
        case 'open_entry': {
          const answers = blank.answers?.length ? blank.answers : [blankText]
          wireBlanks.push({ id, answer_type: 'openEntry' })
          scoringRows.push({
            id,
            scoring_data: openEntryScoringData(blank, answers, blankText),
            scoring_algorithm: OPEN_ENTRY_ALGORITHMS[openEntryMatch(blank, answers)],
          })
          break
        }
        case 'dropdown': {
          const choices = blank.choices.map((choice, position) => ({
            id: randomUUID() as string,
            position: position + 1,
            item_body: choice,
          }))
          const correct = choices.find((choice) => choice.item_body === blankText)!
          wireBlanks.push({ id, answer_type: 'dropdown', choices })
          scoringRows.push({
            id,
            // The answer is the chosen option's id, not its text.
            scoring_data: { value: correct.id, blank_text: blankText },
            scoring_algorithm: 'Equivalence',
          })
          break
        }
        case 'word_bank': {
          const correct = wordBank.find((word) => word.item_body === blankText)!
          // Canvas documents `choices: null` on a wordbank blank — the pool
          // lives once on `interaction_data.word_bank_choices`.
          wireBlanks.push({ id, answer_type: 'wordbank', choices: null })
          scoringRows.push({
            id,
            scoring_data: { value: blankText, choice_id: correct.id, blank_text: blankText },
            scoring_algorithm: 'TextEquivalence',
          })
          break
        }
      }
    })

    return {
      interaction_type_slug: 'rich-fill-blank',
      ...(item.title !== undefined ? { title: item.title } : {}),
      item_body: render(blankIds),
      interaction_data: {
        blanks: wireBlanks,
        ...(wordBank.length > 0
          ? {
              word_bank_choices: wordBank,
              reuse_word_bank_choices: item.reuse_word_bank_choices ?? false,
            }
          : {}),
      },
      properties: { shuffle_rules: { blanks: { children: shuffleChildren } } },
      scoring_data: { value: scoringRows, working_item_body: item.item_body },
      scoring_algorithm: 'MultipleMethods',
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
   * Canvas stores a select-all item as the same `choices` list a choice item
   * uses, with `scoring_data.value` holding every correct choice id. It accepts
   * only `PartialScore` (credit per choice) or `AllOrNothing` for this type.
   */
  private multiAnswerToWire(item: MultiAnswerItem): Record<string, unknown> {
    const choiceIds = new Set(item.choices.map((c) => c.id))
    const unknown = item.correct_choice_ids.filter((id) => !choiceIds.has(id))
    if (unknown.length > 0) {
      throw new Error(
        `multi-answer correct_choice_ids must be choice ids; not found: ${unknown.join(', ')}`,
      )
    }
    return {
      interaction_type_slug: 'multi-answer',
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
        value: [...new Set(item.correct_choice_ids)],
      },
      scoring_algorithm: item.scoring === 'all_or_nothing' ? 'AllOrNothing' : 'PartialScore',
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

const OPEN_ENTRY_ALGORITHMS: Record<RichFillBlankMatch, string> = {
  close_enough: 'TextCloseEnough',
  contains: 'TextContainsAnswer',
  any_of: 'TextInChoices',
  regex: 'TextRegex',
}

type OpenEntryBlank = Extract<RichFillBlankBlank, { answer_type: 'open_entry' }>

/** Several accepted answers only fit `TextInChoices`, so default to it. */
function openEntryMatch(blank: OpenEntryBlank, answers: string[]): RichFillBlankMatch {
  return blank.match ?? (answers.length > 1 ? 'any_of' : 'close_enough')
}

/**
 * `blank_text` is always the backticked text — what the teacher sees in the
 * working copy — even when the scored value is a regex or a list of accepted
 * answers (new_quiz_items.html shows `value: "[a-z][a-z][a-z]"` with
 * `blank_text: "you"`, and `value: ["Tulips", "Peonies"]` with
 * `blank_text: "Tulips"`).
 */
function openEntryScoringData(
  blank: OpenEntryBlank,
  answers: string[],
  blankText: string,
): Record<string, unknown> {
  const match = openEntryMatch(blank, answers)
  if (match === 'any_of') return { value: answers, blank_text: blankText }
  if (match === 'close_enough') {
    return {
      value: answers[0],
      blank_text: blankText,
      ignore_case: blank.ignore_case ?? true,
      // Canvas's own example uses 1; a caller wanting an exact match passes 0.
      edit_distance: blank.edit_distance ?? 1,
    }
  }
  return { value: answers[0], blank_text: blankText }
}

/**
 * Splits a backticked body into the blanks' texts plus a renderer that puts
 * the `<span id="blank_…">` markers back in their place.
 *
 * Throws on a body no mapping could rescue: no blank at all, an unmatched
 * backtick, or an empty blank. `richFillBlankProblem` surfaces the same
 * messages ahead of time so the MCP input schema can reject them.
 */
function parseBlankBody(body: string): { texts: string[]; render: (ids: string[]) => string } {
  const backticks = (body.match(/`/g) ?? []).length
  if (backticks === 0) {
    throw new Error(
      'rich-fill-blank item_body must mark every blank by wrapping its answer in backticks, ' +
        'e.g. "<p>The capital of France is `Paris`.</p>"',
    )
  }
  if (backticks % 2 !== 0) {
    throw new Error(
      'rich-fill-blank item_body has an unmatched backtick: every blank needs an opening and a closing one',
    )
  }
  const texts: string[] = []
  // One more literal part than there are blanks: the text before, between and
  // after them.
  const parts: string[] = []
  let cursor = 0
  const blank = /`([^`]*)`/g
  let found: RegExpExecArray | null
  while ((found = blank.exec(body)) !== null) {
    parts.push(body.slice(cursor, found.index))
    texts.push(found[1]!)
    cursor = found.index + found[0].length
  }
  parts.push(body.slice(cursor))
  if (texts.some((text) => text.trim() === '')) {
    throw new Error('rich-fill-blank blank text cannot be empty: ``')
  }
  return {
    texts,
    render: (ids) =>
      parts.reduce(
        (html, part, index) =>
          html + part + (index < ids.length ? `<span id="blank_${ids[index]}"></span>` : ''),
        '',
      ),
  }
}

/**
 * Every way a fill-in-the-blank item can be unbuildable, as one message, or
 * `null` when it is sound. Shared by the client (which throws it) and the MCP
 * input schema (which reports it as a validation issue), so a library caller
 * and a tool caller read the same sentence.
 */
export function richFillBlankProblem(item: {
  item_body: string
  blanks: RichFillBlankBlank[]
  word_bank_choices?: string[]
}): string | null {
  let texts: string[]
  try {
    texts = parseBlankBody(item.item_body).texts
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  if (texts.length !== item.blanks.length) {
    return `rich-fill-blank item_body marks ${texts.length} blank(s) but ${item.blanks.length} blank(s) were given; there must be one blank per backticked answer, in body order`
  }

  const pool = item.word_bank_choices ?? []
  if (new Set(pool).size !== pool.length) {
    return 'rich-fill-blank word_bank_choices must be unique'
  }
  const usesWordBank = item.blanks.some((blank) => blank.answer_type === 'word_bank')
  if (pool.length > 0 && !usesWordBank) {
    return 'rich-fill-blank word_bank_choices was given but no blank uses a word bank; set answer_type "word_bank" on the blanks that should draw from it'
  }
  if (usesWordBank && pool.length === 0) {
    return 'rich-fill-blank word_bank blanks need word_bank_choices: the pool of words students pick from'
  }

  for (const [index, blank] of item.blanks.entries()) {
    const blankText = texts[index]!
    const where = `rich-fill-blank blank ${index + 1} ("${blankText}")`
    switch (blank.answer_type) {
      case 'open_entry': {
        if (blank.answers !== undefined && blank.answers.length === 0) {
          return `${where} needs at least one answer, or omit answers to score the backticked text`
        }
        const answers = blank.answers?.length ? blank.answers : [blankText]
        if (blank.match !== undefined && blank.match !== 'any_of' && answers.length > 1) {
          return `${where} gives ${answers.length} answers but match "${blank.match}" scores a single answer; use match "any_of" to accept any of them`
        }
        break
      }
      case 'dropdown': {
        if (new Set(blank.choices).size !== blank.choices.length) {
          return `${where}: dropdown choices must be unique`
        }
        if (!blank.choices.includes(blankText)) {
          return `${where}: a dropdown must list its answer "${blankText}" among its choices, because the backticked text is the correct option`
        }
        break
      }
      case 'word_bank': {
        if (!pool.includes(blankText)) {
          return `${where}: a word_bank answer must be one of word_bank_choices`
        }
        break
      }
    }
  }
  return null
}
