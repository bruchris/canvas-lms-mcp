import type { CanvasHttpClient } from './client'
import type {
  CanvasOutcomeContextType,
  CanvasOutcome,
  CanvasOutcomeAlignment,
  CanvasOutcomeContributingScoresResponse,
  CanvasOutcomeGroup,
  CanvasOutcomeLink,
  CanvasOutcomeMasteryDistributionResponse,
  CanvasOutcomeResultsResponse,
  CanvasOutcomeRollupsResponse,
} from './types'

export const OUTCOME_CONTEXT_TYPES = ['account', 'course'] as const
export const OUTCOME_DETAIL_LEVELS = ['abbrev', 'full'] as const
export const OUTCOME_ROLLUP_AGGREGATE_STATS = ['mean', 'median'] as const
export const OUTCOME_ROLLUP_SORT_BY = ['student', 'outcome'] as const
export const OUTCOME_SORT_ORDER = ['asc', 'desc'] as const
export const OUTCOME_EXCLUDE_OPTIONS = ['missing_user_rollups', 'missing_outcome_results'] as const

type ContextPathSuffix = 'outcome_groups' | 'outcome_group_links' | 'root_outcome_group'

export class OutcomesModule {
  constructor(private client: CanvasHttpClient) {}

  async getRootOutcomeGroup(
    contextType: CanvasOutcomeContextType,
    contextId: number,
  ): Promise<CanvasOutcomeGroup> {
    return this.client.request<CanvasOutcomeGroup>(this.buildContextPath(contextType, contextId))
  }

  async listOutcomeGroups(
    contextType: CanvasOutcomeContextType,
    contextId: number,
  ): Promise<CanvasOutcomeGroup[]> {
    return this.client.paginate<CanvasOutcomeGroup>(
      this.buildContextPath(contextType, contextId, 'outcome_groups'),
    )
  }

  async listOutcomeGroupLinks(
    contextType: CanvasOutcomeContextType,
    contextId: number,
    options?: { outcome_style?: 'abbrev' | 'full'; outcome_group_style?: 'abbrev' | 'full' },
  ): Promise<CanvasOutcomeLink[]> {
    return this.client.paginate<CanvasOutcomeLink>(
      this.withQuery(this.buildContextPath(contextType, contextId, 'outcome_group_links'), {
        outcome_style: options?.outcome_style,
        outcome_group_style: options?.outcome_group_style,
      }),
    )
  }

  async getOutcomeGroup(
    contextType: CanvasOutcomeContextType,
    contextId: number,
    groupId: number,
  ): Promise<CanvasOutcomeGroup> {
    return this.client.request<CanvasOutcomeGroup>(
      `${this.buildContextPath(contextType, contextId, 'outcome_groups')}/${groupId}`,
    )
  }

  async listGroupOutcomes(
    contextType: CanvasOutcomeContextType,
    contextId: number,
    groupId: number,
    options?: { outcome_style?: 'abbrev' | 'full' },
  ): Promise<CanvasOutcomeLink[]> {
    return this.client.paginate<CanvasOutcomeLink>(
      this.withQuery(
        `${this.buildContextPath(contextType, contextId, 'outcome_groups')}/${groupId}/outcomes`,
        { outcome_style: options?.outcome_style },
      ),
    )
  }

  async listGroupSubgroups(
    contextType: CanvasOutcomeContextType,
    contextId: number,
    groupId: number,
  ): Promise<CanvasOutcomeGroup[]> {
    return this.client.paginate<CanvasOutcomeGroup>(
      `${this.buildContextPath(contextType, contextId, 'outcome_groups')}/${groupId}/subgroups`,
    )
  }

  async getOutcome(
    outcomeId: number,
    options?: { add_defaults?: boolean },
  ): Promise<CanvasOutcome> {
    return this.client.request<CanvasOutcome>(
      this.withQuery(`/api/v1/outcomes/${outcomeId}`, {
        add_defaults: options?.add_defaults,
      }),
    )
  }

  async getOutcomeAlignments(
    courseId: number,
    options?: { student_id?: number; assignment_id?: number },
  ): Promise<CanvasOutcomeAlignment[]> {
    return this.client.request<CanvasOutcomeAlignment[]>(
      this.withQuery(`/api/v1/courses/${courseId}/outcome_alignments`, {
        student_id: options?.student_id,
        assignment_id: options?.assignment_id,
      }),
    )
  }

