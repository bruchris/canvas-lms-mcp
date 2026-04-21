import type { ToolAudience } from '../tools/types'

export interface WorkflowCatalogEntry {
  id: string
  title: string
  description: string
  primaryAudience: ToolAudience
  status: 'proposed' | 'available'
  documentationPath: string
  relatedTools: string[]
}

export const workflowCatalog: readonly WorkflowCatalogEntry[] = [
  {
    id: 'educator-assignment-review',
    title: 'Educator Assignment Review',
    description: 'Review an assignment, inspect submissions, apply grades, and leave feedback.',
    primaryAudience: 'educator',
    status: 'available',
    documentationPath: 'docs/workflows/educator-assignment-review.md',
    relatedTools: [
      'list_assignments',
      'get_assignment',
      'list_submissions',
      'get_submission',
      'get_rubric',
      'get_rubric_assessment',
      'grade_submission',
      'comment_on_submission',
      'submit_rubric_assessment',
    ],
  },
  {
    id: 'student-weekly-planning',
    title: 'Student Weekly Planning',
    description:
      'Review dashboard items, upcoming deadlines, and current course load for weekly planning.',
    primaryAudience: 'student',
    status: 'available',
    documentationPath: 'docs/workflows/student-weekly-planning.md',
    relatedTools: [
      'get_dashboard_cards',
      'get_todo_items',
      'get_upcoming_events',
      'get_my_upcoming_assignments',
      'get_my_courses',
      'get_my_grades',
    ],
  },
]

export const toolAudienceOverrides: Readonly<Record<string, ToolAudience>> = {
  create_course: 'educator',
  update_course: 'educator',
  list_assignments: 'shared',
  get_assignment: 'shared',
  list_assignment_groups: 'shared',
  list_quizzes: 'shared',
  get_quiz: 'shared',
  list_quiz_questions: 'shared',
  list_files: 'shared',
  list_folders: 'shared',
  get_file: 'shared',
  get_profile: 'shared',
  list_groups: 'student',
  list_group_members: 'student',
  list_discussions: 'shared',
  get_discussion: 'shared',
  list_announcements: 'shared',
  list_modules: 'shared',
  get_module: 'shared',
  list_module_items: 'shared',
  list_pages: 'shared',
  get_page: 'shared',
  list_calendar_events: 'shared',
  list_conversations: 'shared',
  get_conversation: 'shared',
  get_conversation_unread_count: 'shared',
  send_conversation: 'shared',
  list_peer_reviews: 'student',
  get_submission_peer_reviews: 'student',
  create_peer_review: 'educator',
  delete_peer_review: 'educator',
}
