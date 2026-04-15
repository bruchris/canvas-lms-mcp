import { CanvasHttpClient } from './client'
import type { CanvasClientConfig } from './types'
import { CoursesModule } from './courses'
import { AssignmentsModule } from './assignments'
import { SubmissionsModule } from './submissions'
import { RubricsModule } from './rubrics'
import { QuizzesModule } from './quizzes'
import { FilesModule } from './files'
import { UsersModule } from './users'
import { GroupsModule } from './groups'
import { EnrollmentsModule } from './enrollments'
import { DiscussionsModule } from './discussions'
import { ModulesModule } from './modules'
import { PagesModule } from './pages'
import { CalendarModule } from './calendar'
import { ConversationsModule } from './conversations'
import { PeerReviewsModule } from './peer-reviews'

export class CanvasClient {
  private client: CanvasHttpClient
  courses: CoursesModule
  assignments: AssignmentsModule
  submissions: SubmissionsModule
  rubrics: RubricsModule
  quizzes: QuizzesModule
  files: FilesModule
  users: UsersModule
  groups: GroupsModule
  enrollments: EnrollmentsModule
  discussions: DiscussionsModule
  modules: ModulesModule
  pages: PagesModule
  calendar: CalendarModule
  conversations: ConversationsModule
  peerReviews: PeerReviewsModule

  constructor(config: CanvasClientConfig) {
    this.client = new CanvasHttpClient(config)
    this.courses = new CoursesModule(this.client)
    this.assignments = new AssignmentsModule(this.client)
    this.submissions = new SubmissionsModule(this.client)
    this.rubrics = new RubricsModule(this.client)
    this.quizzes = new QuizzesModule(this.client)
    this.files = new FilesModule(this.client)
    this.users = new UsersModule(this.client)
    this.groups = new GroupsModule(this.client)
    this.enrollments = new EnrollmentsModule(this.client)
    this.discussions = new DiscussionsModule(this.client)
    this.modules = new ModulesModule(this.client)
    this.pages = new PagesModule(this.client)
    this.calendar = new CalendarModule(this.client)
    this.conversations = new ConversationsModule(this.client)
    this.peerReviews = new PeerReviewsModule(this.client)
  }
}

export { CanvasHttpClient, CanvasApiError } from './client'
export type * from './types'
