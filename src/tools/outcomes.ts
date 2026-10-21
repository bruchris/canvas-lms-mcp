import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import {
  OUTCOME_CONTEXT_TYPES,
  OUTCOME_DETAIL_LEVELS,
  OUTCOME_EXCLUDE_OPTIONS,
  OUTCOME_ROLLUP_AGGREGATE_STATS,
  OUTCOME_ROLLUP_SORT_BY,
  OUTCOME_SORT_ORDER,
} from '../canvas/outcomes'
import { type CanvasId, canvasIdInput, canvasIdList } from '../canvas/id'

export function outcomeTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'get_root_outcome_group',
      title: 'Get Root Outcome Group',
      description:
        'Get the root outcome group for an account or course context, the entry point into the ' +
        'outcome tree. Returns the top-level outcome group (id, title, subgroups_url, ' +
        'outcomes_url); walk from there with list_outcome_group_subgroups for its child groups ' +
        'and list_outcome_group_outcomes for outcomes linked directly under a group, or use ' +
        'list_outcome_groups for a flat listing of every group in the context instead of walking ' +
        'the tree.',
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcomes from an account or course context.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getRootOutcomeGroup(
          params.context_type as 'account' | 'course',
          params.context_id as CanvasId,
        ),
    },
    {
      name: 'list_outcome_groups',
      title: 'List Outcome Groups',
      description:
        'List every outcome group in an account or course context as a flat array, not a tree. ' +
        "Fetches every page (100 per request) and fails with a 'Results are incomplete' error " +
        'instead of silently truncating. Use get_root_outcome_group plus ' +
        'list_outcome_group_subgroups to walk the hierarchy instead, or get_outcome_group to ' +
        "fetch one group's details by ID.",
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcome groups from an account or course context.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listOutcomeGroups(
          params.context_type as 'account' | 'course',
          params.context_id as CanvasId,
        ),
    },
    {
      name: 'list_outcome_group_links',
      title: 'List Outcome Group Links',
      description:
        'List every outcome link in an account or course context — the many-to-many join ' +
        'between outcome groups and the outcomes they contain, read from the context root, not ' +
        "one specific group. Fetches every page (100 per request) and fails with a 'Results are " +
        "incomplete' error instead of silently truncating. Each link nests its outcome_group and " +
        'outcome (full detail when outcome_style="full" / outcome_group_style="full", abbreviated ' +
        'otherwise); use list_outcome_group_outcomes instead to list only the outcomes linked ' +
        'directly under one specific outcome_group_id.',
      inputSchema: {
        context_type: z
          .enum(OUTCOME_CONTEXT_TYPES)
          .describe('Whether to read outcome links from an account or course context.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
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
          params.context_id as CanvasId,
          {
            outcome_style: params.outcome_style as 'abbrev' | 'full' | undefined,
            outcome_group_style: params.outcome_group_style as 'abbrev' | 'full' | undefined,
          },
        ),
    },
    {
      name: 'get_outcome_group',
      title: 'Get Outcome Group',
      description:
        'Get the full details for one outcome group by outcome_group_id within an account or ' +
        'course context, including its subgroups_url and outcomes_url. The ID comes from ' +
        'list_outcome_groups, list_outcome_group_subgroups, or get_root_outcome_group; use ' +
        'list_outcome_group_outcomes to list the outcomes linked under this group and ' +
        "list_outcome_group_subgroups to list this group's child groups.",
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: canvasIdInput().describe('The Canvas outcome group ID.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeGroup(
          params.context_type as 'account' | 'course',
          params.context_id as CanvasId,
          params.outcome_group_id as CanvasId,
        ),
    },
    {
      name: 'list_outcome_group_outcomes',
      title: 'List Outcome Group Outcomes',
      description:
        'List the outcomes linked directly under one outcome group (outcome_group_id), not its ' +
        "subgroups' outcomes. Fetches every page (100 per request) and fails with a 'Results are " +
        "incomplete' error instead of silently truncating. Each link nests the outcome (full " +
        'detail when outcome_style="full", abbreviated otherwise); use ' +
        'list_outcome_group_subgroups to descend into child groups first, or get_outcome for one ' +
        "outcome's full detail by outcome_id.",
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: canvasIdInput().describe('The Canvas outcome group ID.'),
        outcome_style: z
          .enum(OUTCOME_DETAIL_LEVELS)
          .optional()
          .describe('Outcome detail level. Use "full" to include expanded outcome fields.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listGroupOutcomes(
          params.context_type as 'account' | 'course',
          params.context_id as CanvasId,
          params.outcome_group_id as CanvasId,
          {
            outcome_style: params.outcome_style as 'abbrev' | 'full' | undefined,
          },
        ),
    },
    {
      name: 'list_outcome_group_subgroups',
      title: 'List Outcome Group Subgroups',
      description:
        'List the immediate child outcome groups under one outcome group (outcome_group_id) — ' +
        'one level of the tree, not a recursive walk. Fetches every page (100 per request) and ' +
        "fails with a 'Results are incomplete' error instead of silently truncating. Call this " +
        "again with each returned group's id to descend further, or use " +
        'list_outcome_group_outcomes on the same outcome_group_id to list outcomes linked ' +
        'directly under it instead of its child groups.',
      inputSchema: {
        context_type: z.enum(OUTCOME_CONTEXT_TYPES).describe('The outcome group context type.'),
        context_id: canvasIdInput().describe('The Canvas account ID or course ID for the context.'),
        outcome_group_id: canvasIdInput().describe('The Canvas outcome group ID.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.listGroupSubgroups(
          params.context_type as 'account' | 'course',
          params.context_id as CanvasId,
          params.outcome_group_id as CanvasId,
        ),
    },
    {
      name: 'get_outcome',
      title: 'Get Outcome',
      description:
        'Get the full details for one learning outcome by outcome_id, including its rating ' +
        'criteria, mastery_points, and calculation_method. The outcome_id comes from ' +
        "list_outcome_group_outcomes, list_outcome_group_links, or get_outcome_results' / " +
        "get_outcome_rollups' linked.outcomes; get_outcome_alignments lists all alignments " +
        'in the course (not scoped to one outcome) — cross-reference via get_outcome_results ' +
        'instead to tie an alignment to this outcome_id.',
      inputSchema: {
        outcome_id: canvasIdInput().describe('The Canvas outcome ID.'),
        add_defaults: z
          .boolean()
          .optional()
          .describe('Include default mastery colors and levels when Canvas supports it.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcome(params.outcome_id as CanvasId, {
          add_defaults: params.add_defaults as boolean | undefined,
        }),
    },
    {
      name: 'get_outcome_alignments',
      title: 'Get Outcome Alignments',
      description:
        'Get the assignments aligned to outcomes in a course, optionally filtered to one ' +
        "student_id or assignment_id. Returns each alignment's assignment_id and title, but not " +
        'the outcome_id it maps to. get_outcome_results nests the same alignment objects under ' +
        "linked.alignments, but ties an alignment to an outcome via each outcome_results[] entry's " +
        'links.alignment and links.learning_outcome, not from linked.alignments alone. Use ' +
        "get_outcome_contributing_scores to see the assignment scores that produced an outcome's " +
        'results instead of just the links.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID.'),
        student_id: canvasIdInput()
          .optional()
          .describe('Optional Canvas user ID of the student to filter alignments by.'),
        assignment_id: canvasIdInput()
          .optional()
          .describe('Optional Canvas assignment ID to filter alignments by.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.outcomes.getOutcomeAlignments(params.course_id as CanvasId, {
          student_id: params.student_id as CanvasId | undefined,
          assignment_id: params.assignment_id as CanvasId | undefined,
        }),
    },
    {
      name: 'get_outcome_results',
      title: 'Get Outcome Results',
      description:
        'Get raw per-student, per-alignment outcome results for a course (one score per assessed ' +
        'alignment, not aggregated), optionally filtered by user_ids, outcome_ids, and ' +
        'include_hidden. Set include_alignments to nest the matching alignments under ' +
        'linked.alignments. When CANVAS_PSEUDONYMIZE_STUDENTS is enabled, linked.users entries ' +
        'are anonymized; use resolve_pseudonym to map one back to a real user. Use ' +
        'get_outcome_rollups instead for aggregated scores per student and outcome, or ' +
        'get_outcome_contributing_scores for the assignment or quiz scores behind one outcome.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID.'),
        user_ids: canvasIdList({ prefixes: ['sis_user_id'] })
          .optional()
          .describe(
            'Optional Canvas user IDs (pass large IDs as strings) or SIS user IDs ' +
              'prefixed with "sis_user_id:".',
          ),
        outcome_ids: z
          .array(canvasIdInput())
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
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const response = await canvas.outcomes.getOutcomeResults(course_id, {
          user_ids: params.user_ids as CanvasId[] | undefined,
          outcome_ids: params.outcome_ids as CanvasId[] | undefined,
          include_alignments: params.include_alignments as boolean | undefined,
          include_hidden: params.include_hidden as boolean | undefined,
        })
        if (!pseudonymizer?.isEnabled()) return response
        return pseudonymizer.anonymizeOutcomeResults(course_id, response)
      },
    },
    {
      name: 'get_outcome_rollups',
      title: 'Get Outcome Rollups',
      description:
        'Get aggregated outcome rollups for a course — one score per student per outcome, or, ' +
        'with aggregate="course", a single course-level mean or median — optionally filtered by ' +
        "user_ids and outcome_ids and sorted by student or by one outcome's score. Set " +
        'include_courses to nest course details under linked.courses. When ' +
        'CANVAS_PSEUDONYMIZE_STUDENTS is enabled, linked.users entries are anonymized; use ' +
        'resolve_pseudonym to map one back to a real user. Use get_outcome_results instead for ' +
        'the raw per-alignment scores behind a rollup, or get_outcome_mastery_distribution for a ' +
        'mastery-level histogram across students.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID.'),
        aggregate: z
          .enum(['course'])
          .optional()
          .describe('Aggregate all student rollups into a single course-level rollup.'),
        aggregate_stat: z
          .enum(OUTCOME_ROLLUP_AGGREGATE_STATS)
          .optional()
          .describe('Statistic to use when aggregate="course".'),
        user_ids: canvasIdList({ prefixes: ['sis_user_id'] })
          .optional()
          .describe(
            'Optional Canvas user IDs (pass large IDs as strings) or SIS user IDs ' +
              'prefixed with "sis_user_id:".',
          ),
        outcome_ids: z
          .array(canvasIdInput())
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
        sort_outcome_id: canvasIdInput()
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
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const response = await canvas.outcomes.getOutcomeRollups(course_id, {
          aggregate: params.aggregate as 'course' | undefined,
          aggregate_stat: params.aggregate_stat as 'mean' | 'median' | undefined,
          user_ids: params.user_ids as CanvasId[] | undefined,
          outcome_ids: params.outcome_ids as CanvasId[] | undefined,
          include_courses: params.include_courses as boolean | undefined,
          exclude: params.exclude as
            Array<'missing_user_rollups' | 'missing_outcome_results'> | undefined,
          sort_by: params.sort_by as 'student' | 'outcome' | undefined,
          sort_outcome_id: params.sort_outcome_id as CanvasId | undefined,
          sort_order: params.sort_order as 'asc' | 'desc' | undefined,
          add_defaults: params.add_defaults as boolean | undefined,
        })
        if (!pseudonymizer?.isEnabled()) return response
        return pseudonymizer.anonymizeOutcomeResults(course_id, response)
      },
    },
    {
      name: 'get_outcome_contributing_scores',
      title: 'Get Outcome Contributing Scores',
      description:
        "Get the assignment or quiz scores that contributed to one outcome_id's results for one " +
        'or more students in a course, optionally restricted to assignment alignments only or ' +
        'including unpublished assignments. Use get_outcome_results instead for the final ' +
        'per-alignment outcome score rather than the scores that fed it, or get_outcome_alignments ' +
        'to list all alignments in the course (not scoped to this outcome) without their scores.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID.'),
        outcome_id: canvasIdInput().describe('The Canvas outcome ID.'),
        user_ids: canvasIdList({ prefixes: ['sis_user_id'] })
          .optional()
          .describe(
            'Optional Canvas user IDs (pass large IDs as strings) or SIS user IDs ' +
              'prefixed with "sis_user_id:".',
          ),
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
          params.course_id as CanvasId,
          params.outcome_id as CanvasId,
          {
            user_ids: params.user_ids as CanvasId[] | undefined,
            only_assignment_alignments: params.only_assignment_alignments as boolean | undefined,
            show_unpublished_assignments: params.show_unpublished_assignments as
              boolean | undefined,
          },
        ),
    },
    {
      name: 'get_outcome_mastery_distribution',
      title: 'Get Outcome Mastery Distribution',
      description:
        'Get a mastery-level histogram for outcomes in a course — how many students fall into ' +
        'each rating band — optionally filtered by outcome_ids and student_ids and excluding ' +
        'missing user rollups or missing outcome results. Set include_alignment_distributions to ' +
        'also break down scores by contributing alignment. Use get_outcome_rollups instead for ' +
        "each student's individual aggregated score, or get_outcome_results for the raw " +
        'per-alignment scores.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID.'),
        exclude: z
          .array(z.enum(OUTCOME_EXCLUDE_OPTIONS))
          .optional()
          .describe('Optional exclusions for missing users or missing outcome results.'),
        outcome_ids: z
          .array(canvasIdInput())
          .optional()
          .describe('Optional outcome IDs to restrict the distribution results.'),
        student_ids: canvasIdList({ prefixes: ['sis_user_id'] })
          .optional()
          .describe(
            'Optional Canvas student IDs (pass large IDs as strings) or SIS user IDs ' +
              'prefixed with "sis_user_id:".',
          ),
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
        canvas.outcomes.getOutcomeMasteryDistribution(params.course_id as CanvasId, {
          exclude: params.exclude as
            Array<'missing_user_rollups' | 'missing_outcome_results'> | undefined,
          outcome_ids: params.outcome_ids as CanvasId[] | undefined,
          student_ids: params.student_ids as CanvasId[] | undefined,
          include_alignment_distributions: params.include_alignment_distributions as
            boolean | undefined,
          only_assignment_alignments: params.only_assignment_alignments as boolean | undefined,
          show_unpublished_assignments: params.show_unpublished_assignments as boolean | undefined,
          add_defaults: params.add_defaults as boolean | undefined,
        }),
    },
  ]
}