  async getOutcomeResults(
    courseId: number,
    options?: {
      user_ids?: Array<number | string>
      outcome_ids?: number[]
      include_alignments?: boolean
      include_hidden?: boolean
    },
  ): Promise<CanvasOutcomeResultsResponse> {
    return this.client.request<CanvasOutcomeResultsResponse>(
      this.withQuery(`/api/v1/courses/${courseId}/outcome_results`, {
        'user_ids[]': options?.user_ids,
        'outcome_ids[]': options?.outcome_ids,
        'include[]': options?.include_alignments ? ['alignments'] : undefined,
        include_hidden: options?.include_hidden,
      }),
    )
  }

  async getOutcomeRollups(
    courseId: number,
    options?: {
      aggregate?: 'course'
      aggregate_stat?: 'mean' | 'median'
      user_ids?: Array<number | string>
      outcome_ids?: number[]
      include_courses?: boolean
      exclude?: Array<'missing_user_rollups' | 'missing_outcome_results'>
      sort_by?: 'student' | 'outcome'
      sort_outcome_id?: number
      sort_order?: 'asc' | 'desc'
      add_defaults?: boolean
    },
  ): Promise<CanvasOutcomeRollupsResponse> {
    return this.client.request<CanvasOutcomeRollupsResponse>(
      this.withQuery(`/api/v1/courses/${courseId}/outcome_rollups`, {
        aggregate: options?.aggregate,
        aggregate_stat: options?.aggregate_stat,
        'user_ids[]': options?.user_ids,
        'outcome_ids[]': options?.outcome_ids,
        'include[]': options?.include_courses ? ['courses'] : undefined,
        'exclude[]': options?.exclude,
        sort_by: options?.sort_by,
        sort_outcome_id: options?.sort_outcome_id,
        sort_order: options?.sort_order,
        add_defaults: options?.add_defaults,
      }),
    )
  }

  async getOutcomeContributingScores(
    courseId: number,
    outcomeId: number,
    options?: {
      user_ids?: Array<number | string>
      only_assignment_alignments?: boolean
      show_unpublished_assignments?: boolean
    },
  ): Promise<CanvasOutcomeContributingScoresResponse> {
    return this.client.request<CanvasOutcomeContributingScoresResponse>(
      this.withQuery(`/api/v1/courses/${courseId}/outcomes/${outcomeId}/contributing_scores`, {
        'user_ids[]': options?.user_ids,
        only_assignment_alignments: options?.only_assignment_alignments,
        show_unpublished_assignments: options?.show_unpublished_assignments,
      }),
    )
  }

  async getOutcomeMasteryDistribution(
    courseId: number,
    options?: {
      exclude?: Array<'missing_user_rollups' | 'missing_outcome_results'>
      outcome_ids?: number[]
      student_ids?: Array<number | string>
      include_alignment_distributions?: boolean
      only_assignment_alignments?: boolean
      show_unpublished_assignments?: boolean
      add_defaults?: boolean
    },
  ): Promise<CanvasOutcomeMasteryDistributionResponse> {
    return this.client.request<CanvasOutcomeMasteryDistributionResponse>(
      this.withQuery(`/api/v1/courses/${courseId}/outcome_mastery_distribution`, {
        'exclude[]': options?.exclude,
        'outcome_ids[]': options?.outcome_ids,
        'student_ids[]': options?.student_ids,
        'include[]': options?.include_alignment_distributions
          ? ['alignment_distributions']
          : undefined,
        only_assignment_alignments: options?.only_assignment_alignments,
        show_unpublished_assignments: options?.show_unpublished_assignments,
        add_defaults: options?.add_defaults,
      }),
    )
  }

  private buildContextPath(
    contextType: CanvasOutcomeContextType,
    contextId: number,
    suffix: ContextPathSuffix = 'root_outcome_group',
  ): string {
    const segment = contextType === 'account' ? 'accounts' : 'courses'
    return `/api/v1/${segment}/${contextId}/${suffix}`
  }

  private withQuery(
    endpoint: string,
    params: Record<string, string | number | boolean | Array<string | number> | undefined>,
  ): string {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) searchParams.append(key, String(item))
        continue
      }
      searchParams.set(key, String(value))
    }

    const query = searchParams.toString()
    return query ? `${endpoint}?${query}` : endpoint
  }
}
