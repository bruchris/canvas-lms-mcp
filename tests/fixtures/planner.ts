// Hazard fixtures for `GET /planner/items`, read from Canvas's own serializer
// at pinned SHA 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c:
//
//   - `app/controllers/planner_controller.rb#planner_items` — the nine
//     collections unioned into one feed.
//   - `lib/api/v1/planner_item.rb#planner_item_json` / `#plannable_json` — the
//     per-type dispatch and the `API_PLANNABLE_FIELDS` slice that decides
//     which keys each `plannable` carries. Critically, this slice means a
//     DiscussionTopic / Announcement plannable's actual `message` text is
//     dropped entirely — only a calendar event's `description` field
//     survives the slice as free text (see `src/provenance/fields.ts`).
//
// Identifiers are canonical `CanvasId` STRINGS, not numbers, following the
// `tests/fixtures/activity-stream.ts` precedent — every response passes
// through `normalizeCanvasIds()` at the HTTP boundary.

import type { CanvasPlannerItem } from '../../src/canvas/types'

/** 1/9 — `assignment`. A graded item with a full submission status and feedback. */
export const FIXTURE_PLANNER_ASSIGNMENT: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '201',
  plannable_type: 'assignment',
  planner_override: null,
  submissions: {
    submitted: true,
    excused: false,
    graded: true,
    posted_at: '2026-10-05T10:00:00Z',
    late: false,
    missing: false,
    needs_grading: false,
    has_feedback: true,
    redo_request: false,
    feedback: { comment: 'Nice work.', is_media: false, author_name: 'Dr. Lin' },
  },
  new_activity: true,
  plannable_date: '2026-10-10T23:59:00Z',
  plannable: {
    id: '201',
    title: 'Essay 1: Trolley Problems',
    course_id: '101',
    todo_date: null,
    details: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-10-05T10:00:00Z',
    due_at: '2026-10-10T23:59:00Z',
    assignment_id: '201',
    points_possible: 20,
  },
  html_url: 'https://school.instructure.com/courses/101/assignments/201',
}

/** 2/9 — `quiz`. Ungraded, no submission. */
export const FIXTURE_PLANNER_QUIZ: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '301',
  plannable_type: 'quiz',
  planner_override: null,
  submissions: false,
  new_activity: false,
  plannable_date: '2026-10-12T23:59:00Z',
  plannable: {
    id: '301',
    title: 'Quiz 2: Consequentialism',
    course_id: '101',
    todo_date: null,
    details: null,
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T00:00:00Z',
    due_at: '2026-10-12T23:59:00Z',
    points_possible: 10,
  },
  html_url: 'https://school.instructure.com/courses/101/quizzes/301',
}

/**
 * 3/9 — `planner_note`. The caller's OWN note, no course context, and
 * deliberately NO `html_url` key — Canvas has none for individual notes
 * (`lib/api/v1/planner_item.rb`: "We don't currently have an html_url for
 * individual planner items."). `details` is the caller's own text, which is
 * why it is NOT in the provenance-fencing registry for this tool.
 */
export const FIXTURE_PLANNER_NOTE: CanvasPlannerItem = {
  plannable_id: '401',
  plannable_type: 'planner_note',
  planner_override: null,
  submissions: false,
  new_activity: false,
  plannable_date: '2026-10-08T06:00:00Z',
  plannable: {
    id: '401',
    title: 'Buy a notebook for seminar',
    todo_date: '2026-10-08T06:00:00Z',
    details: 'Pick one up before Thursday.',
    course_id: null,
    user_id: '55',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
}

/** 4/9 — `wiki_page`. */
export const FIXTURE_PLANNER_WIKI_PAGE: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '102',
  context_name: 'Calculus II',
  plannable_id: '501',
  plannable_type: 'wiki_page',
  planner_override: null,
  submissions: false,
  new_activity: false,
  plannable_date: '2026-10-09T00:00:00Z',
  plannable: {
    id: '501',
    title: 'Week 6 overview',
    course_id: '102',
    todo_date: '2026-10-09T00:00:00Z',
    details: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  html_url: 'https://school.instructure.com/courses/102/pages/week-6-overview',
}

/** 5/9 — `discussion_topic`. Ungraded, carries the unread/read fields `plannable_json` preserves. */
export const FIXTURE_PLANNER_DISCUSSION: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '601',
  plannable_type: 'discussion_topic',
  planner_override: null,
  submissions: false,
  new_activity: true,
  plannable_date: '2026-10-11T23:59:00Z',
  plannable: {
    id: '601',
    title: 'Week 6 reading questions',
    course_id: '101',
    todo_date: '2026-10-11T23:59:00Z',
    details: null,
    unread_count: 2,
    read_state: 'unread',
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
  },
  html_url: 'https://school.instructure.com/courses/101/discussion_topics/601',
}

