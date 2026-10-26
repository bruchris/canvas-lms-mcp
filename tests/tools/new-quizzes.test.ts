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
      })
      expect(result).toEqual(mockQuiz)
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
      })
    })
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
