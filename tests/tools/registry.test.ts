import { describe, it, expect } from 'vitest'
import { registerAllTools, getAllTools } from '../../src/tools'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from '../../src/canvas'

function buildFullMockCanvas(): CanvasClient {
  return {
    courses: { list: async () => [], get: async () => ({}), getSyllabus: async () => null },
    assignments: { list: async () => [], get: async () => ({}), listGroups: async () => [] },
    submissions: {
      list: async () => [],
      get: async () => ({}),
      grade: async () => ({}),
      comment: async () => ({}),
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
    files: { list: async () => [], listFolders: async () => [], get: async () => ({}) },
    users: { listStudents: async () => [], get: async () => ({}), getProfile: async () => ({}) },
    groups: { list: async () => [], listMembers: async () => [] },
    enrollments: { list: async () => [] },
    discussions: {
      list: async () => [],
      get: async () => ({}),
      listAnnouncements: async () => [],
      postEntry: async () => ({}),
    },
    modules: { list: async () => [], get: async () => ({}), listItems: async () => [] },
    pages: { list: async () => [], get: async () => ({}) },
    calendar: { list: async () => [] },
    conversations: { list: async () => [], send: async () => [] },
    peerReviews: {
      listForAssignment: async () => [],
      listForSubmission: async () => [],
      create: async () => ({}),
      delete: async () => ({}),
    },
  } as unknown as CanvasClient
}

describe('getAllTools', () => {
  it('returns an array of tool definitions', () => {
    const tools = getAllTools(buildFullMockCanvas())
    expect(Array.isArray(tools)).toBe(true)
  })

  it('returns all 42 tools across all domains', () => {
    const tools = getAllTools(buildFullMockCanvas())
    const names = tools.map((t) => t.name)

    // Health (1)
    expect(names).toContain('health_check')
    // Courses (3)
    expect(names).toContain('list_courses')
    expect(names).toContain('get_course')
    expect(names).toContain('get_syllabus')
    // Assignments (3)
    expect(names).toContain('list_assignments')
    expect(names).toContain('get_assignment')
    expect(names).toContain('list_assignment_groups')
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
    // Files (3)
    expect(names).toContain('list_files')
    expect(names).toContain('list_folders')
    expect(names).toContain('get_file')
    // Users (3)
    expect(names).toContain('list_students')
    expect(names).toContain('get_user')
    expect(names).toContain('get_profile')
    // Groups (2)
    expect(names).toContain('list_groups')
    expect(names).toContain('list_group_members')
    // Enrollments (1)
    expect(names).toContain('list_enrollments')
    // Discussions (4)
    expect(names).toContain('list_discussions')
    expect(names).toContain('get_discussion')
    expect(names).toContain('list_announcements')
    expect(names).toContain('post_discussion_entry')
    // Modules (3)
    expect(names).toContain('list_modules')
    expect(names).toContain('get_module')
    expect(names).toContain('list_module_items')
    // Pages (2)
    expect(names).toContain('list_pages')
    expect(names).toContain('get_page')
    // Calendar (1)
    expect(names).toContain('list_calendar_events')
    // Conversations (2)
    expect(names).toContain('list_conversations')
    expect(names).toContain('send_conversation')
    // Peer Reviews (4)
    expect(names).toContain('list_peer_reviews')
    expect(names).toContain('get_submission_peer_reviews')
    expect(names).toContain('create_peer_review')
    expect(names).toContain('delete_peer_review')

    expect(tools).toHaveLength(46)
  })

  it('all tools have openWorldHint: true', () => {
    const tools = getAllTools(buildFullMockCanvas())
    for (const tool of tools) {
      expect(tool.annotations.openWorldHint).toBe(true)
    }
  })

  it('write tools have destructiveHint: true', () => {
    const writeToolNames = [
      'grade_submission',
      'comment_on_submission',
      'submit_rubric_assessment',
      'score_quiz_question',
      'post_discussion_entry',
      'send_conversation',
      'create_peer_review',
      'delete_peer_review',
    ]
    const tools = getAllTools(buildFullMockCanvas())
    for (const name of writeToolNames) {
      const tool = tools.find((t) => t.name === name)!
      expect(tool.annotations.destructiveHint).toBe(true)
    }
  })

  it('read tools have readOnlyHint: true', () => {
    const writeToolNames = new Set([
      'grade_submission',
      'comment_on_submission',
      'submit_rubric_assessment',
      'score_quiz_question',
      'post_discussion_entry',
      'send_conversation',
      'create_peer_review',
      'delete_peer_review',
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
