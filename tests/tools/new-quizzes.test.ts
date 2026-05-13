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

  // ── Handler delegation ──────────────────────────────────────────────────────

  describe('create_new_quiz', () => {
    it('delegates to canvas.newQuizzes.create', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'create_new_quiz')!
      const result = await tool.handler({ course_id: 1, title: 'Quiz 1' })
      expect(canvas.newQuizzes.create).toHaveBeenCalledWith(1, {
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
      await tool.handler({ course_id: 1, assignment_id: 42, title: 'Updated' })
      expect(canvas.newQuizzes.update).toHaveBeenCalledWith(1, 42, {
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
      const result = await tool.handler({ course_id: 1, assignment_id: 42 })
      expect(canvas.newQuizzes.delete).toHaveBeenCalledWith(1, 42)
      expect(result).toEqual({ success: true })
    })
  })

  describe('list_new_quiz_items', () => {
    it('delegates to canvas.newQuizzes.listItems', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'list_new_quiz_items')!
      const result = await tool.handler({ course_id: 1, assignment_id: 42 })
      expect(canvas.newQuizzes.listItems).toHaveBeenCalledWith(1, 42)
      expect(result).toEqual([mockItem])
    })
  })

  describe('get_new_quiz_item', () => {
    it('delegates to canvas.newQuizzes.getItem', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'get_new_quiz_item')!
      const result = await tool.handler({ course_id: 1, assignment_id: 42, item_id: 'item-1' })
      expect(canvas.newQuizzes.getItem).toHaveBeenCalledWith(1, 42, 'item-1')
      expect(result).toEqual(mockItem)
    })
  })

  describe('delete_new_quiz_item', () => {
    it('delegates to canvas.newQuizzes.deleteItem and returns success', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'delete_new_quiz_item')!
      const result = await tool.handler({ course_id: 1, assignment_id: 42, item_id: 'item-1' })
      expect(canvas.newQuizzes.deleteItem).toHaveBeenCalledWith(1, 42, 'item-1')
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
      await tool.handler({ course_id: 1, assignment_id: 42, points_possible: 5, item: choiceItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
      await tool.handler({ course_id: 1, assignment_id: 42, points_possible: 1, item: tfItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
      await tool.handler({ course_id: 1, assignment_id: 42, points_possible: 10, item: essayItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
        course_id: 1,
        assignment_id: 42,
        points_possible: 4,
        item: matchItem,
      })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
      await tool.handler({ course_id: 1, assignment_id: 42, points_possible: 2, item: numItem })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
      await tool.handler({ course_id: 1, assignment_id: 42, points_possible: 1, position: 3, item })
      expect(canvas.newQuizzes.createItem).toHaveBeenCalledWith(1, 42, {
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
        course_id: 1,
        assignment_id: 42,
        item_id: 'item-1',
        points_possible: 8,
        item,
      })
      expect(canvas.newQuizzes.updateItem).toHaveBeenCalledWith(1, 42, 'item-1', {
        points_possible: 8,
        position: undefined,
        item,
      })
    })

    it('delegates without item (points/position only)', async () => {
      const canvas = buildMockCanvas()
      const tool = newQuizTools(canvas).find((t) => t.name === 'update_new_quiz_item')!
      await tool.handler({
        course_id: 1,
        assignment_id: 42,
        item_id: 'item-1',
        points_possible: 3,
      })
      expect(canvas.newQuizzes.updateItem).toHaveBeenCalledWith(1, 42, 'item-1', {
        points_possible: 3,
        position: undefined,
        item: undefined,
      })
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
