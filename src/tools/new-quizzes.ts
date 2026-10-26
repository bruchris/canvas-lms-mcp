import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

const choiceItemSchema = z.object({
  interaction_type_slug: z.literal('choice'),
  title: z.string().optional().describe('Optional item heading shown above the question stem'),
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

const essayItemSchema = z
  .object({
    interaction_type_slug: z.literal('essay'),
    item_body: z.string(),
    rich_text: z.boolean().default(true).describe('Allow rich text editor'),
    word_count_min: z
      .number()
      .int()
      .optional()
      .describe(
        'Minimum word count. Canvas enables the word limit only with both bounds set, so pass ' +
          'word_count_max too; omit both for no word limit',
      ),
    word_count_max: z
      .number()
      .int()
      .optional()
      .describe(
        'Maximum word count. Canvas enables the word limit only with both bounds set, so pass ' +
          'word_count_min too; omit both for no word limit',
      ),
  })
  // Canvas documents the pair as all-or-nothing — "if enabled, max and min must
  // be set to word count values" (new_quiz_items.html) — so an item sent with
  // word_limit_enabled and only one bound violates a documented requirement
  // (not live-verified; #485's reporter exercised the both-bounds case). Reject
  // the partial input here rather than guess the missing side.
  .refine(
    (item) => (item.word_count_min === undefined) === (item.word_count_max === undefined),
    'word_count_min and word_count_max must be set together: Canvas requires both bounds when the essay word limit is enabled. Omit both for no word limit.',
  )

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
  distractors: z
    .array(z.string())
    .optional()
    .describe(
      'Wrong-answer distractor pool. Duplicates, and any entry equal to a correct answer, are dropped',
    ),
})