/**
 * 6/9 — `calendar_event`. The one plannable arm whose `description` survives
 * `plannable_json`'s field slice intact — the fixture the fencing test uses.
 */
export const FIXTURE_PLANNER_CALENDAR_EVENT: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '701',
  plannable_type: 'calendar_event',
  planner_override: null,
  submissions: false,
  new_activity: false,
  plannable_date: '2026-10-13T15:00:00Z',
  plannable: {
    id: '701',
    title: 'Office hours',
    course_id: '101',
    location_name: 'Room 204',
    todo_date: null,
    details: null,
    all_day: false,
    location_address: '200 University Ave',
    description: '<p>Drop by to discuss the trolley problem essay.</p>',
    start_at: '2026-10-13T15:00:00Z',
    end_at: '2026-10-13T16:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  html_url: 'https://school.instructure.com/calendar?event_id=701',
}

/** 7/9 — `assessment_request` (a peer review). */
export const FIXTURE_PLANNER_PEER_REVIEW: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '801',
  plannable_type: 'assessment_request',
  planner_override: null,
  submissions: false,
  new_activity: false,
  plannable_date: '2026-10-14T23:59:00Z',
  plannable: {
    id: '801',
    title: 'Essay 1: Trolley Problems',
    todo_date: '2026-10-14T23:59:00Z',
    details: null,
    course_id: '101',
    workflow_state: 'assigned',
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
  },
  html_url: 'https://school.instructure.com/courses/101/assignments/201/submissions/55',
}

/** 8/9 — `sub_assignment` (a discussion checkpoint). */
export const FIXTURE_PLANNER_SUB_ASSIGNMENT: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '901',
  plannable_type: 'sub_assignment',
  planner_override: null,
  submissions: {
    submitted: false,
    excused: false,
    graded: false,
    posted_at: null,
    late: false,
    missing: true,
    needs_grading: false,
    has_feedback: false,
    redo_request: false,
  },
  new_activity: false,
  plannable_date: '2026-10-11T23:59:00Z',
  plannable: {
    id: '901',
    title: 'Week 6 reading questions: initial reply',
    course_id: '101',
    todo_date: null,
    details: null,
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
    due_at: '2026-10-11T23:59:00Z',
    assignment_id: '602',
    points_possible: 5,
    sub_assignment_tag: 'reply_to_topic',
  },
  details: { reply_to_entry_required_count: 1 },
  html_url: 'https://school.instructure.com/courses/101/discussion_topics/601',
}

/** 9/9 — `peer_review_sub_assignment`. */
export const FIXTURE_PLANNER_PEER_REVIEW_SUB_ASSIGNMENT: CanvasPlannerItem = {
  context_type: 'Course',
  course_id: '101',
  context_name: 'Introduction to Ethics',
  plannable_id: '902',
  plannable_type: 'peer_review_sub_assignment',
  planner_override: null,
  submissions: {
    submitted: false,
    excused: false,
    graded: false,
    posted_at: null,
    late: false,
    missing: false,
    needs_grading: false,
    has_feedback: false,
    redo_request: false,
  },
  new_activity: false,
  plannable_date: '2026-10-16T23:59:00Z',
  plannable: {
    id: '902',
    title: 'Week 6 reading questions: peer review',
    course_id: '101',
    todo_date: null,
    details: null,
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
    due_at: '2026-10-16T23:59:00Z',
    assignment_id: '602',
    points_possible: 5,
  },
  html_url: 'https://school.instructure.com/courses/101/assignments/601/peer_reviews',
}

/** All nine plannable_type arms, one fixture each — the AC-15 anti-vacuity set. */
export const FIXTURE_PLANNER_ALL_TYPES: CanvasPlannerItem[] = [
  FIXTURE_PLANNER_ASSIGNMENT,
  FIXTURE_PLANNER_QUIZ,
  FIXTURE_PLANNER_NOTE,
  FIXTURE_PLANNER_WIKI_PAGE,
  FIXTURE_PLANNER_DISCUSSION,
  FIXTURE_PLANNER_CALENDAR_EVENT,
  FIXTURE_PLANNER_PEER_REVIEW,
  FIXTURE_PLANNER_SUB_ASSIGNMENT,
  FIXTURE_PLANNER_PEER_REVIEW_SUB_ASSIGNMENT,
]
