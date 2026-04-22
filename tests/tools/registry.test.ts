import { describe, it, expect } from 'vitest'
import { registerAllTools, getAllTools } from '../../src/tools'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'

function buildFullMockCanvas(): CanvasClient {
  return {
    courses: {
      list: async () => [],
      get: async () => ({}),
      getSyllabus: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
    assignments: {
      list: async () => [],
      get: async () => ({}),
      listGroups: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => undefined,
    },
    submissions: {
      list: async () => [],
      get: async () => ({}),
      grade: async () => ({}),
      comment: async () => ({}),
      listMy: async () => [],
    },
    rubrics: {
      list: async () => [],
      get: async () => ({}),
      getAssessment: async () => ({}),
      submitAssessment: async () => ({}),
    },
    quizzes: {
      list: async () => [],
      get: async () => ({}),
      listSubmissions: async () => [],
      listQuestions: async () => [],
      getSubmissionAnswers: async () => [],
      scoreQuestion: async () => {},
    },
    files: {
      list: async () => [],
      listFolders: async () => [],
      get: async () => ({}),
      upload: async () => ({}),
      delete: async () => undefined,
    },
    gradebookHistory: {
      listDays: async () => [],
      getDay: async () => [],
      listSubmissions: async () => [],
      getFeed: async () => [],
    },
    users: {
      listStudents: async () => [],
      get: async () => ({}),
      getProfile: async () => ({}),
      searchUsers: async () => [],
      listCourseUsers: async () => [],
      getUpcomingAssignments: async () => [],
    },
    groups: { list: async () => [], listMembers: async () => [] },
    enrollments: {
      list: async () => [],
      enroll: async () => ({}),
      remove: async () => ({}),
      listMyGrades: async () => [],
    },
    discussions: {
      list: async () => [],
      get: async () => ({}),
      listAnnouncements: async () => [],
      postEntry: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => undefined,
    },
    modules: {
      list: async () => [],
      get: async () => ({}),
      listItems: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      createItem: async () => ({}),
    },
    pages: {
      list: async () => [],
      get: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => undefined,
    },
    calendar: {
      list: async () => [],
      createEvent: async () => ({}),
      updateEvent: async () => ({}),
    },
    conversations: {
      list: async () => [],
      get: async () => ({}),
      getUnreadCount: async () => ({ unread_count: 0 }),
      send: async () => [],
    },
    peerReviews: {
      listForAssignment: async () => [],
      listForSubmission: async () => [],
      create: async () => ({}),
      delete: async () => undefined,
    },
    accounts: {
      get: async () => ({}),
      list: async () => [],
      listSubAccounts: async () => [],
      listCourses: async () => [],
      listUsers: async () => [],
      getReports: async () => [],
    },
    analytics: {
      searchContentType: async () => [],
      getCourseActivity: async () => [],
      getStudentActivity: async () => ({}),
      getCourseActivityStream: async () => [],
    },
    outcomes: {
      getRootOutcomeGroup: async () => ({}),
      listOutcomeGroups: async () => [],
      listOutcomeGroupLinks: async () => [],
      getOutcomeGroup: async () => ({}),
      listGroupOutcomes: async () => [],
      listGroupSubgroups: async () => [],
      getOutcome: async () => ({}),
      getOutcomeAlignments: async () => [],
      getOutcomeResults: async () => ({ outcome_results: [] }),
      getOutcomeRollups: async () => ({ rollups: [] }),
      getOutcomeContributingScores: async () => ({ scores: [] }),
      getOutcomeMasteryDistribution: async () => ({ outcomes: [] }),
    },
    dashboard: {
      getDashboardCards: async () => [],
      getTodoItems: async () => [],
      getUpcomingEvents: async () => [],
      getMissingSubmissions: async () => [],
    },
  } as unknown as CanvasClient
}

describe('getAllTools', () => {
  it('returns an array of tool definitions', () => {
    const tools = getAllTools(buildFullMockCanvas())
    expect(Array.isArray(tools)).toBe(true)
  })

  it('returns all 104 tools across all domains', () => {
    const tools = getAllTools(buildFullMockCanvas())
    const names = tools.map((t) => t.name)

    // Health (1)
    expect(names).toContain('health_check')
    // Courses (5)
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
    expect(names).toContain('create_course')
    expect(names).toContain('update_course')
    // Assignments (6)
    expect(names).toContain('list_assignments')
    expect(names).toContain('get_assignment')
    expect(names).toContain('list_assignment_groups')
    expect(names).toContain('create_assignment')
    expect(names).toContain('update_assignment')
    expect(names).toContain('delete_assignment')
    // Submissions (4)
    expect(names).toContain('list_submissions')
    expect(names).toContain('get_submission')
    expect(names).toContain('grade_submission')
    expect(names).toContain('comment_on_submission')
    // Rubrics (4)
    expect(names).toContain('list_rubrics')
    expect(names).toContain('get_rubric')
    expect(names).toContain('get_rubric_assessment')
    expect(names).toContain('submit_rubric_assessment')
    // Quizzes (6)
    expect(names).toContain('list_quizzes')
    expect(names).toContain('get_quiz')
    expect(names).toContain('list_quiz_submissions')
    expect(names).toContain('list_quiz_questions')
    expect(names).toContain('get_quiz_submission_answers')
    expect(names).toContain('score_quiz_question')
    // Files (5)
    expect(names).toContain('list_files')
    expect(names).toContain('list_folders')
    expect(names).toContain('get_file')
    expect(names).toContain('upload_file')
    expect(names).toContain('delete_file')
    // Gradebook History (4)
    expect(names).toContain('list_gradebook_history_days')
    expect(names).toContain('get_gradebook_history_day')
    expect(names).toContain('list_gradebook_history_submissions')
    expect(names).toContain('get_gradebook_history_feed')
    // Users (5)
    expect(names).toContain('list_students')
    expect(names).toContain('get_user')
    expect(names).toContain('get_profile')
    expect(names).toContain('search_users')
    expect(names).toContain('list_course_users')
    // Groups (2)
    expect(names).toContain('list_groups')
    expect(names).toContain('list_group_members')
    // Enrollments (3)
    expect(names).toContain('list_enrollments')
    expect(names).toContain('enroll_user')
    expect(names).toContain('remove_enrollment')
    // Discussions (7)
    expect(names).toContain('list_discussions')
    expect(names).toContain('get_discussion')
    expect(names).toContain('list_announcements')
    expect(names).toContain('post_discussion_entry')
    expect(names).toContain('create_discussion')
    expect(names).toContain('update_discussion')
    expect(names).toContain('delete_discussion')
    // Modules (6)
    expect(names).toContain('list_modules')
    expect(names).toContain('get_module')
    expect(names).toContain('list_module_items')
    expect(names).toContain('create_module')
    expect(names).toContain('update_module')
    expect(names).toContain('create_module_item')
    // Pages (5)
    expect(names).toContain('list_pages')
    expect(names).toContain('get_page')
    expect(names).toContain('create_page')
    expect(names).toContain('update_page')
    expect(names).toContain('delete_page')
    // Calendar (3)
    expect(names).toContain('list_calendar_events')
    expect(names).toContain('create_calendar_event')
    expect(names).toContain('update_calendar_event')
    // Conversations (4)
    expect(names).toContain('list_conversations')
    expect(names).toContain('get_conversation')
    expect(names).toContain('get_conversation_unread_count')
    expect(names).toContain('send_conversation')
    // Peer Reviews (4)
    expect(names).toContain('list_peer_reviews')
    expect(names).toContain('get_submission_peer_reviews')
    expect(names).toContain('create_peer_review')
    expect(names).toContain('delete_peer_review')
    // Accounts (6)
    expect(names).toContain('get_account')
    expect(names).toContain('list_accounts')
    expect(names).toContain('list_sub_accounts')
    expect(names).toContain('list_account_courses')
    expect(names).toContain('list_account_users')
    expect(names).toContain('get_account_reports')
    // Analytics & Search (4)
    expect(names).toContain('search_course_content')
    expect(names).toContain('get_course_analytics')
    expect(names).toContain('get_student_analytics')
    expect(names).toContain('get_course_activity_stream')
    // Outcomes (12)
    expect(names).toContain('get_root_outcome_group')
    expect(names).toContain('list_outcome_groups')
    expect(names).toContain('list_outcome_group_links')
    expect(names).toContain('get_outcome_group')
    expect(names).toContain('list_outcome_group_outcomes')
    expect(names).toContain('list_outcome_group_subgroups')
    expect(names).toContain('get_outcome')
    expect(names).toContain('get_outcome_alignments')
    expect(names).toContain('get_outcome_results')
    expect(names).toContain('get_outcome_rollups')
    expect(names).toContain('get_outcome_contributing_scores')
    expect(names).toContain('get_outcome_mastery_distribution')
    // Student (4)
    expect(names).toContain('get_my_courses')
    expect(names).toContain('get_my_grades')
    expect(names).toContain('get_my_submissions')
    expect(names).toContain('get_my_upcoming_assignments')
    // Dashboard (4)
    expect(names).toContain('get_dashboard_cards')
    expect(names).toContain('get_todo_items')
    expect(names).toContain('get_upcoming_events')
    expect(names).toContain('get_missing_submissions')

    expect(tools).toHaveLength(104)
  })

  it('all tools have openWorldHint: true', () => {
    const tools = getAllTools(buildFullMockCanvas())
    for (const tool of tools) {
      expect(tool.annotations.openWorldHint).toBe(true)
    }
  })

  it('write tools have destructiveHint: true', () => {
    const writeToolNames = [
      'create_assignment',
      'update_assignment',
      'delete_assignment',
      'grade_submission',
      'comment_on_submission',
      'submit_rubric_assessment',
      'score_quiz_question',
      'post_discussion_entry',
      'create_discussion',
      'update_discussion',
      'delete_discussion',
      'send_conversation',
      'create_peer_review',
      'delete_peer_review',
      'create_module',
      'update_module',
      'create_module_item',
      'create_page',
      'update_page',
      'delete_page',
      'enroll_user',
      'remove_enrollment',
      'upload_file',
      'delete_file',
      'create_calendar_event',
      'update_calendar_event',
      'create_course',
      'update_course',
    ]
    const tools = getAllTools(buildFullMockCanvas())
    for (const name of writeToolNames) {
      const tool = tools.find((t) => t.name === name)!
      expect(tool.annotations.destructiveHint).toBe(true)
    }
  })

  it('read tools have readOnlyHint: true', () => {
    const writeToolNames = new Set([
      'create_assignment',
      'update_assignment',
      'delete_assignment',
      'grade_submission',
      'comment_on_submission',
      'submit_rubric_assessment',
      'score_quiz_question',
      'post_discussion_entry',
      'create_discussion',
      'update_discussion',
      'delete_discussion',
      'send_conversation',
      'create_peer_review',
      'delete_peer_review',
      'create_module',
      'update_module',
      'create_module_item',
      'create_page',
      'update_page',
      'delete_page',
      'enroll_user',
      'remove_enrollment',
      'upload_file',
      'delete_file',
      'create_calendar_event',
      'update_calendar_event',
      'create_course',
      'update_course',
    ])
    const tools = getAllTools(buildFullMockCanvas())
    for (const tool of tools) {
      if (!writeToolNames.has(tool.name)) {
        expect(tool.annotations.readOnlyHint).toBe(true)
      }
    }
  })
})

describe('registerAllTools', () => {
  it('is a function exported from tools module', () => {
    expect(typeof registerAllTools).toBe('function')
  })

  it('registers tools on the MCP server', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    expect(() => registerAllTools(server, buildFullMockCanvas())).not.toThrow()
  })
})
