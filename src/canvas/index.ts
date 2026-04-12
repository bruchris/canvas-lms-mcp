import { CanvasHttpClient } from './client'
import type { CanvasClientConfig } from './types'
import { CoursesModule } from './courses'

export class CanvasClient {
  private client: CanvasHttpClient
  courses: CoursesModule

  // Additional modules will be added here as implemented:
  // assignments, submissions, rubrics, quizzes, files, users,
  // groups, enrollments, discussions, modules, pages, calendar, conversations

  constructor(config: CanvasClientConfig) {
    this.client = new CanvasHttpClient(config)
    this.courses = new CoursesModule(this.client)
  }
}

export { CanvasHttpClient, CanvasApiError } from './client'
export type * from './types'
