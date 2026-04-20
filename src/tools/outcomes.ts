import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { ToolDefinition } from './types'
import {
  OUTCOME_CONTEXT_TYPES,
  OUTCOME_DETAIL_LEVELS,
  OUTCOME_EXCLUDE_OPTIONS,
  OUTCOME_ROLLUP_AGGREGATE_STATS,
  OUTCOME_ROLLUP_SORT_BY,
  OUTCOME_SORT_ORDER,
} from '../canvas/outcomes'

export function outcomeTools(canvas: CanvasClient): ToolDefinition[] {
  return [
    {
      name: 'get_root_outcome_group',
      description: 'Get the root outcome group for an account or course context.',
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcomes from an account or course context.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getRootOutcomeGroup(
          params.context_type as 'account' | 'course',
          params.context_id as number,
        ),
    },
    {
      name: 'list_outcome_groups',
      description: 'List all outcome groups for an account or course context.',
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcome groups from an account or course context.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listOutcomeGroups(
          params.context_type as 'account' | 'course',
          params.context_id as number,
        ),
    },
    {
      name: 'list_outcome_group_links',
      description: 'List all outcome links in an account or course context.',
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcome links from an account or course context.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
        outcome_style: z
          .enum(OUTCOME_DETAIL_LEVELS)
          .optional()
          .describe('Outcome detail level. Use "full" to include expanded outcome fields.'),
        outcome_group_style: z
          .enum(OUTCOME_DETAIL_LEVELS)
          .optional()
          .describe(
            'Outcome group detail level. Use "full" to include expanded outcome group fields.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listOutcomeGroupLinks(
          params.context_type as 'account' | 'course',
          params.context_id as number,
          {
            outcome_style: params.outcome_style as 'abbrev' | 'full' | undefined,
            outcome_group_style: params.outcome_group_style as 'abbrev' | 'full' | undefined,
          },
        ),
    },
    {
      name: 'get_outcome_group',
      description: 'Get details for a specific outcome group in an account or course context.',
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: z.number().describe('The Canvas outcome group ID.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeGroup(
          params.context_type as 'account' | 'course',
          params.context_id as number,
          params.outcome_group_id as number,
        ),
    },
    {
      name: 'list_outcome_group_outcomes',
      description: 'List the linked outcomes directly under a specific outcome group.',
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: z.number().describe('The Canvas outcome group ID.'),
        outcome_style: z
          .enum(OUTCOME_DETAIL_LEVELS)
          .optional()
          .describe('Outcome detail level. Use "full" to include expanded outcome fields.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listGroupOutcomes(
          params.context_type as 'account' | 'course',
          params.context_id as number,
          params.outcome_group_id as number,
          {
            outcome_style: params.outcome_style as 'abbrev' | 'full' | undefined,
          },
        ),
    },
    {
      name: 'list_outcome_group_subgroups',
      description: 'List the immediate child outcome groups under a specific outcome group.',
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: z.number().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: z.number().describe('The Canvas outcome group ID.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listGroupSubgroups(
          params.context_type as 'account' | 'course',
          params.context_id as number,
          params.outcome_group_id as number,
        ),
    },
    {
      name: 'get_outcome',
      description: 'Get the full details for a specific learning outcome by ID.',
      inputSchema: {
        outcome_id: z.number().describe('The Canvas outcome ID.'),
        add_defaults: z
          .boolean()
          .optional()
          .describe('Include default mastery colors and levels when Canvas supports it.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcome(params.outcome_id as number, {
          add_defaults: params.add_defaults as boolean | undefined,
        }),
    },
    {
      name: 'get_outcome_alignments',
      description:
        'Get outcome alignments for a course, optionally filtered to a specific student or assignment.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID.'),
        student_id: z
          .number()
          .optional()
          .describe('Optional Canvas user ID of the student to filter alignments by.'),
        assignment_id: z
          .number()
          .optional()
          .describe('Optional Canvas assignment ID to filter alignments by.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeAlignments(params.course_id as number, {
          student_id: params.student_id as number | undefined,
          assignment_id: params.assignment_id as number | undefined,
        }),
    },
    {
      name: 'get_outcome_results',
      description:
        'Get per-student outcome results for a course, with optional outcome, student, and alignment filters.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID.'),
        user_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe('Optional Canvas user IDs or SIS user IDs prefixed with "sis_user_id:".'),
        outcome_ids: z
          .array(z.number())
          .optional()
          .describe('Optional outcome IDs to restrict the results.'),
        include_alignments: z
          .boolean()
          .optional()
          .describe('Include linked alignment details in the response.'),
        include_hidden: z
          .boolean()
          .optional()
          .describe('Include hidden outcomes when Canvas supports it.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeResults(params.course_id as number, {
          user_ids: params.user_ids as Array<number | string> | undefined,
          outcome_ids: params.outcome_ids as number[] | undefined,
          include_alignments: params.include_alignments as boolean | undefined,
          include_hidden: params.include_hidden as boolean | undefined,
        }),
    },
    {
      name: 'get_outcome_rollups',
      description:
        'Get outcome rollups for a course, optionally aggregated or filtered by students, outcomes, and sort options.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID.'),
        aggregate: z
          .enum(['course'])
          .optional()
          .describe('Aggregate all student rollups into a single course-level rollup.'),
        aggregate_stat: z
          .enum(OUTCOME_ROLLUP_AGGREGATE_STATS)
          .optional()
          .describe('Statistic to use when aggregate="course".'),
        user_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe('Optional Canvas user IDs or SIS user IDs prefixed with "sis_user_id:".'),
        outcome_ids: z
          .array(z.number())
          .optional()
          .describe('Optional outcome IDs to restrict the rollups.'),
        include_courses: z
          .boolean()
          .optional()
          .describe('Include linked course details in the response payload.'),
        exclude: z
          .array(z.enum(OUTCOME_EXCLUDE_OPTIONS))
          .optional()
          .describe('Optional rollup exclusions for missing users or missing outcome results.'),
        sort_by: z
          .enum(OUTCOME_ROLLUP_SORT_BY)
          .optional()
          .describe('Sort rollups by student name or by a specific outcome score.'),
        sort_outcome_id: z
          .number()
          .optional()
          .describe('Outcome ID to sort by when sort_by="outcome".'),
        sort_order: z
          .enum(OUTCOME_SORT_ORDER)
          .optional()
          .describe('Sort order to apply when sorting rollups.'),
        add_defaults: z
          .boolean()
          .optional()
          .describe('Include default mastery colors and levels when Canvas supports it.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeRollups(params.course_id as number, {
          aggregate: params.aggregate as 'course' | undefined,
          aggregate_stat: params.aggregate_stat as 'mean' | 'median' | undefined,
          user_ids: params.user_ids as Array<number | string> | undefined,
          outcome_ids: params.outcome_ids as number[] | undefined,
          include_courses: params.include_courses as boolean | undefined,
          exclude: params.exclude as
            | Array<'missing_user_rollups' | 'missing_outcome_results'>
            | undefined,
          sort_by: params.sort_by as 'student' | 'outcome' | undefined,
          sort_outcome_id: params.sort_outcome_id as number | undefined,
          sort_order: params.sort_order as 'asc' | 'desc' | undefined,
          add_defaults: params.add_defaults as boolean | undefined,
        }),
    },
    {
      name: 'get_outcome_contributing_scores',
      description:
        'Get assignment or quiz scores that contributed to a specific outcome for one or more students in a course.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID.'),
        outcome_id: z.number().describe('The Canvas outcome ID.'),
        user_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe('Optional Canvas user IDs or SIS user IDs prefixed with "sis_user_id:".'),
        only_assignment_alignments: z
          .boolean()
          .optional()
          .describe('Limit results to assignment alignments only.'),
        show_unpublished_assignments: z
          .boolean()
          .optional()
          .describe('Include unpublished assignments in the contributing score results.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeContributingScores(
          params.course_id as number,
          params.outcome_id as number,
          {
            user_ids: params.user_ids as Array<number | string> | undefined,
            only_assignment_alignments: params.only_assignment_alignments as boolean | undefined,
            show_unpublished_assignments: params.show_unpublished_assignments as
              | boolean
              | undefined,
          },
        ),
    },
    {
      name: 'get_outcome_mastery_distribution',
      description:
        'Get mastery distribution analytics for outcomes in a course, optionally filtered by students or outcomes.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID.'),
        exclude: z
          .array(z.enum(OUTCOME_EXCLUDE_OPTIONS))
          .optional()
          .describe('Optional exclusions for missing users or missing outcome results.'),
        outcome_ids: z
          .array(z.number())
          .optional()
          .describe('Optional outcome IDs to restrict the distribution results.'),
        student_ids: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe('Optional Canvas student IDs or SIS user IDs prefixed with "sis_user_id:".'),
        include_alignment_distributions: z
          .boolean()
          .optional()
          .describe('Include contributing score distributions for alignments.'),
        only_assignment_alignments: z
          .boolean()
          .optional()
          .describe('When including alignment distributions, limit them to assignments only.'),
        show_unpublished_assignments: z
          .boolean()
          .optional()
          .describe('Include unpublished assignments in alignment distributions.'),
        add_defaults: z
          .boolean()
          .optional()
          .describe('Include default mastery colors and levels when Canvas supports it.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeMasteryDistribution(params.course_id as number, {
          exclude: params.exclude as
            | Array<'missing_user_rollups' | 'missing_outcome_results'>
            | undefined,
          outcome_ids: params.outcome_ids as number[] | undefined,
          student_ids: params.student_ids as Array<number | string> | undefined,
          include_alignment_distributions: params.include_alignment_distributions as
            | boolean
            | undefined,
          only_assignment_alignments: params.only_assignment_alignments as boolean | undefined,
          show_unpublished_assignments: params.show_unpublished_assignments as boolean | undefined,
          add_defaults: params.add_defaults as boolean | undefined,
        }),
    },
  ]
}
