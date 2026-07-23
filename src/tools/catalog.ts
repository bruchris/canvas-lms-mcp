import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import { accountTools } from './accounts'
import { analyticsTools } from './analytics'
import { attentionTools } from './attention'
import { assignmentTools } from './assignments'
import { assignmentOverrideTools } from './assignment-overrides'
import { calendarTools } from './calendar'
import { contentExportsTools } from './content-exports'
import { conversationTools } from './conversations'
import { courseSetupTools } from './course-setup'
import { courseTools } from './courses'
import { dashboardTools } from './dashboard'
import { discussionTools } from './discussions'
import { enrollmentTools } from './enrollments'
import { fileTools } from './files'
import { gradebookHistoryTools } from './gradebook-history'
import { gradeExplanationTools } from './grade-explanation'
import { gradingPolicyTools } from './grading-policy'
import { gradingStandardsTools } from './grading-standards'
import { groupTools } from './groups'
import { healthTools } from './health'
import { moduleTools } from './modules'
import { outcomeTools } from './outcomes'
import { pageTools } from './pages'
import { peerReviewTools } from './peer-reviews'
import { quizTools } from './quizzes'
import { quizQuestionResponseTools } from './quiz-question-responses'
import { quizAccommodationTools } from './quiz-accommodations'
import { newQuizAccommodationTools } from './new-quiz-accommodations'
import { newQuizTools } from './new-quizzes'
import { rubricTools } from './rubrics'
import { studentTools } from './student'
import { studentSearchTools } from './student-search'
import { submissionTools } from './submissions'
import { submissionFileTools } from './submission-files'
import { submissionsAwaitingGradingTools } from './submissions-awaiting-grading'
import type { ToolAudience, ToolDefinition } from './types'
import { userTools } from './users'
import { linkAuditTools } from './link-audit'

export interface ToolDomainRegistration {
  domain: string
  defaultPrimaryAudience: ToolAudience
  getTools: (canvas: CanvasClient, pseudonymizer?: Pseudonymizer) => ToolDefinition[]
}

export const toolDomainCatalog: readonly ToolDomainRegistration[] = [
  {
    domain: 'health',
    defaultPrimaryAudience: 'shared',
    getTools: healthTools,
  },
  {
    domain: 'courses',
    defaultPrimaryAudience: 'shared',
    getTools: courseTools,
  },
  {
    domain: 'assignments',
    defaultPrimaryAudience: 'educator',
    getTools: assignmentTools,
  },
  {
    domain: 'submissions',
    defaultPrimaryAudience: 'educator',
    getTools: submissionTools,
  },
  {
    domain: 'submission_files',
    defaultPrimaryAudience: 'educator',
    getTools: submissionFileTools,
  },
  {
    domain: 'submissions_awaiting_grading',
    defaultPrimaryAudience: 'educator',
    getTools: submissionsAwaitingGradingTools,
  },
  {
    domain: 'rubrics',
    defaultPrimaryAudience: 'educator',
    getTools: rubricTools,
  },
  {
    domain: 'quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: quizTools,
  },
  {
    domain: 'new_quizzes',
    defaultPrimaryAudience: 'educator',
    getTools: newQuizTools,
  },
  {
    domain: 'quiz_question_responses',
    defaultPrimaryAudience: 'educator',
    getTools: quizQuestionResponseTools,
  },
  {
    domain: 'files',
    defaultPrimaryAudience: 'shared',
    getTools: fileTools,
  },
  {
    domain: 'gradebook_history',
    defaultPrimaryAudience: 'educator',
    getTools: gradebookHistoryTools,
  },
  {
    domain: 'users',
    defaultPrimaryAudience: 'educator',
    getTools: userTools,
  },
  {
    domain: 'groups',
    defaultPrimaryAudience: 'shared',
    getTools: groupTools,
  },
  {
    domain: 'enrollments',
    defaultPrimaryAudience: 'admin',
    getTools: enrollmentTools,
  },
  {
    domain: 'discussions',
    defaultPrimaryAudience: 'shared',
    getTools: discussionTools,
  },
  {
    domain: 'modules',
    defaultPrimaryAudience: 'educator',
    getTools: moduleTools,
  },
  {
    domain: 'pages',
    defaultPrimaryAudience: 'educator',
    getTools: pageTools,
  },
  {
    domain: 'calendar',
    defaultPrimaryAudience: 'shared',
    getTools: calendarTools,
  },
  {
    domain: 'conversations',
    defaultPrimaryAudience: 'shared',
    getTools: conversationTools,
  },
  {
    domain: 'peer_reviews',
    defaultPrimaryAudience: 'shared',
    getTools: peerReviewTools,
  },
  {
    domain: 'accounts',
    defaultPrimaryAudience: 'admin',
    getTools: accountTools,
  },
  {
    domain: 'analytics',
    defaultPrimaryAudience: 'educator',
    getTools: analyticsTools,
  },
  {
    domain: 'outcomes',
    defaultPrimaryAudience: 'educator',
    getTools: outcomeTools,
  },
  {
    domain: 'student',
    defaultPrimaryAudience: 'student',
    getTools: studentTools,
  },
  {
    domain: 'student_search',
    defaultPrimaryAudience: 'educator',
    getTools: studentSearchTools,
  },
  {
    domain: 'dashboard',
    defaultPrimaryAudience: 'student',
    getTools: dashboardTools,
  },
  {
    domain: 'attention',
    defaultPrimaryAudience: 'educator',
    getTools: attentionTools,
  },
  {
    domain: 'content_exports',
    defaultPrimaryAudience: 'educator',
    getTools: contentExportsTools,
  },
  {
    domain: 'grading_standards',
    defaultPrimaryAudience: 'educator',
    getTools: gradingStandardsTools,
  },
  {
    domain: 'quiz_accommodations',
    defaultPrimaryAudience: 'educator',
    getTools: quizAccommodationTools,
  },
  {
    domain: 'new_quiz_accommodations',
    defaultPrimaryAudience: 'educator',
    getTools: newQuizAccommodationTools,
  },
  {
    domain: 'assignment_overrides',
    defaultPrimaryAudience: 'educator',
    getTools: assignmentOverrideTools,
  },
  {
    domain: 'course_setup',
    defaultPrimaryAudience: 'educator',
    getTools: courseSetupTools,
  },
  {
    domain: 'grade_explanation',
    defaultPrimaryAudience: 'shared',
    getTools: gradeExplanationTools,
  },
  {
    domain: 'grading_policy',
    defaultPrimaryAudience: 'shared',
    getTools: gradingPolicyTools,
  },
  {
    domain: 'link_audit',
    defaultPrimaryAudience: 'educator',
    getTools: linkAuditTools,
  },
]
