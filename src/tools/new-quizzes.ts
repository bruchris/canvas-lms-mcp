import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'

const choiceItemSchema = z.object({
  interaction_type_slug: z.literal('choice'),
  title: z.string().optional(),
  item_body: z.string().describe('HTML question stem'),
  choices: z
    .array(
      z.object({
        id: z.string().describe('Stable choice identifier (caller-generated, e.g. "a")'),
        item_body: z.string().describe('HTML choice text'),
      }),
    )
    .min(2),
  correct_choice_id: z.string().describe('id of the correct choice'),
})

const trueFalseItemSchema = z.object({
  interaction_type_slug: z.literal('true-false'),
  item_body: z.string(),
  correct_answer: z.boolean(),
})

const essayItemSchema = z.object({
  interaction_type_slug: z.literal('essay'),
  item_body: z.string(),
  rich_text: z.boolean().default(true).describe('Allow rich text editor'),
  word_count_min: z.number().int().optional(),
  word_count_max: z.number().int().optional(),
})

const matchingItemSchema = z.object({
  interaction_type_slug: z.literal('matching'),
  item_body: z.string(),
  matches: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      }),
    )
    .min(2),
  distractors: z.array(z.string()).optional().describe('Wrong-answer distractor pool'),
})

const numericItemSchema = z.object({
  interaction_type_slug: z.literal('numeric'),
  item_body: z.string(),
  answers: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('exact'), value: z.number(), margin: z.number().default(0) }),
        z.object({ kind: z.literal('range'), min: z.number(), max: z.number() }),
        z.object({
          kind: z.literal('precision'),
          value: z.number(),
          precision: z.number().int(),
        }),
      ]),
    )
    .min(1),
})

const itemDiscriminatedUnion = z.discriminatedUnion('interaction_type_slug', [
  choiceItemSchema,
  trueFalseItemSchema,
  essayItemSchema,
  matchingItemSchema,
  numericItemSchema,
])

export function newQuizTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'create_new_quiz',
      description:
        'Create a New Quiz (LTI) in a Canvas course. New Quizzes is the modern quiz engine; for Classic quizzes use create_quiz.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        title: z.string().describe('Title of the quiz'),
        instructions: z
          .string()
          .nullable()
          .optional()
          .describe('HTML instructions shown before the quiz starts'),
        points_possible: z
          .number()
          .optional()
          .describe('Total points; defaults to sum of item points'),
        due_at: z.string().optional().describe('ISO-8601 due date'),
        unlock_at: z.string().optional().describe('ISO-8601 unlock time'),
        lock_at: z.string().optional().describe('ISO-8601 lock time'),
        published: z.boolean().optional().describe('Whether the quiz is visible to students'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        return canvas.newQuizzes.create(courseId, {
          title: params.title as string,
          instructions: params.instructions as string | null | undefined,
          points_possible: params.points_possible as number | undefined,
          due_at: params.due_at as string | null | undefined,
          unlock_at: params.unlock_at as string | null | undefined,
          lock_at: params.lock_at as string | null | undefined,
          published: params.published as boolean | undefined,
        })
      },
    },
    {
      name: 'update_new_quiz',
      description: 'Update an existing New Quiz (LTI) in a Canvas course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
        title: z.string().optional().describe('Title of the quiz'),
        instructions: z
          .string()
          .nullable()
          .optional()
          .describe('HTML instructions shown before the quiz starts'),
        points_possible: z.number().optional().describe('Total points'),
        due_at: z.string().nullable().optional().describe('ISO-8601 due date (null to clear)'),
        unlock_at: z
          .string()
          .nullable()
          .optional()
          .describe('ISO-8601 unlock time (null to clear)'),
        lock_at: z.string().nullable().optional().describe('ISO-8601 lock time (null to clear)'),
        published: z.boolean().optional().describe('Whether the quiz is visible to students'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        return canvas.newQuizzes.update(courseId, assignmentId, {
          title: params.title as string | undefined,
          instructions: params.instructions as string | null | undefined,
          points_possible: params.points_possible as number | undefined,
          due_at: params.due_at as string | null | undefined,
          unlock_at: params.unlock_at as string | null | undefined,
          lock_at: params.lock_at as string | null | undefined,
          published: params.published as boolean | undefined,
        })
      },
    },
    {
      name: 'delete_new_quiz',
      description:
        'Delete a New Quiz (LTI) from a Canvas course. This action is permanent. Use assignment_id (not quiz_id).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        await canvas.newQuizzes.delete(courseId, assignmentId)
        return { success: true }
      },
    },
    {
      name: 'list_new_quiz_items',
      description: 'List all items (questions) in a New Quiz (LTI).',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        return canvas.newQuizzes.listItems(courseId, assignmentId)
      },
    },
    {
      name: 'get_new_quiz_item',
      description: 'Get a single item (question) from a New Quiz (LTI) by item ID.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        const itemId = params.item_id as string
        return canvas.newQuizzes.getItem(courseId, assignmentId, itemId)
      },
    },
    {
      name: 'create_new_quiz_item',
      description:
        'Create an item (question) in a New Quiz (LTI). Supports 5 types: choice (MCQ), true-false, essay, matching, numeric. Canvas may rate-limit rapid sequential creates. Call serially (not in parallel). For >50 items, chunk and pause between batches.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
        points_possible: z.number().describe('Points awarded for a fully correct answer'),
        position: z
          .number()
          .int()
          .optional()
          .describe('1-based position in the quiz; appended if omitted'),
        item: itemDiscriminatedUnion,
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        return canvas.newQuizzes.createItem(courseId, assignmentId, {
          points_possible: params.points_possible as number,
          position: params.position as number | undefined,
          item: params.item as Parameters<typeof canvas.newQuizzes.createItem>[2]['item'],
        })
      },
    },
    {
      name: 'update_new_quiz_item',
      description:
        'Update an existing item (question) in a New Quiz (LTI). All fields are optional; supply only what changes. Canvas may rate-limit rapid sequential updates. Call serially (not in parallel). For >50 items, chunk and pause between batches.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
        points_possible: z.number().optional().describe('Updated point value'),
        position: z.number().int().optional().describe('Updated 1-based position'),
        item: itemDiscriminatedUnion.optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        const itemId = params.item_id as string
        return canvas.newQuizzes.updateItem(courseId, assignmentId, itemId, {
          points_possible: params.points_possible as number | undefined,
          position: params.position as number | undefined,
          item:
            params.item !== undefined
              ? (params.item as Parameters<typeof canvas.newQuizzes.updateItem>[3]['item'])
              : undefined,
        })
      },
    },
    {
      name: 'delete_new_quiz_item',
      description: 'Delete an item (question) from a New Quiz (LTI). This action is permanent.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as number
        const assignmentId = params.assignment_id as number
        const itemId = params.item_id as string
        await canvas.newQuizzes.deleteItem(courseId, assignmentId, itemId)
        return { success: true }
      },
    },
  ]
}
