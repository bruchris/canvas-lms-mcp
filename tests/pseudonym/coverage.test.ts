import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { PSEUDONYMIZER_WRAPPED_TOOLS } from '../../src/pseudonym/coverage'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { getAllTools } from '../../src/tools'

// Mirror of the catalog list — kept in sync with src/pseudonym/coverage.ts so
// that adding a PII-bearing tool requires touching BOTH files. If a future
// developer wires up a new tool that returns CanvasUser / participants /
// user_name and forgets to update either list, CI fails here.
const EXPECTED_PII_BEARING_TOOLS = new Set([
  'list_students',
  'get_user',
  'search_users',
  'list_course_users',
  'list_account_users',
  'list_enrollments',
  'list_course_enrollments',
  'list_submissions',
  'get_submission',
  'list_course_submission_files',
  'list_submissions_awaiting_grading',
  'list_conversations',
  'get_conversation',
  'list_gradebook_history_submissions',
  'get_gradebook_history_feed',
  'get_outcome_results',
  'get_outcome_rollups',
  'list_group_members',
  'list_submission_comments_needing_attention',
  'list_students_needing_attention',
  'explain_grade',
  'get_my_submission_feedback',
  'get_quiz_question_responses',
])

function buildMinimalCanvas(): CanvasClient {
  const noop = async () => ({})
  const list = async () => []
  return {
    courses: { list, get: noop, getSyllabus: noop, create: noop, update: noop },
    assignments: { list, get: noop, listGroups: list, create: noop, update: noop, delete: noop },
    submissions: {
      list,
      get: noop,
      grade: noop,
      comment: noop,
      listMy: list,
      listForStudents: list,
    },
    rubrics: { list, get: noop, getAssessment: noop, submitAssessment: noop, create: noop },
    quizzes: {
      list,
      get: noop,
      listSubmissions: list,
      listQuestions: list,
      getSubmissionAnswers: list,
      scoreQuestion: noop,
      getSubmissionEvents: list,
    },
    files: { list, listFolders: list, get: noop, upload: noop, delete: noop, download: noop },
    gradebookHistory: { listDays: list, getDay: list, listSubmissions: list, getFeed: list },
    users: {
      listStudents: list,
      get: noop,
      getProfile: noop,
      searchUsers: list,
      listCourseUsers: list,
      getUpcomingAssignments: list,
    },
    groups: { list, listMembers: list },
    enrollments: { list, listForCourse: list, enroll: noop, remove: noop, listMyGrades: list },
    discussions: {
      list,
      get: noop,
      listAnnouncements: list,
      postEntry: noop,
      create: noop,
      update: noop,
      delete: noop,
    },
    modules: {
      list,
      get: noop,
      listItems: list,
      getCourseStructure: async () => ({
        modules: [],
        summary: { total_modules: 0, total_items: 0, items_by_type: {} },
      }),
      create: noop,
      update: noop,
      createItem: noop,
    },
    pages: { list, get: noop, create: noop, update: noop, delete: noop },
    calendar: { list, createEvent: noop, updateEvent: noop },
    conversations: {
      list,
      get: noop,
      getUnreadCount: async () => ({ unread_count: 0 }),
      send: list,
    },
    peerReviews: { listForAssignment: list, listForSubmission: list, create: noop, delete: noop },
    accounts: {
      get: noop,
      list,
      listSubAccounts: list,
      listCourses: list,
      listUsers: list,
      getReports: list,
      listNotifications: list,
    },
    analytics: {
      searchContentType: list,
      getCourseActivity: list,
      getStudentActivity: noop,
      getCourseActivityStream: list,
      getStudentSummaries: list,
    },
    outcomes: {
      getRootOutcomeGroup: noop,
      listOutcomeGroups: list,
      listOutcomeGroupLinks: list,
      getOutcomeGroup: noop,
      listGroupOutcomes: list,
      listGroupSubgroups: list,
      getOutcome: noop,
      getOutcomeAlignments: list,
      getOutcomeResults: async () => ({ outcome_results: [] }),
      getOutcomeRollups: async () => ({ rollups: [] }),
      getOutcomeContributingScores: async () => ({ scores: [] }),
      getOutcomeMasteryDistribution: async () => ({ outcomes: [] }),
    },
    dashboard: {
      getDashboardCards: list,
      getTodoItems: list,
      getUpcomingEvents: list,
      getMissingSubmissions: list,
    },
    newQuizzes: {
      create: noop,
      update: noop,
      delete: noop,
      listItems: list,
      getItem: noop,
      createItem: noop,
      updateItem: noop,
      deleteItem: noop,
    },
  } as unknown as CanvasClient
}

describe('pseudonymizer coverage lint', () => {
  it('every name in PSEUDONYMIZER_WRAPPED_TOOLS is a registered tool', () => {
    const tools = getAllTools(buildMinimalCanvas())
    const names = new Set(tools.map((t) => t.name))
    const missing = PSEUDONYMIZER_WRAPPED_TOOLS.filter((n) => !names.has(n))
    expect(missing).toEqual([])
  })

  it('PSEUDONYMIZER_WRAPPED_TOOLS matches the expected PII-bearing-tool set exactly', () => {
    // Both sides hand-maintained; mismatch = a tool was added/wrapped without
    // updating the other list (or vice versa).
    const wrapped = new Set(PSEUDONYMIZER_WRAPPED_TOOLS)
    const onlyInWrap = [...wrapped].filter((n) => !EXPECTED_PII_BEARING_TOOLS.has(n))
    const onlyInExpected = [...EXPECTED_PII_BEARING_TOOLS].filter((n) => !wrapped.has(n))
    expect({ onlyInWrap, onlyInExpected }).toEqual({ onlyInWrap: [], onlyInExpected: [] })
  })

  it('resolve_pseudonym is only registered when reverse lookup env is on', () => {
    const canvas = buildMinimalCanvas()

    const off = new Pseudonymizer({ baseUrl: 'https://h.example/api/v1', env: {} })
    expect(getAllTools(canvas, off).find((t) => t.name === 'resolve_pseudonym')).toBeUndefined()

    const partial = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' },
    })
    expect(getAllTools(canvas, partial).find((t) => t.name === 'resolve_pseudonym')).toBeUndefined()

    const on = new Pseudonymizer({
      baseUrl: 'https://h.example/api/v1',
      env: {
        CANVAS_PSEUDONYMIZE_STUDENTS: 'true',
        CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP: 'true',
      },
    })
    expect(getAllTools(canvas, on).find((t) => t.name === 'resolve_pseudonym')).toBeDefined()
  })
})
