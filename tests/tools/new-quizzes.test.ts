import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas'
import { formatError } from '../../src/tools'
import { newQuizTools } from '../../src/tools/new-quizzes'
import type { CanvasNewQuiz, CanvasNewQuizItem } from '../../src/canvas/types'

const mockQuiz: CanvasNewQuiz = {
  id: 42,
  title: 'Chapter 1 Quiz',
  instructions: null,
  points_possible: 10,
  due_at: null,
  unlock_at: null,
  lock_at: null,
  published: false,
  assignment_id: 42,
}

const mockItem: CanvasNewQuizItem = {
  id: 'item-1',
  position: 1,
  points_possible: 5,
  entry_type: 'Item',
  entry: { interaction_type_slug: 'choice' },
}

function buildMockCanvas(): CanvasClient {
  return {
    newQuizzes: {
      create: vi.fn().mockResolvedValue(mockQuiz),
      update: vi.fn().mockResolvedValue(mockQuiz),
      delete: vi.fn().mockResolvedValue(undefined),
      listItems: vi.fn().mockResolvedValue([mockItem]),
      getItem: vi.fn().mockResolvedValue(mockItem),
      createItem: vi.fn().mockResolvedValue(mockItem),
      updateItem: vi.fn().mockResolvedValue(mockItem),
      deleteItem: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as CanvasClient
}

describe('newQuizTools', () => {
  it('returns 8 tool definitions', () => {
    expect(newQuizTools(buildMockCanvas())).toHaveLength(8)
  })

  it('exports tools with correct names', () => {
    const names = newQuizTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'create_new_quiz',
      'update_new_quiz',
      'delete_new_quiz',
      'list_new_quiz_items',
      'get_new_quiz_item',
      'create_new_quiz_item',
      'update_new_quiz_item',
      'delete_new_quiz_item',
    ])
  })

  // ── Annotation assertions ───────────────────────────────────────────────────

  describe('annotations', () => {
    it('list_new_quiz_items has readOnlyHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'list_new_quiz_items')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('get_new_quiz_item has readOnlyHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'get_new_quiz_item')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('create_new_quiz has destructiveHint + openWorldHint (no idempotentHint)', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'create_new_quiz')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('create_new_quiz_item has destructiveHint + openWorldHint (no idempotentHint)', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'create_new_quiz_item')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('update_new_quiz has destructiveHint + idempotentHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'update_new_quiz')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('update_new_quiz_item has destructiveHint + idempotentHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'update_new_quiz_item')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delete_new_quiz has destructiveHint + idempotentHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'delete_new_quiz')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delete_new_quiz_item has destructiveHint + idempotentHint + openWorldHint', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'delete_new_quiz_item')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })
  })

  // ── Description quality (BRU-3117) ──────────────────────────────────────────

  describe('description quality (BRU-3117)', () => {
    // Guards against the four Glama-flagged tools, plus create_new_quiz's
    // fixed create_quiz reference, regressing to a one-line CRUD restatement.
    // Semantic checks only, no brittle full-prose snapshots. The mechanical
    // floor is also enforced by the description-quality.test.ts CI ratchet
    // now that these five are no longer in the baseline.
    const REWRITTEN_WRITE_TOOLS = new Set([
      'create_new_quiz',
      'update_new_quiz',
      'create_new_quiz_item',
      'update_new_quiz_item',
      'delete_new_quiz_item',
    ])
    const REWRITTEN_READ_TOOLS = new Set(['list_new_quiz_items', 'get_new_quiz_item'])
    // Classic Quiz siblings create_new_quiz legitimately routes to (checking
    // for an already-created quiz by title before retrying), registered in
    // src/tools/quizzes.ts rather than this file.
    const CLASSIC_QUIZ_SIBLINGS = new Set(['list_quizzes', 'get_quiz', 'delete_quiz'])
    // New Quiz assignment_id discovery siblings (BRU-3118): list_assignments /
    // get_assignment, filtered on is_quiz_lti_assignment, registered in
    // src/tools/assignments.ts rather than this file. Classic quizzes.next
    // stub rows carry no usable assignment_id — see
    // docs/superpowers/specs/2026-07-01-issue-227-quiz-link-audit.md.
    const ASSIGNMENT_ID_SIBLINGS = new Set(['list_assignments', 'get_assignment'])

    it.each([...REWRITTEN_WRITE_TOOLS, ...REWRITTEN_READ_TOOLS])(
      '%s names a registered sibling tool and clears the length floor',
      (name) => {
        const tools = newQuizTools(buildMockCanvas())
        const names = new Set([
          ...tools.map((t) => t.name),
          ...CLASSIC_QUIZ_SIBLINGS,
          ...ASSIGNMENT_ID_SIBLINGS,
        ])
        const tool = tools.find((t) => t.name === name)!
        const minLen = REWRITTEN_WRITE_TOOLS.has(name) ? 200 : 150
        expect(tool.description.length).toBeGreaterThanOrEqual(minLen)
        const mentionsSibling = [...names].some(
          (sibling) => sibling !== name && tool.description.includes(sibling),
        )
        expect(mentionsSibling).toBe(true)
      },
    )

    it.each([
      'update_new_quiz',
      'list_new_quiz_items',
      'get_new_quiz_item',
      'create_new_quiz_item',
      'update_new_quiz_item',
      'delete_new_quiz_item',
    ])(
      '%s routes assignment_id discovery through list_assignments/get_assignment ' +
        '(filtered on is_quiz_lti_assignment), not list_quizzes/get_quiz (BRU-3118)',
      (name) => {
        const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === name)!
        expect(tool.description).toMatch(/list_assignments|get_assignment/)
        expect(tool.description).toMatch(/is_quiz_lti_assignment/)
        expect(tool.description).not.toMatch(/\blist_quizzes\b/)
        expect(tool.description).not.toMatch(/\bget_quiz\b/)
      },
    )

    it('list_new_quiz_items states pagination behavior', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'list_new_quiz_items')!
      expect(tool.description).toMatch(/every page|pagin|truncat/i)
    })

    it('write tools state their return value and required permission', () => {
      const tools = newQuizTools(buildMockCanvas())
      for (const name of REWRITTEN_WRITE_TOOLS) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.description).toMatch(/\breturns?\b/i)
        expect(tool.description).toMatch(/requires?|permission/i)
      }
    })

    it('create_new_quiz and update_new_quiz make assignment_id vs Classic Quiz ID explicit', () => {
      const tools = newQuizTools(buildMockCanvas())
      for (const name of ['create_new_quiz', 'update_new_quiz']) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.description).toMatch(/assignment_id/)
      }
    })

    it('create_new_quiz never names the unregistered create_quiz tool', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'create_new_quiz')!
      expect(tool.description).not.toMatch(/\bcreate_quiz\b/)
    })
  })

  // ── Handler delegation ──────────────────────────────────────────────────────

  describe('create_new_quiz', () => {
    it('delegates to canvas.newQuizzes.create', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz')!
      const result = await tool.handler({ course_id: '1', title: 'Quiz 1' })
      expect(canvas.newQuizzes.create).toHaveBeenCalledWith('1', {
        title: 'Quiz 1',
        instructions: undefined,
        points_possible: undefined,
        due_at: undefined,
        unlock_at: undefined,
        lock_at: undefined,
        published: undefined,
        quiz_settings: undefined,
      })
      expect(result).toEqual(mockQuiz)
    })

    it('passes quiz_settings through to canvas.newQuizzes.create unchanged', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz')!
      const quizSettings = {
        calculator_type: 'scientific' as const,
        shuffle_questions: true,
        multiple_attempts: { multiple_attempts_enabled: true, max_attempts: 2 },
      }
      await tool.handler({ course_id: '1', title: 'Quiz 1', quiz_settings: quizSettings })
      expect(canvas.newQuizzes.create).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ quiz_settings: quizSettings }),
      )
    })
  })

  describe('update_new_quiz', () => {
    it('delegates to canvas.newQuizzes.update', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'update_new_quiz')!
      await tool.handler({ course_id: '1', assignment_id: '42', title: 'Updated' })
      expect(canvas.newQuizzes.update).toHaveBeenCalledWith('1', '42', {
        title: 'Updated',
        instructions: undefined,
        points_possible: undefined,
        due_at: undefined,
        unlock_at: undefined,
        lock_at: undefined,
        published: undefined,
        quiz_settings: undefined,
      })
    })

    it('passes a partial multiple_attempts object through unchanged (Canvas replaces it whole)', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'update_new_quiz')!
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        quiz_settings: { multiple_attempts: { max_attempts: 5 } },
      })
      expect(canvas.newQuizzes.update).toHaveBeenCalledWith(
        '1',
        '42',
        expect.objectContaining({
          quiz_settings: { multiple_attempts: { max_attempts: 5 } },
        }),
      )
    })
  })

  describe('quiz_settings schema (BRU-3212)', () => {
    const QUIZ_SETTINGS_TOOLS = ['create_new_quiz', 'update_new_quiz'] as const

    function quizSettingsSchema(toolName: string) {
      return newQuizTools(buildMockCanvas()).find((t) => t.name === toolName)!.inputSchema
        .quiz_settings
    }

    for (const toolName of QUIZ_SETTINGS_TOOLS) {
      it(`${toolName}: accepts every flat field plus multiple_attempts`, () => {
        const result = quizSettingsSchema(toolName)!.safeParse({
          calculator_type: 'basic',
          one_at_a_time_type: 'question',
          allow_backtracking: true,
          shuffle_answers: true,
          shuffle_questions: true,
          require_student_access_code: true,
          student_access_code: 'abc123',
          has_time_limit: true,
          session_time_limit_in_seconds: 600,
          multiple_attempts: {
            multiple_attempts_enabled: true,
            attempt_limit: true,
            max_attempts: 3,
            score_to_keep: 'highest',
            cooling_period: true,
            cooling_period_seconds: 300,
          },
        })
        expect(result.success).toBe(true)
      })

      it(`${toolName}: accepts an empty object and a null multiple_attempts`, () => {
        expect(quizSettingsSchema(toolName)!.safeParse({}).success).toBe(true)
        expect(quizSettingsSchema(toolName)!.safeParse({ multiple_attempts: null }).success).toBe(
          true,
        )
      })

      it(`${toolName}: strips result_view_settings and IP-filter fields rather than forwarding them`, () => {
        const result = quizSettingsSchema(toolName)!.safeParse({
          calculator_type: 'none',
          filter_ip_address: true,
          filters: { ips: [['1.2.3.4', '1.2.3.9']] },
          result_view_settings: { result_view_restricted: true },
        })
        expect(result.success).toBe(true)
        expect(result.data).toEqual({ calculator_type: 'none' })
      })

      it(`${toolName}: rejects an unknown calculator_type value`, () => {
        const result = quizSettingsSchema(toolName)!.safeParse({ calculator_type: 'graphing' })
        expect(result.success).toBe(false)
      })
    }
  })

  describe('delete_new_quiz', () => {
    it('delegates to canvas.newQuizzes.delete and returns success', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'delete_new_quiz')!
      const result = await tool.handler({ course_id: '1', assignment_id: '42' })
      expect(canvas.newQuizzes.delete).toHaveBeenCalledWith('1', '42')
      expect(result).toEqual({ success: true })
    })
  })

  describe('list_new_quiz_items', () => {
    it('delegates to canvas.newQuizzes.listItems', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'list_new_quiz_items')!
      const result = await tool.handler({ course_id: '1', assignment_id: '42' })
      expect(canvas.newQuizzes.listItems).toHaveBeenCalledWith('1', '42')
      expect(result).toEqual([mockItem])
    })
  })

  describe('get_new_quiz_item', () => {
    it('delegates to canvas.newQuizzes.getItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'get_new_quiz_item')!
      const result = await tool.handler({ course_id: '1', assignment_id: '42', item_id: 'item-1' })
      expect(canvas.newQuizzes.getItem).toHaveBeenCalledWith('1', '42', 'item-1')
      expect(result).toEqual(mockItem)
    })
  })

  describe('delete_new_quiz_item', () => {
    it('delegates to canvas.newQuizzes.deleteItem and returns success', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'delete_new_quiz_item')!
      const result = await tool.handler({ course_id: '1', assignment_id: '42', item_id: 'item-1' })
      expect(canvas.newQuizzes.deleteItem).toHaveBeenCalledWith('1', '42', 'item-1')
      expect(result).toEqual({ success: true })
    })
  })

  // ── Per-type create_new_quiz_item input → canvas.newQuizzes.createItem ──────

  describe('create_new_quiz_item — per-type input', () => {
    it('passes choice item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const choiceItem = {
        interaction_type_slug: 'choice',
        item_body: '<p>What is 2+2?</p>',
        choices: [
          { id: 'a', item_body: '3' },
          { id: 'b', item_body: '4' },
        ],
        correct_choice_id: 'b',
      }
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        points_possible: 5,
        item: choiceItem,
      })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 5,
        position: undefined,
        item: choiceItem,
      })
    })

    it('passes true-false item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const tfItem = {
        interaction_type_slug: 'true-false',
        item_body: '<p>The sky is blue.</p>',
        correct_answer: true,
      }
      await tool.handler({ course_id: '1', assignment_id: '42', points_possible: 1, item: tfItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 1,
        position: undefined,
        item: tfItem,
      })
    })

    it('passes essay item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const essayItem = {
        interaction_type_slug: 'essay',
        item_body: '<p>Explain photosynthesis.</p>',
        rich_text: true,
      }
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        points_possible: 10,
        item: essayItem,
      })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 10,
        position: undefined,
        item: essayItem,
      })
    })

    it('passes matching item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const matchItem = {
        interaction_type_slug: 'matching',
        item_body: '<p>Match the capitals.</p>',
        matches: [
          { question: 'France', answer: 'Paris' },
          { question: 'Germany', answer: 'Berlin' },
        ],
      }
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        points_possible: 4,
        item: matchItem,
      })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 4,
        position: undefined,
        item: matchItem,
      })
    })

    it('passes multi-answer item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const maItem = {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Which are prime?</p>',
        choices: [
          { id: 'a', item_body: '<p>2</p>' },
          { id: 'b', item_body: '<p>4</p>' },
        ],
        correct_choice_ids: ['a'],
        scoring: 'all_or_nothing',
      }
      await tool.handler({ course_id: '1', assignment_id: '42', points_possible: 1, item: maItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 1,
        position: undefined,
        item: maItem,
      })
    })

    it('passes numeric item to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const numItem = {
        interaction_type_slug: 'numeric',
        item_body: '<p>What is π to 2 decimal places?</p>',
        answers: [{ kind: 'exact', value: 3.14, margin: 0 }],
      }
      await tool.handler({ course_id: '1', assignment_id: '42', points_possible: 2, item: numItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 2,
        position: undefined,
        item: numItem,
      })
    })

    it('forwards optional position', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const item = {
        interaction_type_slug: 'true-false',
        item_body: '<p>True or false?</p>',
        correct_answer: false,
      }
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        points_possible: 1,
        position: 3,
        item,
      })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith('1', '42', {
        points_possible: 1,
        position: 3,
        item,
      })
    })
  })

  describe('item title accepted across every type (BRU-3258)', () => {
    // Regression: `title` was accepted by the tool schema for only 4 of the 8
    // types (choice, multi-answer, rich-fill-blank, ordering) — Zod silently
    // strips unknown keys, so a title on the other four never reached Canvas.
    // Parse the real input schema per type, the same way the bug was found.
    const itemSchema = newQuizTools(buildMockCanvas()).find(
      (t) => t.name === 'create_new_quiz_item',
    )!.inputSchema.item

    const minimalByType: Record<string, Record<string, unknown>> = {
      choice: {
        interaction_type_slug: 'choice',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '1' },
          { id: 'b', item_body: '2' },
        ],
        correct_choice_id: 'a',
      },
      'true-false': {
        interaction_type_slug: 'true-false',
        item_body: '<p>Q</p>',
        correct_answer: true,
      },
      essay: { interaction_type_slug: 'essay', item_body: '<p>Q</p>' },
      matching: {
        interaction_type_slug: 'matching',
        item_body: '<p>Q</p>',
        matches: [
          { question: 'a', answer: 'aa' },
          { question: 'b', answer: 'bb' },
        ],
      },
      'multi-answer': {
        interaction_type_slug: 'multi-answer',
        item_body: '<p>Q</p>',
        choices: [
          { id: 'a', item_body: '1' },
          { id: 'b', item_body: '2' },
        ],
        correct_choice_ids: ['a'],
      },
      numeric: {
        interaction_type_slug: 'numeric',
        item_body: '<p>Q</p>',
        answers: [{ kind: 'exact', value: 1 }],
      },
      'rich-fill-blank': {
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`Paris`</p>',
        blanks: [{ answer_type: 'open_entry' }],
      },
      ordering: {
        interaction_type_slug: 'ordering',
        item_body: '<p>Q</p>',
        choices: ['one', 'two'],
      },
    }

    it.each(Object.entries(minimalByType))('keeps title on %s', (_slug, payload) => {
      const parsed = itemSchema.parse({ ...payload, title: 'MY TITLE' }) as { title?: string }
      expect(parsed.title).toBe('MY TITLE')
    })
  })

  describe('update_new_quiz_item', () => {
    it('delegates with item when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'update_new_quiz_item')!
      const item = {
        interaction_type_slug: 'essay',
        item_body: '<p>Updated question.</p>',
        rich_text: false,
      }
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        item_id: 'item-1',
        points_possible: 8,
        item,
      })
      expect(canvas.newQuizzes.updateItem).toHaveBeenCalledWith('1', '42', 'item-1', {
        points_possible: 8,
        position: undefined,
        item,
      })
    })

    it('delegates without item (points/position only)', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'update_new_quiz_item')!
      await tool.handler({
        course_id: '1',
        assignment_id: '42',
        item_id: 'item-1',
        points_possible: 3,
      })
      expect(canvas.newQuizzes.updateItem).toHaveBeenCalledWith('1', '42', 'item-1', {
        points_possible: 3,
        position: undefined,
        item: undefined,
      })
    })
  })

  // ── Essay word limits are an all-or-nothing pair ────────────────────────────

  describe('essay word-limit bounds', () => {
    // Canvas: "if enabled, max and min must be set to word count values"
    // (new_quiz_items.html). An item carrying `word_limit_enabled: true` with
    // one bound 422s, so the input schema rejects the partial pair before the
    // request is built. Both item-writing tools share one `item` union, so both
    // are asserted here.
    const ITEM_TOOLS = ['create_new_quiz_item', 'update_new_quiz_item'] as const

    function itemSchema(toolName: string) {
      return newQuizTools(buildMockCanvas()).find((t) => t.name === toolName)!.inputSchema.item
    }

    const essay = (bounds: Record<string, number>) => ({
      interaction_type_slug: 'essay',
      item_body: '<p>Discuss.</p>',
      rich_text: true,
      ...bounds,
    })

    for (const toolName of ITEM_TOOLS) {
      it(`${toolName}: rejects word_count_min without word_count_max`, () => {
        const result = itemSchema(toolName).safeParse(essay({ word_count_min: 100 }))
        expect(result.success).toBe(false)
        expect(result.error!.issues[0].message).toContain(
          'word_count_min and word_count_max must be set together',
        )
      })

      it(`${toolName}: rejects word_count_max without word_count_min`, () => {
        const result = itemSchema(toolName).safeParse(essay({ word_count_max: 300 }))
        expect(result.success).toBe(false)
        expect(result.error!.issues[0].message).toContain(
          'word_count_min and word_count_max must be set together',
        )
      })

      it(`${toolName}: accepts both bounds, and neither`, () => {
        expect(
          itemSchema(toolName).safeParse(essay({ word_count_min: 50, word_count_max: 300 }))
            .success,
        ).toBe(true)
        expect(itemSchema(toolName).safeParse(essay({})).success).toBe(true)
      })

      it(`${toolName}: the pairing check does not reach other item types`, () => {
        expect(
          itemSchema(toolName).safeParse({
            interaction_type_slug: 'true-false',
            item_body: '<p>T</p>',
            correct_answer: true,
          }).success,
        ).toBe(true)
      })
    }

    it('update_new_quiz_item: item stays optional', () => {
      expect(itemSchema('update_new_quiz_item').safeParse(undefined).success).toBe(true)
    })
  })

  describe('multi-answer choice ids', () => {
    // A correct id that names no choice would make a question nobody can
    // answer correctly, and duplicate choice ids make the answer ambiguous, so
    // the shared item schema rejects both before a request is built.
    const ITEM_TOOLS = ['create_new_quiz_item', 'update_new_quiz_item'] as const

    function itemSchema(toolName: string) {
      return newQuizTools(buildMockCanvas()).find((t) => t.name === toolName)!.inputSchema.item
    }

    const multi = (choiceIds: string[], correct: string[], extra: object = {}) => ({
      interaction_type_slug: 'multi-answer',
      item_body: '<p>Pick all.</p>',
      choices: choiceIds.map((id) => ({ id, item_body: `<p>${id}</p>` })),
      correct_choice_ids: correct,
      ...extra,
    })

    for (const toolName of ITEM_TOOLS) {
      it(`${toolName}: rejects a correct id that is not a choice id`, () => {
        const result = itemSchema(toolName).safeParse(multi(['a', 'b'], ['a', 'z']))
        expect(result.success).toBe(false)
        expect(result.error!.issues[0].message).toContain(
          'correct_choice_ids must each match the id of one of the choices',
        )
      })

      it(`${toolName}: rejects duplicate choice ids`, () => {
        const result = itemSchema(toolName).safeParse(multi(['a', 'a'], ['a']))
        expect(result.success).toBe(false)
        expect(result.error!.issues[0].message).toContain('choice ids must be unique')
      })

      it(`${toolName}: rejects an empty correct set and an unknown scoring mode`, () => {
        expect(itemSchema(toolName).safeParse(multi(['a', 'b'], [])).success).toBe(false)
        expect(
          itemSchema(toolName).safeParse(multi(['a', 'b'], ['a'], { scoring: 'some' })).success,
        ).toBe(false)
      })

      it(`${toolName}: accepts both scoring modes, and none`, () => {
        for (const scoring of ['partial', 'all_or_nothing', undefined]) {
          expect(
            itemSchema(toolName).safeParse(
              multi(['a', 'b', 'c'], ['a', 'c'], scoring ? { scoring } : {}),
            ).success,
          ).toBe(true)
        }
      })
    }
  })

  describe('rich-fill-blank schema (BRU-3213)', () => {
    const ITEM_TOOLS = ['create_new_quiz_item', 'update_new_quiz_item'] as const

    function itemSchema(toolName: string) {
      return newQuizTools(buildMockCanvas()).find((t) => t.name === toolName)!.inputSchema.item
    }

    const fill = (over: object = {}) => ({
      interaction_type_slug: 'rich-fill-blank',
      item_body: '<p>The capital of France is `Paris`.</p>',
      blanks: [{ answer_type: 'open_entry' }],
      ...over,
    })

    for (const toolName of ITEM_TOOLS) {
      it(`${toolName}: accepts the three blank modes in one item`, () => {
        const result = itemSchema(toolName).safeParse(
          fill({
            item_body: '<p>`Roses` are `red`, and I `love` you.</p>',
            blanks: [
              { answer_type: 'open_entry', answers: ['Roses', 'Tulips'], match: 'any_of' },
              { answer_type: 'dropdown', choices: ['red', 'blue'] },
              { answer_type: 'word_bank' },
            ],
            word_bank_choices: ['love', 'hate'],
            reuse_word_bank_choices: true,
          }),
        )
        expect(result.success).toBe(true)
      })

      it(`${toolName}: accepts a bare open-entry blank with no per-blank config`, () => {
        expect(itemSchema(toolName).safeParse(fill()).success).toBe(true)
      })

      it.each([
        [
          'a blank count that disagrees with the body',
          fill({ item_body: '<p>`a` and `b`</p>' }),
          'marks 2 blank(s) but 1',
        ],
        ['an unmatched backtick', fill({ item_body: '<p>`a</p>' }), 'unmatched backtick'],
        [
          'a body with no blank marked at all',
          fill({ item_body: '<p>Nothing marked.</p>' }),
          'wrapping its answer in backticks',
        ],
        ['an empty blank', fill({ item_body: '<p>`` empty</p>' }), 'cannot be empty'],
        [
          'a dropdown that omits its own answer',
          fill({
            item_body: '<p>Tulips are `pink`.</p>',
            blanks: [{ answer_type: 'dropdown', choices: ['red', 'blue'] }],
          }),
          'must list its answer "pink"',
        ],
        [
          'a dropdown with a repeated choice',
          fill({
            item_body: '<p>`pink`</p>',
            blanks: [{ answer_type: 'dropdown', choices: ['pink', 'pink'] }],
          }),
          'dropdown choices must be unique',
        ],
        [
          'a word-bank blank with no pool',
          fill({ item_body: '<p>`love`</p>', blanks: [{ answer_type: 'word_bank' }] }),
          'need word_bank_choices',
        ],
        [
          'a word-bank answer missing from the pool',
          fill({
            item_body: '<p>`love`</p>',
            blanks: [{ answer_type: 'word_bank' }],
            word_bank_choices: ['hate'],
          }),
          'must be one of word_bank_choices',
        ],
        [
          'a pool with a repeated word',
          fill({
            item_body: '<p>`love`</p>',
            blanks: [{ answer_type: 'word_bank' }],
            word_bank_choices: ['love', 'love'],
          }),
          'word_bank_choices must be unique',
        ],
        [
          'a pool no blank draws from',
          fill({ word_bank_choices: ['love'] }),
          'no blank uses a word bank',
        ],
        [
          'several answers under a single-answer match',
          fill({
            blanks: [{ answer_type: 'open_entry', match: 'close_enough', answers: ['a', 'b'] }],
          }),
          'use match "any_of"',
        ],
        [
          'an empty answers list',
          fill({ blanks: [{ answer_type: 'open_entry', answers: [] }] }),
          'needs at least one answer',
        ],
      ])(`${toolName}: rejects %s`, (_name, item, expected) => {
        const result = itemSchema(toolName).safeParse(item)
        expect(result.success).toBe(false)
        expect(result.error!.issues.map((i) => i.message).join(' | ')).toContain(expected)
      })

      it(`${toolName}: rejects an unknown answer_type and a dropdown with one choice`, () => {
        expect(
          itemSchema(toolName).safeParse(fill({ blanks: [{ answer_type: 'hot_spot' }] })).success,
        ).toBe(false)
        expect(
          itemSchema(toolName).safeParse(
            fill({
              item_body: '<p>`pink`</p>',
              blanks: [{ answer_type: 'dropdown', choices: ['pink'] }],
            }),
          ).success,
        ).toBe(false)
      })

      it(`${toolName}: rejects an empty blanks list and a negative edit_distance`, () => {
        expect(itemSchema(toolName).safeParse(fill({ blanks: [] })).success).toBe(false)
        expect(
          itemSchema(toolName).safeParse(
            fill({ blanks: [{ answer_type: 'open_entry', edit_distance: -1 }] }),
          ).success,
        ).toBe(false)
      })
    }

    it('create_new_quiz_item passes a rich-fill-blank item through to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const item = {
        interaction_type_slug: 'rich-fill-blank',
        item_body: '<p>`Roses` are `red`.</p>',
        blanks: [
          { answer_type: 'open_entry' },
          { answer_type: 'dropdown', choices: ['red', 'blue'] },
        ],
      }
      await tool.handler({ course_id: 1, assignment_id: 2, points_possible: 2, item })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 2, {
        points_possible: 2,
        position: undefined,
        item,
      })
    })

    it('create_new_quiz_item names rich-fill-blank and its three blank modes', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'create_new_quiz_item')!
      expect(tool.description).toMatch(/rich-fill-blank/)
      expect(tool.description).toMatch(/dropdown/)
      expect(tool.description).toMatch(/word.bank/i)
    })

    it('both item tools count the same 8 types', () => {
      // update_new_quiz_item deliberately points at create_new_quiz_item for
      // the type list rather than repeating it, so only the count is asserted
      // here — but the count must not drift when a type is added.
      for (const name of ITEM_TOOLS) {
        const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === name)!
        expect(tool.description).toMatch(/8 types/)
      }
    })
  })

  // ── ordering schema (BRU-3214) ──────────────────────────────────────────────

  describe('ordering schema (BRU-3214)', () => {
    const ITEM_TOOLS = ['create_new_quiz_item', 'update_new_quiz_item'] as const

    function itemSchema(toolName: string) {
      return newQuizTools(buildMockCanvas()).find((t) => t.name === toolName)!.inputSchema.item
    }

    const order = (over: object = {}) => ({
      interaction_type_slug: 'ordering',
      item_body: '<p>Order these from youngest to oldest.</p>',
      choices: ['ava', 'blake', 'skylar'],
      ...over,
    })

    for (const toolName of ITEM_TOOLS) {
      it(`${toolName}: accepts a minimal ordering item`, () => {
        expect(itemSchema(toolName).safeParse(order()).success).toBe(true)
      })

      it(`${toolName}: accepts labels, include_labels, and display_answers_paragraph`, () => {
        const result = itemSchema(toolName).safeParse(
          order({
            title: 'Order by age',
            top_label: 'youngest',
            bottom_label: 'oldest',
            include_labels: true,
            display_answers_paragraph: true,
          }),
        )
        expect(result.success).toBe(true)
      })

      it(`${toolName}: rejects fewer than 2 choices`, () => {
        const result = itemSchema(toolName).safeParse(order({ choices: ['only-one'] }))
        expect(result.success).toBe(false)
      })

      it(`${toolName}: rejects an empty choices list`, () => {
        const result = itemSchema(toolName).safeParse(order({ choices: [] }))
        expect(result.success).toBe(false)
      })
    }

    it('create_new_quiz_item passes an ordering item through to createItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz_item')!
      const item = order({ top_label: 'youngest', bottom_label: 'oldest' })
      await tool.handler({ course_id: 1, assignment_id: 2, points_possible: 2, item })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 2, {
        points_possible: 2,
        position: undefined,
        item,
      })
    })

    it('create_new_quiz_item names ordering', () => {
      const tool = newQuizTools(buildMockCanvas()).find((t) => t.name === 'create_new_quiz_item')!
      expect(tool.description).toMatch(/\bordering\b/)
    })
  })

  // ── LTI not-enabled error mapping ───────────────────────────────────────────

  describe('LTI error mapping via formatError', () => {
    it('maps "Tool not configured" 404 on /api/quiz/v1/ to LTI not-enabled message', () => {
      const error = new CanvasApiError('Tool not configured', 404, '/api/quiz/v1/courses/1/quizzes')
      const result = formatError(error)
      expect(result).toContain('New Quizzes is not enabled')
      expect(result).toContain('list_quizzes / get_quiz')
    })

    it('maps "tool is not configured" (lowercase) 401 to LTI not-enabled message', () => {
      const error = new CanvasApiError(
        'tool is not configured',
        401,
        '/api/quiz/v1/courses/1/quizzes',
      )
      expect(formatError(error)).toContain('New Quizzes is not enabled')
    })

    it('plain 404 without LTI marker falls through to generic not-found message', () => {
      const error = new CanvasApiError('Quiz not found', 404, '/api/quiz/v1/courses/1/quizzes')
      const result = formatError(error)
      expect(result).not.toContain('New Quizzes is not enabled')
      expect(result).toBe('Course/assignment/submission not found — check the ID')
    })

    it('404 with LTI marker on /api/v1/ path does NOT trigger LTI message', () => {
      // Classic quiz 404 with same message text must not be mis-mapped
      const error = new CanvasApiError('Tool not configured', 404, '/api/v1/courses/1/quizzes/99')
      const result = formatError(error)
      expect(result).not.toContain('New Quizzes is not enabled')
    })

    it('maps 403 with "Rate Limit Exceeded" to rate-limit message', () => {
      const error = new CanvasApiError(
        'Rate Limit Exceeded',
        403,
        '/api/quiz/v1/courses/1/quizzes/42/items',
      )
      const result = formatError(error)
      expect(result).toContain('rate-limit hit')
      expect(result).toContain('retry')
    })

    it('plain 403 without rate-limit body falls through to permission message', () => {
      const error = new CanvasApiError('Forbidden', 403, '/api/quiz/v1/courses/1/quizzes')
      const result = formatError(error)
      expect(result).toBe("You don't have permission to perform this action in this course")
    })
  })
})
