/**
 * Marked-name fixture for `submit_rubric_assessment` (`src/tools/rubrics.ts`).
 *
 * **Serializer read** (`instructure/canvas-lms@master`):
 * `app/controllers/rubric_assessments_controller.rb#update`. The response is
 * `@assessment.as_json(methods: %i[ratings assessor_name
 * related_group_submissions_and_assessments], include: artifact_includes)`,
 * and for a `Submission` artifact `artifact_includes` is
 * `{ artifact: Submission.json_serialization_full_parameters(except:
 * [:submission_comments]), rubric_association: {} }`. Three facts follow, and
 * all three shape this fixture:
 *
 * 1. **`assessor_name` is only on THIS response.** The narrower
 *    `API_ALLOWED_RUBRIC_ASSESSMENT_OUTPUT_FIELDS` allowlist behind
 *    `get_rubric` / `get_rubric_assessment` emits `assessor_id` and no name,
 *    which is why those two tools are not in the wrapped set. Marked here.
 * 2. **`related_group_submissions_and_assessments` fans out other students.**
 *    On a group-graded assignment it carries every OTHER group member's
 *    submission plus each of THEIR rubric assessments, each with its own
 *    `assessor_name` — the #471 leak. Marked.
 * 3. **The artifact has no nested `user`.**
 *    `json_serialization_full_parameters` is
 *    `methods: %i[submission_history attachments entered_score entered_grade
 *    word_count]`, `include: { quiz_submission: {} }` — no `user` anywhere. So
 *    `artifact` carries no person object, and nothing in it warms the course
 *    map. Its `submission_comments` are then re-attached by the controller
 *    through `anonymous_moderated_submission_comments_json`, whose
 *    `ANONYMOUS_MODERATED_JSON_ATTRIBUTES` list has **no `author` key** — so
 *    an artifact comment carries `author_name` alone, unlike the
 *    `submission_comment_json` shape the submissions fixtures use.
 *
 * Because of (3) the artifact's only comment here is the recorded grader's,
 * which is staff and stays UNMARKED. A student comment on the artifact would
 * not be masked, for the same unwarmed-map reason documented in
 * `submissions.ts`; that is a behaviour question raised in the BRU-3257 task
 * notes, not one this fixture decides.
 *
 * The `data[].comments` strings are criterion feedback the assessor wrote, not
 * names, and `ratings[].description` is rubric wording. Unmarked.
 */
import type { CanvasClient } from '../../../src/canvas'
import { buildSweepPseudonymizer, type MarkedNameFixture } from './sweep'

export const rubricFixtures: Record<string, MarkedNameFixture> = {
  // POST /api/v1/courses/:course_id/rubric_associations/:id/rubric_assessments
  submit_rubric_assessment: {
    args: {
      course_id: '7',
      association_id: '55',
      data: [{ criterion_id: 'crit_1', points: 9, comments: 'Clear thesis.' }],
    },
    buildCanvas: () =>
      ({
        rubrics: {
          submitAssessment: async () => ({
            id: '7001',
            rubric_id: '55',
            rubric_association_id: '55',
            artifact_type: 'Submission',
            artifact_id: '9001',
            artifact_attempt: 1,
            assessment_type: 'peer_review',
            score: 18,
            data: [{ criterion_id: 'crit_1', points: 9, comments: 'Clear thesis.' }],
            ratings: [{ id: 'rat_1', description: 'Exceeds expectations', points: 9 }],
            // A peer-reviewing student, not a grader:
            // `RubricAssociation#user_can_assess_for?` permits it, so the name
            // is resolved through the fail-closed unknown-role path.
            assessor_id: '102',
            assessor_name: 'REAL_NAME_1',
            assessor_avatar_url: 'https://school.example/images/users/102',
            artifact: {
              id: '9001',
              assignment_id: '88',
              user_id: '101',
              attempt: 1,
              score: 18,
              grade: '18',
              entered_score: 18,
              entered_grade: '18',
              word_count: 412,
              workflow_state: 'graded',
              submitted_at: '2026-10-27T08:55:00Z',
              graded_at: '2026-10-28T11:29:00Z',
              grader_id: '9',
              submission_history: [],
              attachments: [],
              submission_comments: [
                {
                  id: '5002',
                  attempt: 1,
                  author_id: '9',
                  author_name: 'Dr. Ingrid Holt',
                  comment: 'Good structure — tighten the conclusion.',
                  created_at: '2026-10-28T11:30:00Z',
                  draft: false,
                },
              ],
            },
            related_group_submissions_and_assessments: [
              {
                submission: { id: '9002', user_id: '103', score: 15, workflow_state: 'graded' },
                rubric_assessments: [
                  {
                    id: '7002',
                    rubric_id: '55',
                    score: 15,
                    assessor_id: '103',
                    assessor_name: 'REAL_NAME_2',
                  },
                ],
              },
            ],
          }),
        },
      }) as unknown as CanvasClient,
    buildPseudonymizer: buildSweepPseudonymizer,
  },
}
