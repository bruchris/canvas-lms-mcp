/**
 * Marked-name fixture for `get_quiz_question_responses`
 * (`src/tools/quiz-question-responses.ts`).
 *
 * The tool joins five Canvas reads into a per-question view of who answered
 * what, and the only name in its output is `user_name`, resolved from a
 * `user_id -> name` map built over `canvas.users.listStudents(courseId)` and
 * pseudonymized as a whole before the join. So the marks live on the roster
 * rows, and the quiz payloads around them must stay untouched.
 *
 * **Serializer reads** (`instructure/canvas-lms@master`):
 * `lib/api/v1/user.rb#user_json` for the roster (`GET
 * /courses/:id/users?enrollment_type[]=student`, where
 * `courses_controller#users` pushes `sis_user_id` and `email` whether asked or
 * not), and `lib/api/v1/quiz_submission*.rb` for the attempts and answers,
 * none of which carries a person: a quiz submission is
 * `{ id, quiz_id, user_id, attempt, workflow_state, score, ... }` and an
 * answer is `{ id, question_id, answer, correct, ... }`.
 *
 * **The roster rows carry no `enrollments`,** which is faithful — this call
 * sends only `enrollment_type[]=student` — and it is also why they are masked:
 * `classifyRole` reads an absent `enrollments` as `unknown`, and unknown
 * fails closed. The tool's own comment says exactly this.
 *
 * **`quiz.title` and `question_text` are decoys.** They are course content
 * next to a masked name, and must come back unchanged.
 *
 * **`quiz_type` must be a Classic type.** The handler rejects New Quizzes
 * before any further read, so a `quizzes.next` or `assignment` mismatch would
 * make the fixture throw rather than sweep.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

export const quizFixtures: Record<string, MarkedNameFixture> = {
  get_quiz_question_responses: {
    args: { course_id: '7', quiz_id: '500' },
    buildCanvas: () =>
      ({
        quizzes: {
          get: async () => ({
            id: '500',
            title: 'Fjord formation check',
            quiz_type: 'assignment',
            assignment_id: '88',
            points_possible: 10,
            question_count: 1,
            due_at: '2026-10-26T23:59:00Z',
            published: true,
          }),
          listQuestions: async () => [
            {
              id: '600',
              quiz_id: '500',
              position: 1,
              question_name: 'Q1',
              question_type: 'multiple_choice_question',
              question_text: '<p>Which process carves a fjord?</p>',
              points_possible: 10,
              answers: [
                { id: '7001', text: 'Glacial erosion', weight: 100 },
                { id: '7002', text: 'Tidal scour', weight: 0 },
              ],
            },
          ],
          listSubmissions: async () => [
            {
              id: '8001',
              quiz_id: '500',
              user_id: '101',
              attempt: 1,
              workflow_state: 'complete',
              score: 10,
              finished_at: '2026-10-25T10:20:00Z',
            },
          ],
          getSubmissionAnswers: async () => [
            {
              id: '600',
              question_id: '600',
              quiz_id: '500',
              answer: '7001',
              correct: true,
              points: 10,
              question_name: 'Q1',
            },
          ],
          listSubmissionQuestions: async () => [
            { id: '600', question_id: '600', answer: '7001', correct: true },
          ],
        },
        users: {
          listStudents: async () => [
            {
              id: '101',
              name: 'REAL_NAME_1',
              created_at: '2026-01-05T08:00:00Z',
              sortable_name: 'REAL_NAME_2',
              short_name: 'REAL_NAME_3',
              sis_user_id: 'SIS-4411',
              email: 'REAL_NAME_4@school.example',
            },
          ],
        },
        submissions: {
          list: async () => [
            {
              id: '9001',
              assignment_id: '88',
              user_id: '101',
              attempt: 1,
              workflow_state: 'graded',
              score: 10,
              submission_history: [
                {
                  id: '9001',
                  attempt: 1,
                  submission_data: [
                    { question_id: '600', text: 'Glacial erosion', correct: true, points: 10 },
                  ],
                },
              ],
            },
          ],
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