const numericItemSchema = z.object({
  interaction_type_slug: z.literal('numeric'),
  item_body: z.string(),
  answers: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('exact'),
          value: z.number(),
          margin: z
            .number()
            .default(0)
            .describe('Absolute tolerance around the value; 0 requires the exact value'),
        }),
        z.object({ kind: z.literal('range'), min: z.number(), max: z.number() }),
        z.object({
          kind: z.literal('precision'),
          value: z.number(),
          precision: z
            .number()
            .int()
            .describe(
              'Decimal places the answer must carry; the value is padded to this many decimals',
            ),
        }),
      ]),
    )
    .min(1)
    .describe('Every accepted answer; all of them are sent to Canvas'),
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
      title: 'Create New Quiz',
      description:
        'Create a New Quiz (LTI) in a Canvas course. Returns the created quiz with its id, ' +
        "assignment_id, and current field values. New Quizzes is Canvas's current quiz engine; " +
        'there is no tool here to create a Classic quiz — list_quizzes, get_quiz, and delete_quiz ' +
        'only read and delete that older type. After creating, add questions with ' +
        'create_new_quiz_item, change title, dates, or points with update_new_quiz, and remove ' +
        'the quiz with delete_new_quiz. Each call creates another quiz (not idempotent), so check ' +
        'list_quizzes before retrying. Requires permission to manage quizzes in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
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
        const courseId = params.course_id as CanvasId
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
      title: 'Update New Quiz',
      description:
        'Update an existing New Quiz (LTI) in a Canvas course, found by its assignment_id (from ' +
        'list_assignments or get_assignment, filtered on is_quiz_lti_assignment, or from ' +
        'create_new_quiz — not a Classic Quiz ID). Only the fields you ' +
        'pass change; omitted fields keep their current value, so a repeated call with the same ' +
        'payload leaves the quiz unchanged. Pass null for due_at, unlock_at, or lock_at to clear ' +
        'that date. Returns the updated quiz (id, title, points_possible, due_at, unlock_at, ' +
        'lock_at, published, assignment_id). Use update_new_quiz_item to change an individual ' +
        'question instead of the quiz shell, and delete_new_quiz to remove the whole quiz. ' +
        'Requires permission to manage quizzes in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
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
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
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
      title: 'Delete New Quiz',
      description:
        'Delete a New Quiz (LTI) from a Canvas course. This action is permanent. Use assignment_id (not quiz_id).',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
        await canvas.newQuizzes.delete(courseId, assignmentId)
        return { success: true }
      },
    },
    {
      name: 'list_new_quiz_items',
      title: 'List New Quiz Items',
      description:
        'List every item (question or stimulus) in a New Quiz (LTI), in quiz order, returning ' +
        "each item's id, position, points_possible, entry_type, and full entry body — including " +
        'interaction_data and scoring_data, so the correct answer is visible in the result. Find ' +
        'the assignment_id with list_assignments or get_assignment, filtered on ' +
        'is_quiz_lti_assignment (not a Classic Quiz ID). Use get_new_quiz_item to refetch a single item by id, ' +
        'create_new_quiz_item to add one, update_new_quiz_item to change one, and ' +
        'delete_new_quiz_item to remove one. Fetches every page (100 per request) and fails with ' +
        "a 'Results are incomplete' error instead of silently truncating.",
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
        return canvas.newQuizzes.listItems(courseId, assignmentId)
      },
    },
    {
      name: 'get_new_quiz_item',
      title: 'Get New Quiz Item',
      description:
        'Get one item (question or stimulus) from a New Quiz (LTI) by its item_id, returning its ' +
        'position, points_possible, entry_type, and full entry body — including interaction_data ' +
        'and scoring_data, so the response reveals the correct answer. Find item_id with ' +
        'list_new_quiz_items, which also lists every item at once; use this tool only to refetch ' +
        'one item, such as right after create_new_quiz_item or update_new_quiz_item. ' +
        'assignment_id identifies the New Quiz (from list_assignments or get_assignment, ' +
        'filtered on is_quiz_lti_assignment), not a Classic Quiz ID.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
        const itemId = params.item_id as string
        return canvas.newQuizzes.getItem(courseId, assignmentId, itemId)
      },
    },
    {
      name: 'create_new_quiz_item',
      title: 'Create New Quiz Item',
      description:
        'Create an item (question) in a New Quiz (LTI). Supports 5 types: choice (MCQ), true-false, essay, matching, numeric. Canvas may rate-limit rapid sequential creates. Call serially (not in parallel). For >50 items, chunk and pause between batches.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
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
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
        return canvas.newQuizzes.createItem(courseId, assignmentId, {
          points_possible: params.points_possible as number,
          position: params.position as number | undefined,
          item: params.item as Parameters<typeof canvas.newQuizzes.createItem>[2]['item'],
        })
      },
    },
    {
      name: 'update_new_quiz_item',
      title: 'Update New Quiz Item',
      description:
        'Update an existing item (question) in a New Quiz (LTI). All fields are optional; supply only what changes. Canvas may rate-limit rapid sequential updates. Call serially (not in parallel). For >50 items, chunk and pause between batches.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
        points_possible: z.number().optional().describe('Updated point value'),
        position: z.number().int().optional().describe('Updated 1-based position'),
        item: itemDiscriminatedUnion.optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
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
      title: 'Delete New Quiz Item',
      description:
        'Permanently delete one item (question or stimulus) from a New Quiz (LTI) by its ' +
        'item_id. This is irreversible — there is no undo and no tool to restore a deleted item. ' +
        'Returns { success: true }; Canvas does not hand back the deleted item. Find item_id ' +
        'with list_new_quiz_items or get_new_quiz_item. Use delete_new_quiz instead to remove the ' +
        'whole quiz, or update_new_quiz_item if you only need to change the item rather than ' +
        'remove it. assignment_id identifies the New Quiz (from list_assignments or ' +
        'get_assignment, filtered on is_quiz_lti_assignment), not a ' +
        'Classic Quiz ID. Requires permission to manage quizzes in the course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        assignment_id: canvasIdInput().describe('The assignment ID of the New Quiz'),
        item_id: z.string().describe('The New Quiz item ID (string, not numeric)'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: async (params) => {
        const courseId = params.course_id as CanvasId
        const assignmentId = params.assignment_id as CanvasId
        const itemId = params.item_id as string
        await canvas.newQuizzes.deleteItem(courseId, assignmentId, itemId)
        return { success: true }
      },
    },
  ]
}
