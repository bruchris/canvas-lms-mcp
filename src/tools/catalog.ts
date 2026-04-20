import type { CanvasClient } from '../canvas'
import { accountTools } from './accounts'
import { analyticsTools } from './analytics'
import { assignmentTools } from './assignments'
import { calendarTools } from './calendar'
import { conversationTools } from './conversations'
import { courseTools } from './courses'
import { dashboardTools } from './dashboard'
import { discussionTools } from './discussions'
import { enrollmentTools } from './enrollments'
import { fileTools } from './files'
import { groupTools } from './groups'
import { healthTools } from './health'
import { moduleTools } from './modules'
import { outcomeTools } from './outcomes'
import { pageTools } from './pages'
import { peerReviewTools } from './peer-reviews'
import { quizTools } from './quizzes'
import { rubricTools } from './rubrics'
import { studentTools } from './student'
import { submissionTools } from './submissions'
import type { ToolAudience, ToolDefinition } from './types'
import { userTools } from './users'

export interface ToolDomainRegistration {
  domain: string
  defaultPrimaryAudience: ToolAudience
  getTools: (canvas: CanvasClient) => ToolDefinition[]
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
    domain: 'files',
    defaultPrimaryAudience: 'shared',
    getTools: fileTools,
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
    domain: 'dashboard',
    defaultPrimaryAudience: 'student',
    getTools: dashboardTools,
  },
]
