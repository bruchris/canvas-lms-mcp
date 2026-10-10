# Cross-course student activity and planner tools

- **Issue:** BRU-2797 (research source: BRU-2792, 2026-10-08 product research)
- **Status:** design only. No source changed, no PR opened (the brief forbids both).
- **Author:** Lead Developer
- **Base:** `origin/main` at `c78ab1e` (canvas-lms-mcp 1.32.1, 167 tools / 42 domains)

Evidence tags used throughout, following the convention established by
`2026-10-05-bru-2730-canvas-64bit-identifiers.md`:

| Tag | Means |
| --- | --- |
| `[D]` | Instructure's published developer docs |
| `[S]` | Canvas open-source Ruby, read at a pinned SHA (`1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`) |
| `[P]` | Executed against this repository |
| `[R]` | Read from this repository's source at `origin/main` |

**No claim in this document is `[W]` (observed on a Canvas wire).** The issue
forbids calling a real Canvas instance, so every Canvas-side statement is read
from Instructure's source at a pinned SHA rather than observed. Appendix A gives
the exact commands so any claim can be re-derived. Where source and published
docs disagree, both are reported and the source is taken as authoritative — this
happens three times (§1 C7, C8, and §3.3).

---

## 0. Recommendation

**Ship three read-only tools in the existing `student` tool domain, backed by two
new Canvas modules. Do not create an `activity_stream` or a `planner` tool
domain. Defer the cross-course announcements tool to a fourth increment, because
the global activity stream already carries `Announcement` items and the
announcements endpoint's distinct value is narrower than the brief assumes.**

| # | Tool | Canvas endpoint | Audience |
| - | --- | --- | --- |
| 1 | `get_my_activity_stream_summary` | `GET /api/v1/users/self/activity_stream/summary` | `student` |
| 2 | `get_my_activity_stream` | `GET /api/v1/users/self/activity_stream` | `student` |
| 3 | `list_my_planner_items` | `GET /api/v1/planner/items` | `student` |
| — | `list_announcements_across_courses` | `GET /api/v1/announcements` | deferred, §5.4 |

Five things drive the design, and four of them contradict the brief:

1. **The single most likely implementation bug is already identifiable.**
   `/users/self/activity_stream` is rendered with `Api.paginate(..., default_per_page: 21)`
   `[S]`. Our `client.request()` sends no `per_page` at all, so a tool built on
   `request()` would silently return 21 items and look like it worked. Our
   `client.paginate()` always sets `per_page=100` `[R]`, and `Api.paginate`
   honours a caller's `per_page` up to `MAX_PER_PAGE = 100` `[S]`. **Every one of
   these tools must use `paginate()`, never `request()`** — including the ones
   whose Canvas docs do not say "paginated". §3.1.

2. **The global activity stream is a ~4-week rolling window, not a history.**
   `StreamItem.destroy_stream_items_using_setting` deletes stream items older
   than `Setting.get("stream_items_ttl", 4.weeks)` `[S]`. The TTL is a
   per-instance Canvas Setting and is **not discoverable through the API**, so
   the tool cannot compute or report its own horizon. It must say so in its
   description, and the output envelope must not imply completeness. §3.1.

3. **Content is silently truncated and silently capped, at write time, with no
   marker.** `StreamItem#generate_data` truncates every stored `message` to
   `[0, 4.kilobytes]` and keeps at most `LATEST_ENTRY_LIMIT = 3` root discussion
   entries / conversation messages `[S]`. Truncation happens when the stream item
   is created, so no request parameter recovers the full text and no field
   signals that text was cut. An agent reading a truncated announcement cannot
   tell. §3.1, §7.3.

4. **This surface carries student PII that no existing pseudonymizer method
   covers.** `stream_item_json` emits `root_discussion_entries[].user.user_name`,
   `author_name` on `DiscussionEntry` items, a full `submission_json` with
   `includes = %w[submission_comments assignment course html_url user]` for
   `Submission` items, and `latest_messages` for `Conversation` items `[S]`.
   `get_my_activity_stream` therefore triggers the `CLAUDE.md` step-6 rule
   outright, and **none of the seven existing `anonymize*` methods accepts this
   shape** `[R]`. A new `anonymizeActivityStream` is required work, not a
   checkbox. §6.

5. **Cross-course attribution is not the uniform `course_id` the brief assumes.**
   `Api::V1::Context#context_data` emits `{"context_type" => "Course",
   "course_id" => id}` — **the ID key name is derived from the context type**, so
   a group-context stream item carries `group_id` and **no `course_id` key at
   all** `[S]`. The published doc block shows both keys with `'group_id': null`
   and lowercase `'context_type': 'course'`; both are wrong against the
   serializer. Output shapes must model `course_id` as *absent*, not null, and
   `context_type` as `"Course" | "Group"`. §1 C7, §7.2.

**Estimated size:** increment 1 **S**, increment 2 **M**, increment 3 **M**,
increment 4 (deferred) **S**. Four PRs, strictly ordered. §9.

---

## 1. Corrections to the brief

The brief's thesis — that we have no cross-course student daily surface and
Canvas exposes stable global endpoints for one — survives. Its supporting facts
mostly do not, and each correction below changed a design decision.

| # | The brief says | Evidence | Consequence |
| - | --- | --- | --- |
| **C1** | "dashboard upcoming/todo endpoints are capped" | Half true. `upcoming_events` is capped hard: `opts[:end_at] \|\|= 1.week.from_now`, `opts[:limit] \|\|= 20`, and `UsersController#upcoming_events` passes no overrides, so neither is reachable by a caller `[S]`. But `/api/v1/users/self/todo` is a `BookmarkedCollection` with ordinary pagination and **no cap** `[S]`, and our `get_todo_items` already paginates it at `per_page=100` `[R]`. | Only half the justification stands. Do **not** write "the todo endpoint is capped" into any tool description or release note. The real `todo` gap is different and smaller: it returns only assignments needing submitting/grading, never pages, ungraded discussions or planner notes — which is the actual argument for the planner tool (§3.2). It also accepts a `course_ids` filter we do not expose `[S]`; out of scope here, noted in §11 Q5. |
| **C2** | "`get_course_activity_stream` is summary-only" | True, and the type is worse than the tool. `AnalyticsModule.getCourseActivityStream` calls `/courses/{id}/activity_stream/summary` and returns `CanvasActivityStreamItem[]`, which is declared as `{type, count, unread_count}` `[R]` — that is the **summary** shape, not a stream item. | The name `CanvasActivityStreamItem` is already taken by the wrong thing. The new types must be `CanvasActivityStreamEntry` (an item) and `CanvasActivityStreamSummaryEntry` (a count). Renaming the existing type is a separate, mechanical change and is **not** bundled here (§11 Q4). |
| **C3** | Implied: the global stream is a durable activity log | `StreamItem.destroy_stream_items_using_setting` runs `destroy_stream_items(Setting.get("stream_items_ttl", 4.weeks).to_i.seconds.ago, touch_users: false)` `[S]`. | It is a rolling window whose length is an instance Setting, invisible to the API. The tool description must say "recent activity, typically the last ~4 weeks; the retention window is set per Canvas instance and cannot be read through the API". Any "no new activity" answer is unfalsifiable beyond the horizon. |
| **C4** | Implied: these are ordinary paginated endpoints | `activity_stream` renders with `Api.paginate(scope, self, …, default_per_page: 21)` `[S]`. `Api.paginate` resolves `per_page_requested = controller.params[:per_page] \|\| options[:default] \|\| PER_PAGE` and clamps to `MAX_PER_PAGE = 100` `[S]`. | A `request()`-based implementation returns 21 items with no error and no `Link` header followed. A `paginate()`-based one returns everything at 100/page `[R]`. This is the difference between a correct tool and a quietly wrong one, so §9 makes it an explicit acceptance criterion with a fixture that asserts `per_page=100` is on the wire. |
| **C5** | "`GET /api/v1/announcements` with `context_codes[]`" is a cross-course endpoint | `context_codes` is **required**: `parse_context_codes` renders `{"message": "Missing context_codes"}` with status 400 when the array is empty, and `{"message": "Invalid context_codes; only \`course\` codes are supported"}` for any non-`course_` code `[S]`. | It is not "my announcements". The caller must already hold a course-ID list, so the tool cannot save the `get_my_courses` round trip — only the N→1 fan-out. This materially weakens the case for the tool and is why it is deferred (§5.4). It also means `appendCanvasQuery`'s empty-array skip `[R]` would produce an opaque Canvas 400, so non-emptiness must be enforced in Zod (§5.4). |
| **C6** | Implied: a cross-course announcements tool is a superset of N× `list_announcements` | It is **narrower by default**. The global endpoint applies `@start_date \|\|= 14.days.ago.beginning_of_day; @end_date \|\|= @start_date + 28.days` `[S]` — a window reaching 14 days *forward*, not "the last 14 days". Our existing per-course `listAnnouncements` hits `/courses/{id}/discussion_topics?only_announcements=true` with **no date window at all** `[R]`. | A caller switching from N× `list_announcements` to one `list_announcements_across_courses` silently loses all announcements older than 14 days. The tool must set explicit dates or document the default loudly. |
| **C7** | Deliverable 4 assumes uniform "course/context attribution" | `Api::V1::Context#context_data` returns `{"context_type" => context_type.camelcase, "#{context_type.underscore}_id" => id.to_i}` `[S]` — one ID key, named after the context type. The `UsersController#activity_stream` doc block advertises `'context_type': 'course'` (lowercase) **and** `'course_id': 1, 'group_id': null` together `[D]`/`[S]`. | Both doc claims are wrong. Real values are `"Course"` / `"Group"`, and exactly one of `course_id` / `group_id` is present; the other key is **absent**, not `null`. A schema using `course_id: z.number().nullable()` would reject a valid group item. §7.2. |
| **C8** | Implied: a bad course code in a cross-course call fails loudly | The announcements `index` action has **no `authorized_action` call** `[S]`. Courses are resolved with `api_find_all(Course, @course_ids)` → `Api.sis_relation_for_collection`, an ActiveRecord relation, so unknown IDs simply do not match; visibility is then enforced by scope filters (`visible_to_ungraded_discussion_student_visibilities`, the unpublished filter) `[S]`. The published doc says "The call will fail unless the caller has View Announcements permission in all listed courses" `[D]`. | The doc is wrong in the direction that matters. Unknown and unpermitted course codes are **silently dropped** — the caller gets a 200 and a short list. This is the single strongest argument for the completeness envelope in §7.1: the tool must echo the requested context codes so an agent can diff them against what came back. |
| **C9** | Implied: planner date filtering is symmetric | `set_date_range` defaults to `[2.weeks.ago, 2.weeks.from_now]` **only when both params are blank**; supplying one sends the other to `formatted_planner_date(..., 10.years.ago \| 10.years.from_now)` `[S]`. | Passing only `start_date` silently requests a **ten-year** forward window. The tool must either require both or neither, or default the missing side itself. §5.3 takes the second option. |

One brief claim I did **not** evaluate: that competitor `canvas-mcp` v1.14.0
"validates demand". Per the brief's own out-of-scope rule I did not read its
design, and nothing in this document derives from it. Demand is the board's
call, not a measurement I can make; §11 Q1 records it as an open question rather
than asserting it.

---

## 2. Precondition: BRU-2730 does not gate this design

The brief's Step 1 asks whether BRU-2730 (string-safe Canvas identifiers) must
land first. **It does not.** The reasoning, with the evidence that settles it:

1. **BRU-2730 is design-only and merged; none of it is implemented.** PR #382
   merged 2026-10-05, and its diff is one spec file `[P]`. `git grep` for
   `canvasIdInput`, `canvasIdList`, `CanvasWireId` and `canvas-string-ids` across
   `origin/main:src/` returns **zero matches** `[P]`. So there is no new ID type
   or client signature in the tree to depend on, and no flag day to wait for.

2. **The new tools take no Canvas ID path parameters.** All three MVP endpoints
   are `/users/self/...` or `/planner/items`. The only ID-bearing inputs are
   `context_codes[]` on the planner and announcements tools.

3. **`context_codes` is already an opaque string in this codebase, by
   precedent.** `src/tools/appointment-groups.ts` declares it
   `z.array(z.string())` in three places, and `src/canvas/appointment-groups.ts`
   forwards it as `string[]` `[R]`. A context code is a composite
   (`course_123`), not a bare identifier, so it never flowed through
   `z.number()` and is untouched by BRU-2730's Phase 1. **Following that
   precedent, the new tools accept `context_codes` as validated strings and
   depend on nothing BRU-2730 will change.** §5.3 gives the pattern.

Two forward-compatibility obligations follow, which this design discharges in
advance rather than deferring:

- **Do not add a `course_ids: z.number()` convenience input.** It would be a
  223rd bare-`z.number()` ID site, directly against BRU-2730 §0.1, and would need
  migrating in that project's Phase 1. If a course-ID-shaped input is wanted
  later, add it as `canvasIdList()` once that builder exists (§11 Q2).
- **Response ID fields are in BRU-2730's Phase 2 blast radius.** `course_id`,
  `assignment_id`, `plannable_id`, `conversation_id` and friends all end in
  `_id`, so Canvas's `StringifyIds` converts them once the `Accept:
  application/json+canvas-string-ids` header ships `[S]`. Declaring them
  `number` today is correct for today and is the same widening every other
  module takes in that phase; §7.4 records it so the Phase 2 inventory is not
  surprised. **No field introduced here needs the hand-written normalization
  pass** that BRU-2730 §0.4 requires for its 12 non-matching fields — every ID
  these tools emit ends in `_id` `[S]`.

**Verdict: proceed. This issue is not blocked on BRU-2730, and BRU-2730's
Phase 1/2 work is not enlarged by shipping these tools first.**

---

## 3. Endpoint evidence

Everything in this section is read from Canvas at pinned SHA
`1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`. File paths are Canvas's, not ours.

### 3.1 `GET /api/v1/users/self/activity_stream`

**Handler:** `app/controllers/users_controller.rb#activity_stream` →
`lib/api/v1/stream_item.rb#api_render_stream` `[S]`.

**Documented query parameters:** `only_active_courses` (boolean) only `[D]`.
The handler additionally reads three **undocumented** params that its own comment
flags as a hack to be replaced — `asset_type`, `context_code`,
`submission_user_id` — plus `notification_categories` `[S]`:

```ruby
# this endpoint has undocumented params (context_code, submission_user_id and asset_type) to
# support submission comments in the conversations inbox.
# please replace this with a more reasonable solution at your earliest convenience
```

**Design decision: expose `only_active_courses` only.** The undocumented four are
explicitly marked for removal upstream, and `asset_type` carries a
pagination-correctness footgun — `api_render_stream` says so in a comment of its
own (`# just because there are comments doesn't mean the user can see them. we
still need to filter after the pagination :(`), and then post-filters the page
with `json.select! { |hash| hash["submission_comments"].present? }` `[S]`. A
caller paginating with `asset_type=Submission` therefore gets pages shorter than
`per_page` for reasons unrelated to exhaustion, which breaks the obvious "a short
page means the last page" heuristic. Not worth exposing.

**Pagination:** `Api.paginate(scope, self, …, default_per_page: 21)` `[S]`, with
`Api::PER_PAGE = 10` and `Api::MAX_PER_PAGE = 100`, resolved as
`per_page_requested = controller.params[:per_page] || options[:default] || PER_PAGE`
then clamped to `max` `[S]`. **Use `client.paginate()`**, which sets
`per_page=100` when absent and follows `Link: rel="next"` `[R]`. See §9 AC-1.

**Retention:** `Setting.get("stream_items_ttl", 4.weeks)` `[S]` — §1 C3.

**Item shape.** `stream_item_json` builds a common prefix then branches on
`stream_item.asset_type` `[S]`:

| Field | Source | Note |
| --- | --- | --- |
| `id` | `stream_item.id` | the stream item's own id, not the underlying object's |
| `created_at`, `updated_at` | `stream_item` | |
| `title` | `data.title` if it responds, else `nil` | overwritten per type |
| `message` | `data.body` if it responds, else `nil` | overwritten per type |
| `type` | `stream_item.data.class.name` | **a Ruby class name**, see below |
| `read_state` | `stream_item_instance.read?` | re-derived for `Conversation` |
| `context_type` + one of `course_id` / `group_id` | `context_data(stream_item)` | §1 C7 |
| `html_url` | per type | absent on `Message` items, which set `html_url` *and* `url` from `data.url` |

**`type` is derived, not enumerated.** It is assigned
`stream_item.data.class.name` and then **overwritten** in two branches:
`/Conference/` sets `"WebConference"` and `/Collaboration/` sets `"Collaboration"`
`[S]`. The dispatch is on `asset_type` with regex arms, so the observable set
includes at least `DiscussionTopic`, `Announcement`, `Conversation`, `Message`,
`Submission`, `WebConference`, `Collaboration`, `AssessmentRequest` and
`DiscussionEntry`. Two consequences:

- `ContextMessage` has a **`# pass`** arm — it adds no type-specific fields at
  all, and the comment says such items "may still show up in the stream for a few
  weeks" `[S]`. So an item carrying only the common prefix is valid.
- The `else` arm is `raise("Unexpected stream item type: #{stream_item.asset_type}")`
  `[S]`. A stream item of a type Canvas's own serializer does not handle **fails
  the whole request**, not the item. Nothing we can do about it, but the tool
  description must not promise the endpoint always succeeds.

**Per-type fields that matter here:**

- `DiscussionTopic` / `Announcement` — `message` is replaced with
  `api_user_content(data.message, context, …)`, i.e. **HTML**, not the
  "plain-text" the shared-attribute doc block claims `[S]`/`[D]`. Also
  `discussion_topic_id` or `announcement_id`, `total_root_discussion_entries`,
  `require_initial_post`, `user_has_posted`, and `root_discussion_entries[]` as
  `{user: {user_id, user_name}, message}` `[S]`.
- `Conversation` — `conversation_id`, `private`, `participant_count`,
  `latest_messages` (present only when non-empty), and `read_state` recomputed
  from the current user's `conversation_participants` row `[S]`.
- `Message` — `title` is `data.subject` and `notification_category` is set; these
  are Canvas-generated notification strings, not user-authored text `[S]`.
- `Submission` — `submission_json(submission, assignment, …, includes =
  %w[submission_comments assignment course html_url user])` merged in, with `id`
  deleted and `submission_id` added, `assignment.title` back-filled from
  `assignment.name`, and each `submission_comments[].body` set from `.comment`
  `[S]`. This is the largest single item shape in the response and the one
  carrying the most PII (§6).
- `AssessmentRequest` — `assessment_request_id`, a synthesised `title`
  (`"Peer Review for %{title}"`), and an `html_url` built from
  `assessment_request.user_id` `[S]`.
- `DiscussionEntry` — `author_name` and `message`. Note this `message` is **not**
  passed through `api_user_content`, unlike the `DiscussionTopic` arm `[S]`.

**Truncation and caps, applied at write time in `StreamItem#generate_data`** `[S]`:

```ruby
LATEST_ENTRY_LIMIT = 3
res["message"] = object["message"][0, 4.kilobytes] if object["message"].present?
```

- Every stored `message` is cut to `4.kilobytes` = 4096. Ruby's
  `String#[](start, length)` counts **characters**, not bytes, so this is 4096
  characters and the published "truncated at 4kb" `[D]` is approximate for
  non-ASCII text.
- At most **3** `root_discussion_entries` per topic, and at most 3
  `latest_messages` per conversation (`LATEST_ENTRY_LIMIT` bounds both) `[S]`.
- Both happen when the stream item is **created**, so no request parameter
  recovers the full text, and **no field marks that truncation occurred**. The
  full text is reachable only by following the item to its underlying object with
  `get_discussion` / `get_conversation`. §7.3 puts this in the tool description.

### 3.2 `GET /api/v1/planner/items`

**Handler:** `app/controllers/planner_controller.rb#index` →
`lib/api/v1/planner_item.rb#planner_item_json` `[S]`.

**Query parameters** `[D]`/`[S]`: `start_date`, `end_date` (`yyyy-mm-dd` or
ISO 8601), `context_codes[]` (courses **and groups**, defaulting to all of the
user's contexts), `filter` ∈ `{new_activity, incomplete_items, complete_items}`,
`observed_user_id` (observers only, requires `context_codes[]`).

**Dates — asymmetric defaults, §1 C9** `[S]`:

```ruby
@start_date, @end_date = if [params[:start_date], params[:end_date]].all?(&:blank?)
                           [2.weeks.ago.beginning_of_day, 2.weeks.from_now.beginning_of_day]
                         else
                           [params[:start_date], params[:end_date]]
                         end
@start_date = formatted_planner_date("start_date", @start_date, 10.years.ago.beginning_of_day)
@end_date   = formatted_planner_date("end_date",   @end_date,   10.years.from_now.beginning_of_day)
```

Invalid dates raise `InvalidDates` and render a 400 with an `errors` key `[S]`.

**Why this is strictly richer than our `get_todo_items` — the actual
justification for the tool.** `planner_items` unions **nine** collections:
assignments, ungraded quizzes, planner notes, wiki pages, ungraded discussions,
calendar events, peer reviews, sub-assignments and peer-review sub-assignments
`[S]`. `UsersController#todo_items` unions **two** (`assignments_needing_grading`
and `assignments_needing_submitting`) plus discussion checkpoints `[S]`. Pages
with a to-do date, ungraded discussions, personal planner notes and calendar
events are therefore reachable **only** through the planner. That is a capability
gap, not a convenience.

**Pagination:** `Api.paginate(items, self, …)` with **no `default_per_page`**
`[S]`, so it falls back to `Api::PER_PAGE = 10`. Same conclusion as §3.1: use
`client.paginate()`.

**Item shape** `[S]`:

| Field | Note |
| --- | --- |
| `context_type` | `"Course"` / `"Group"` — same derivation caveat as §1 C7 |
| `course_id` | present for course contexts |
| `context_name` | **`context.try(:nickname_for, @user) \|\| context.name`** — the caller's own course *nickname* when set, otherwise the course name |
| `plannable_id`, `plannable_type` | `plannable_type` is a `PlannerHelper::PLANNABLE_TYPES` key, e.g. `discussion_topic` — **snake_case, not the Ruby class name**, unlike the activity stream's `type` |
| `plannable` | the polymorphic underlying object; shape varies by `plannable_type` |
| `planner_override` | `null` unless the user has toggled the item |
| `submissions` | **`false` or an object** — a union, see §7.2 |
| `new_activity` | boolean, computed per type |
| `html_url` | absent for planner notes (`# TODO: We don't currently have an html_url for individual planner items.`) |

`context_name` being a user nickname is a real agent-usability trap: an agent
that joins `context_name` against `list_courses[].name` will mismatch for any
course the student has renamed. The tool description must say to join on
`course_id`.

### 3.3 `GET /api/v1/announcements`

**Handler:** `app/controllers/announcements_api_controller.rb#index` `[S]`.

**Parameters** `[D]`: `context_codes[]` (**required**, course codes only),
`start_date`, `end_date`, `available_after`, `active_only`, `latest_only`,
`include[]` in `{sections, sections_user_count}`.

**Three findings that decide whether to build this tool:**

1. **It is not global** — §1 C5. `parse_context_codes` 400s on an empty array and
   on any non-`course_` code `[S]`.
2. **Its default window is narrower than our existing per-course tool's** — §1 C6.
3. **Unknown or unpermitted course codes are silently dropped, contradicting the
   published doc** — §1 C8. The `index` action calls no `authorized_action`; it
   resolves courses through a relation and relies on scope filters `[S]`.

**What it genuinely adds that N× `list_announcements` cannot:**

- `latest_only=true` applies `ordered_between_by_context` +
  `SELECT DISTINCT ON (context_id) *` `[S]` — exactly one newest announcement per
  course, computed server-side. Reproducing it client-side costs N requests plus
  a sort.
- `include_context_code: true` is passed to `discussion_topics_api_json`, so each
  item carries `context_code` `[S]`. Our per-course call has no such option, so a
  caller must track attribution itself today `[R]`.
- One request instead of N.

Real but modest, and it overlaps the activity stream, which already emits
`Announcement` items with course attribution. Hence §5.4: defer.

---

## 4. Boundaries: tool domains are not Canvas modules

The brief asks whether this is "one domain or separate `activity_stream` and
`planner` domains". **The question conflates two axes that this repository
already keeps separate**, and separating them answers it:

- `src/canvas/` is organised by **Canvas resource**. 31 files `[P]`.
- `src/tools/` is organised by **workflow**, and `catalog.ts` maps a domain to a
  `defaultPrimaryAudience` and an optional feature `gate` `[R]`. 56 files, 42
  domains `[P]`.

They are demonstrably not 1:1: `src/tools/student.ts` is a single domain that
reaches into **four** Canvas modules — `canvas.submissions`, `canvas.users`,
`canvas.courses`, `canvas.enrollments` `[P]`.

### 4.1 Decision

**Two new Canvas modules, zero new tool domains.**

| New file | Why |
| --- | --- |
| `src/canvas/activity-stream.ts` → `ActivityStreamModule` | `/users/self/activity_stream` + `/summary` are one Canvas resource. Putting them in `AnalyticsModule` beside the *course* summary would re-create the §1 C2 naming collision in the module layer too. |
| `src/canvas/planner.ts` → `PlannerModule` | `/planner/items` is its own Canvas resource, documented as its own API `[D]`. |

Both are registered on the `CanvasClient` facade in `src/canvas/index.ts` as
`activityStream` and `planner` `[R]`.

**Tools go in the existing `student` domain** (`src/tools/student.ts`), for three
measured reasons:

1. **The naming convention is already domain-bound.** All five existing
   `get_my_*` tools — `get_my_courses`, `get_my_grades`, `get_my_submissions`,
   `get_my_upcoming_assignments`, `get_my_submission_feedback` — are in `student`
   `[P]`. The proposed names are `get_my_*` / `list_my_*`. Putting them elsewhere
   splits one convention across three domains.
2. **A domain's only two powers are audience and gate, and these tools need
   neither.** `student` is already `defaultPrimaryAudience: 'student'` `[R]`,
   which is exactly the tag all three want, and nothing here is feature-gated.
   New domains would buy zero filtering behaviour.
3. **Domain count is a published, CI-gated number.** Two new domains move it
   42 → 44 across the manifest and every doc that cites it, for no behavioural
   gain `[P]`.

**Rejected alternative: the `dashboard` domain.** It is also
`defaultPrimaryAudience: 'student'` and already holds the cross-course daily
tools (`get_todo_items`, `get_upcoming_events`, `get_missing_submissions`) `[R]`,
so it is a close call. It loses on the naming convention: none of its tools is a
`*_my_*` tool, and `get_dashboard_cards` genuinely maps to `/dashboard/*`.
Reviewers who disagree should say so — §11 Q3 records it as the one boundary
decision I would change on request.

### 4.2 Full file inventory

| Path | Change |
| --- | --- |
| `src/canvas/activity-stream.ts` | **new** — `ActivityStreamModule` |
| `src/canvas/planner.ts` | **new** — `PlannerModule` |
| `src/canvas/index.ts` | register `activityStream`, `planner` on the facade |
| `src/canvas/types.ts` | **new** types, §7.2 |
| `src/tools/student.ts` | **+3** tool definitions |
| `src/pseudonym/pseudonymizer.ts` | **new** `anonymizeActivityStream`, §6.2 |
| `src/pseudonym/coverage.ts` | add `get_my_activity_stream` |
| `src/provenance/fields.ts` | add 2 registry entries, §6.3 |
| `tests/provenance/boundary.test.ts` | mirror the registry (CI holds them identical) `[R]` |
| `tests/pseudonymizer.coverage.test.ts` | mirror the coverage list `[R]` |
| `tests/canvas/activity-stream.test.ts`, `tests/canvas/planner.test.ts` | **new** |
| `tests/tools/student.test.ts` | extend |
| `docs/generated/tool-manifest.json` | regenerate via `pnpm generate:manifests` `[R]` |
| `README.md`, `docs/` tool tables | counts 167 → 170, student audience 8 → 11 `[P]` |

**No change to `src/tools/catalog.ts`**, since no domain is added — which is also
the cheapest signal that §4.1 is the low-friction choice.

---

## 5. Tool set

Three tools. All `readOnlyHint: true`, `openWorldHint: true`, no
`destructiveHint`. All inherit `audience: 'student'` from the `student` domain,
so none sets `audience` explicitly (`CLAUDE.md` step 7: set it only to diverge).

### 5.1 `get_my_activity_stream_summary`

```
inputSchema: {
  only_active_courses: z.boolean().optional()
    .describe('Only count activity in courses the user is actively participating in'),
}
```

`GET /api/v1/users/self/activity_stream/summary`. **Uses `client.request()`, not
`paginate()`** — `api_render_stream_summary` is `items = calculate_stream_summary(opts);
render json: items`, with no `Api.paginate` call `[S]`. This is the inverse of
§3.1's rule and the reason the two are stated separately: the summary is the one
endpoint here that is *not* paginated, and wrapping it in `paginate()` would add
a pointless `per_page` to the URL.

Returns `CanvasActivityStreamSummaryEntry[]` — `{type, count, unread_count}`.
Counts only: **no PII, no untrusted text, no fencing, no pseudonymization.** It
is the cheapest tool in the set and the natural first call in a daily workflow
("is there anything to look at?"), which is why §9 ships it first.

### 5.2 `get_my_activity_stream`

```
inputSchema: {
  only_active_courses: z.boolean().optional()
    .describe('Only return activity in courses the user is actively participating in'),
  max_items: z.number().int().positive().max(500).optional()
    .describe('Maximum items to return (default 100). When the limit is reached, ' +
              'truncated is true and truncation_note explains how to narrow the query.'),
}
```

`GET /api/v1/users/self/activity_stream` via **`client.paginate()`** (§3.1).

**`max_items` must bound the WORK, not just the result.** `client.paginate()`
follows every `Link: rel="next"` to exhaustion before returning, capped at
`maxPaginationPages` (default **1000**) — and on hitting that cap it *throws*
`Results are incomplete: …` rather than returning a partial list `[R]`. Slicing
the returned array would therefore bound the response while still having fetched
up to 100,000 items; an output cap bounds the result, never the work. So
increment 2 adds an optional **`maxItems`** to `client.paginate()` that stops
following `Link` once the accumulated count reaches it.

Two traps in that change, both of which must be covered by tests:

- **`assertNotTruncated` must not fire on a deliberate `maxItems` stop.** It
  throws whenever the loop exits with a non-null `nextUrl` `[R]`, which is
  exactly the state a `maxItems` stop leaves behind. Conflating "the page cap
  overran" with "the caller asked us to stop" turns a successful bounded read
  into an error.
- **The existing callers must be unaffected.** `maxItems` is optional and absent
  for all current call sites, so the default path stays byte-identical. §9 AC-4
  asserts that with a count floor over the existing pagination tests.

**Description must carry four caveats** (§3.1, §7.3), because none of them is
discoverable from the response:

1. Recent activity only — typically the last ~4 weeks; the retention window is a
   per-Canvas-instance setting and cannot be read through the API.
2. `message` is truncated to 4096 characters when the item is stored, with no
   marker. Follow `html_url`'s object via `get_discussion` / `get_conversation`
   for full text.
3. At most 3 `root_discussion_entries` / `latest_messages` per item.
4. Exactly one of `course_id` / `group_id` is present; join on `course_id`.

### 5.3 `list_my_planner_items`

```
inputSchema: {
  start_date: z.string().optional()
    .describe('Inclusive start, YYYY-MM-DD or ISO 8601. Must be given together with end_date.'),
  end_date: z.string().optional()
    .describe('Inclusive end, YYYY-MM-DD or ISO 8601. Must be given together with start_date.'),
  context_codes: z.array(z.string().regex(/^(course|group)_[1-9][0-9]{0,18}$/))
    .nonempty().optional()
    .describe('Restrict to these contexts, e.g. ["course_123","group_7"]. ' +
              'Defaults to every context the user belongs to.'),
  filter: z.enum(['new_activity', 'incomplete_items', 'complete_items']).optional()
    .describe('new_activity = unread/new only; incomplete_items / complete_items ' +
              'filter on planner-override completion and submission state.'),
  max_items: z.number().int().positive().max(500).optional(),
}
```

**Both-or-neither on the dates, enforced in Zod, is a design decision not a
style choice.** Per §1 C9, supplying only `start_date` silently makes Canvas use
`10.years.from_now` as the other bound `[S]` — a ten-year window across nine
collections. Rejecting the half-specified form with a message that names the
reason is strictly better than returning a response nobody intended. The
alternative (fill the missing side with Canvas's own ±2-week default) is
recorded as §11 Q6; it is friendlier but diverges from the documented endpoint.

**`context_codes` is `z.string()` with a shape regex, not an ID type.** §2.3
gives the precedent (`src/tools/appointment-groups.ts` `[R]`) and §2's forward
obligation forbids adding a numeric `course_ids` convenience input. The regex
rejects `course_0` and leading zeros so one context has exactly one spelling —
the same canonicality argument BRU-2730 §4.2.2 makes for bare IDs, applied here
so the two surfaces cannot disagree. Groups **are** permitted here (unlike
announcements, §3.3) because Canvas's planner documents and supports them `[D]`.

`.nonempty()` matters for a mechanical reason: `appendCanvasQuery` skips
zero-length arrays `[R]`, so `context_codes: []` would produce a request with no
`context_codes` at all — i.e. silently *all* contexts, the opposite of what the
caller asked. Rejecting it is the only safe reading.

### 5.4 Deferred: a cross-course announcements tool

The brief says to add one "only if it adds distinct value". It does — §3.3 lists
three things N× `list_announcements` cannot do — but the value is **secondary to
this MVP**, for two reasons that are measurements rather than opinions:

1. **The activity stream already carries it.** `Announcement` is one of the
   stream's item types, with `announcement_id`, the (truncated) `message`, and
   course attribution `[S]`. A student's "what's new across my courses" question
   is answered by increments 1–3 without it.
2. **Its unique capability is a digest, and the summary tool is a cheaper
   digest.** `latest_only` gives one newest announcement per course; the daily
   workflow the brief describes is served first by
   `get_my_activity_stream_summary`'s unread counts.

Against that it carries real cost: a required course-ID list it cannot derive
(§1 C5), a default window *narrower* than our existing tool (§1 C6), and silent
omission of courses the caller cannot see (§1 C8) — which needs the completeness
envelope from §7.1 to already exist.

**Recommendation: build it as increment 4, after §7.1 ships, named
`list_announcements_across_courses`** — not `list_my_announcements`, which would
overclaim given `context_codes` is required. Its input is the §5.3
`context_codes` pattern restricted to `^course_[1-9][0-9]{0,18}$`, plus
`start_date`, `end_date`, `latest_only`, `active_only`. Its envelope must echo
`requested_context_codes` so an agent can diff them against `context_code`
values returned and detect the silent drop.

---

## 6. Privacy, provenance and pseudonymization

### 6.1 The PII audit

`CLAUDE.md` step 6 triggers on "a `CanvasUser`, a `participants` array, or a
`user_name` field". Measured against the serializers:

| Tool | PII in the response | Trigger |
| --- | --- | --- |
| `get_my_activity_stream_summary` | none — `{type, count, unread_count}` `[S]` | no |
| `get_my_activity_stream` | `root_discussion_entries[].user.{user_id, user_name}`; `author_name` on `DiscussionEntry` items; a full `submission_json` with `includes = %w[… user]` plus `submission_comments[]` on `Submission` items; `latest_messages` on `Conversation` items `[S]` | ~~**yes, four ways**~~ **yes, seven ways — see the correction below** |

> **Corrected 2026-10-10 (BRU-2863).** "Four ways" was wrong, and the undercount
> is why the first implementation shipped a leak: it treated "the `Submission`
> arm" as `user` + `submission_comments[].author_name`, which is the subset of
> the merged serializer this row happens to name. The arm is as wide as
> `submission_json` and is admitted through an open index signature, so every key
> it emits is privacy-relevant. Re-audited key by key at the pinned SHA, three
> further name-bearing surfaces reach the stream:
>
> - **`discussion_entries[]`** — emitted for any `discussion_topic` submission,
>   because `discussion_entries` is in the default-on `SUBMISSION_OTHER_FIELDS`
>   and the stream narrows nothing. Each entry carries `user_name`, `user_id`
>   **and** `user` = `user_display_json(…)`; the first two are dropped when the
>   entry is deleted while `user` survives, so the three do not co-occur. It
>   recurses through `recent_replies[]` `[S]`.
> - **`proxy_submitter`** — `attempt.proxy_submitter.short_name`, a bare string
>   with a `proxy_submitter_id` sibling, also from `SUBMISSION_OTHER_FIELDS`
>   `[S]`.
> - **`submission_comments[].author.display_name`** — `submission_comment_json`
>   sets `sc_hash["author"] = user_display_json(comment.author, …)` whenever the
>   viewer holds `:read_author`, so the author's real name sits one key over from
>   the `author_name` this row did name `[S]`.
>
> `user_display_json` spells the name **`display_name`**, not `name` or
> `user_name`. That is the mechanical reason all three were missed: `CLAUDE.md`
> step 6 triggers on "a `CanvasUser`, a `participants` array, or a `user_name`
> field", and none of these three matches any of those three patterns. The audit
> also cleared `attachments[]` (the `user` key is gated on
> `includes.include?("user")`, which is not passed), `group` (gated on
> `include=group`, absent), and `assignment` / `course` (metadata; `course_json`
> emits teachers only under `include=teachers`).
| `list_my_planner_items` | none in the planner item itself; `plannable` is the underlying object, and for `discussion_topic` / `assignment` plannables that is course content, not a user record `[S]` | **no — but see below** |

**`list_my_planner_items` is the interesting row.** It is the student's *own*
planner, so there is no third-party student record in the envelope, and
`plannable` is content. I am recommending it is **not** added to
`PSEUDONYMIZER_WRAPPED_TOOLS`, and recording the reasoning explicitly because a
future reviewer will reasonably ask: the polymorphic `plannable` is the risk
surface, and if Canvas ever adds a user object inside it the tool becomes
PII-bearing without any change on our side. §9 AC-7 therefore requires a fixture
asserting no `user_name` / `user` key appears anywhere in a realistic
nine-plannable-type response, so the day that changes, CI says so.

### 6.2 `anonymizeActivityStream` is new work

**None of the seven existing `anonymize*` methods accepts this shape.** The
public surface today is `anonymizeUser`, `anonymizeUsers`, `anonymizeEnrollment`,
`anonymizeSubmission`, `anonymizeConversation`, `anonymizeOutcomeResults`,
`anonymizeAppointmentGroupResponse` `[R]`. Two are close and neither fits:

- `anonymizeSubmission` handles a submission plus its `submission_comments`
  `[R]`, which covers the `Submission` arm — but only that arm, and only when
  reached with the right `courseId`.
- `anonymizeConversation` takes a `CanvasConversation | CanvasConversationDetail`
  `[R]`; a stream `Conversation` item is neither — it is
  `{conversation_id, private, participant_count, latest_messages}` `[S]`.

So increment 3 adds `anonymizeActivityStream(items)` that dispatches per item
`type` and delegates to the existing methods where they apply.

**The hard part is the pseudonym scope, and it has no clean answer.** The
existing maps are course-scoped: `assignPseudonym(host, userId)` is reached
through `loadCourseMap(host, courseId)`, and `anonymizeAppointmentGroupResponse`
already works around the absence of a course by inventing the synthetic scope
`` `_apptgrp_${apptGroupId}` `` `[R]`. The activity stream is cross-course by
construction, and §1 C7 means a **group-context item carries no `course_id` at
all**. Three options, with the recommendation:

| Option | Behaviour | Verdict |
| --- | --- | --- |
| Per-item `course_id` as the scope | One student appears as different pseudonyms in different courses | **Recommended.** It is what every existing wrapped tool already does, so the stream agrees with `list_submissions` on the same student in the same course. |
| One synthetic cross-course scope | One stable pseudonym everywhere in the stream | Rejected: it would disagree with every other tool, and a joint reading of the stream plus `list_submissions` would show the same person under two names, which is worse than the first option's honest per-course split. |
| Drop PII-bearing arms entirely when pseudonymization is on | No names at all | Rejected: `root_discussion_entries` is most of the value of a discussion item. |

For **group-context items with no `course_id`**, follow the
`anonymizeAppointmentGroupResponse` precedent and use `` `_group_${group_id}` ``.
This is a genuine new scope key; §11 Q7 flags it for the FERPA spec owner, since
it is the first scope that is neither a course nor derived from one.

`get_my_activity_stream` goes in `PSEUDONYMIZER_WRAPPED_TOOLS`; CI fails until
both the list and the wrap are done `[R]`.

### 6.3 Provenance fencing

`UNTRUSTED_FIELDS` is keyed by tool name, then field name, matched **anywhere in
that tool's subtree**, with the label inherited through arrays but never through
a nested object `[R]`. Proposed entries:

```
get_my_activity_stream: {
  message: 'activity stream message',
  body:    'submission body',
  comment: 'submission comment',
},
list_my_planner_items: {
  message:     'discussion message',
  description: 'assignment description',
  body:        'page body',
},
```

Three deliberate choices, each with the reason it is not the obvious one:

- **`title` is NOT fenced**, even though a `DiscussionTopic` item's `title` is
  user-authored. The precedent is `list_discussions` / `get_discussion`, which
  fence `message` and not `title` `[R]`. Fencing `title` here would also hit the
  `Message` arm's Canvas-generated notification subject and the
  `AssessmentRequest` arm's synthesised `"Peer Review for …"` string `[S]` —
  server-authored text, which §8.1 of the fencing design says must not be
  fenced.
- **`name` is NOT fenced**, which is why `message`/`body`/`comment` is the whole
  list for the stream. A `Submission` item merges `includes = %w[… assignment
  course …]` `[S]`, so a `name` entry would fence the course and assignment
  names — exactly the `get_my_submission_feedback` over-match the registry's own
  header comment warns about `[R]`.
- **`author_name` is NOT fenced** even though it is user-authored, because it is
  a *name*, and names are the pseudonymizer's job (§6.2), not the fence's. The
  two layers must not both rewrite the same value.

**A pre-existing inconsistency this surfaces, deliberately left alone.**
`list_announcements` is absent from `UNTRUSTED_FIELDS` while
`list_account_notifications` is present with
`{subject: 'announcement subject', message: 'announcement message'}` `[R]`. The
same text is fenced on one surface and not the other. That is a real gap, it is
**not** in this issue's scope, and fixing it here would drag a contended
registry file into a design PR. §11 Q8 proposes it as its own issue.

---

## 7. Output shapes

### 7.1 The completeness envelope

Deliverable 4 asks for "completeness metadata where Canvas caps or truncates
results". The repository already has the pattern and it is not the
structured-output machinery: `list_course_submission_files` returns a plain
object `{course_id, total_files, total_submissions_scanned, truncated,
truncation_note, files}` with an actionable `truncation_note` string, and
`find_student_across_courses` does the same with a `truncated` flag `[R]`.
Follow it exactly rather than inventing a shape.

```ts
// get_my_activity_stream
{
  items: CanvasActivityStreamEntry[],
  total_items: number,
  truncated: boolean,
  truncation_note: string | null,   // null unless truncated
  retention_note: string,           // always present — see below
}
```

`retention_note` is **unconditional**, which is the one place this envelope
diverges from the `submission-files` precedent, and deliberately so. A
`truncated` flag answers "did *we* stop early?". It cannot answer "did Canvas
already forget?" — and per §1 C3 that horizon is an instance Setting invisible to
the API, so there is no value to compute and no condition under which we could
set the flag correctly. A field that is always present and always says the same
thing is the honest encoding; a nullable one would read as "not truncated by
retention", which we can never assert.

For `list_my_planner_items`, the same envelope minus `retention_note` (the
planner queries live objects, not a TTL'd stream), plus `start_date` and
`end_date` echoed back as resolved — because a caller who passed neither gets
Canvas's ±2-week default and currently has no way to learn what window it used.

For the deferred announcements tool (§5.4), add `requested_context_codes` so the
silent drop in §1 C8 becomes detectable by set difference.

### 7.2 New types in `src/canvas/types.ts`

Two shape hazards drive these declarations, both from §3:

```ts
/**
 * One entry from GET /users/self/activity_stream.
 *
 * `context_type` is "Course" | "Group" and EXACTLY ONE of `course_id` /
 * `group_id` is present — the key name is derived from the context type by
 * Canvas's Api::V1::Context#context_data, so the other key is ABSENT, not null.
 * Canvas's own doc block shows both keys with `group_id: null`; it is wrong.
 */
export interface CanvasActivityStreamEntry {
  id: number
  created_at: string
  updated_at: string
  title: string | null
  message: string | null
  /** A Ruby class name, overwritten to "WebConference" / "Collaboration" for
   *  those arms. Not a closed set — `(string & {})` keeps it open. */
  type:
    | 'DiscussionTopic' | 'Announcement' | 'Conversation' | 'Message'
    | 'Submission' | 'WebConference' | 'Collaboration'
    | 'AssessmentRequest' | 'DiscussionEntry'
    | (string & {})
  read_state: boolean
  context_type?: 'Course' | 'Group' | (string & {})
  course_id?: number
  group_id?: number
  html_url?: string
  // …per-type fields, all optional
}

/** One entry from .../activity_stream/summary. NOTE: the existing
 *  `CanvasActivityStreamItem` already models this shape under a misleading
 *  name (§1 C2); this is the correctly-named declaration. */
export interface CanvasActivityStreamSummaryEntry {
  type: string
  count: number
  unread_count: number
}
```

- **Every optional field is `?`, not `| null`.** §1 C7 is the reason: the
  group/course key is absent. Declaring `course_id: number | null` would be
  wrong in a way that a `null`-checking consumer cannot detect.
- **`type` keeps `(string & {})`** — the same escape hatch the existing
  `CanvasActivityStreamItem` uses `[R]`. §3.1 shows the value is a class name
  computed at runtime with an `else raise` arm, so a closed union would be a lie.
- **`submissions` on a planner item is `false | object`.** Canvas initialises it
  `submission_status = { submissions: false }` and replaces it with a hash when
  there is one `[S]`. Declare it `false | CanvasPlannerSubmissionStatus`, not
  `CanvasPlannerSubmissionStatus | null`. A consumer writing
  `item.submissions?.graded` silently reads `undefined` on the boolean, so the
  union has to be visible in the type.

### 7.3 Truncation is a description obligation, not a field

Canvas truncates `message` at store time with no marker (§3.1), so we cannot
compute a `message_truncated` boolean: a 4096-character message and a message
that *happens* to be 4096 characters are indistinguishable. Inventing a
heuristic flag (`message.length === 4096`) would be a false positive generator.
The honest encoding is the tool description plus the `html_url` pointer, and
`retention_note` for the window. §11 Q10 records that if Canvas ever adds a
truncation marker we should surface it.

### 7.4 Structured output: declare none of the three

Only **5** of 167 tools declare an `output` contract, all in `src/tools/pages.ts`
`[P]`, and declaring one is all-or-nothing — with a schema present, a text-only
result is rejected by both server and client `[R]`. Two reasons not to opt in
here:

1. **The item shapes are the worst possible candidates.** `plannable` is
   genuinely polymorphic across nine `plannable_type` values, and the stream
   entry is a nine-arm union with an open `type`. The project rule is
   `z.looseObject` wherever Canvas authors the shape — correct, and it reduces
   the contract to "an object", which buys a client nothing while obliging us to
   maintain fixtures for every arm.
2. **The one safe candidate should not be special-cased alone.**
   `get_my_activity_stream_summary` is three scalar fields and would be trivially
   safe. Migrating it by itself makes it the 6th tool in a set of 5 that is
   otherwise one coherent domain, which is how a migration loses its shape.
   It belongs in the structured-output project's next batch. §11 Q9.

**Forward note for BRU-2730 Phase 2.** Every identifier these tools emit ends in
`_id` — `course_id`, `group_id`, `assignment_id`, `submission_id`,
`conversation_id`, `message_id`, `discussion_topic_id`, `announcement_id`,
`web_conference_id`, `collaboration_id`, `assessment_request_id`,
`plannable_id`, `user_id` `[S]`. So all of them are converted by Canvas's
`StringifyIds` once that header ships, and **none** needs an entry in
BRU-2730 §0.4's hand-written normalization pass for non-matching fields. The
declarations above stay `number` today and widen with every other module in that
project's Phase 2.

---

## 8. Tests, fixtures, manifest and docs

**Never call a real Canvas instance.** All tests mock `fetch`, per the existing
`tests/canvas/*.test.ts` convention `[R]`.

| Artifact | Requirement |
| --- | --- |
| `tests/canvas/activity-stream.test.ts` | URL/param assertions (incl. the `per_page` discriminator, §9 AC-1/AC-5), `Link`-following across 2 pages, `maxItems` stop |
| `tests/canvas/planner.test.ts` | date/`context_codes`/`filter` serialization; `context_codes[]` bracket form via `appendCanvasQuery` |
| `tests/tools/student.test.ts` | envelope fields; both-or-neither date rejection; empty-`context_codes` rejection |
| `tests/pseudonym/` | per-type dispatch; the group-scope key; a cross-course fixture proving two courses give two pseudonyms for one `user_id` |
| `tests/provenance/boundary.test.ts` | mirror of the §6.3 registry — CI holds the two identical `[R]` |
| `tests/pseudonymizer.coverage.test.ts` | mirror of `PSEUDONYMIZER_WRAPPED_TOOLS` `[R]` |

**Fixtures must cover the shapes that look impossible.** A realistic fixture set
is not "one of each documented type"; it is the arms that break naive code:

1. A `ContextMessage` item with **only** the common prefix and no type-specific
   fields (§3.1).
2. A **group-context** item with `group_id` and **no `course_id` key** (§1 C7) —
   the single most likely source of a production crash, since every consumer will
   reach for `course_id`.
3. A `Submission` item with ~~the full merged `submission_json` including~~ the
   merged `submission_json`'s `user` and `submission_comments` (§3.1) — the PII
   and fencing worst case.

   > **Corrected 2026-10-10 (BRU-2863).** No single `Submission` item carries
   > "the full merged `submission_json`", so one fixture cannot be it and
   > claiming otherwise is what made the gap invisible. `SUBMISSION_OTHER_FIELDS
   > = %w[attachments discussion_entries proxy_submitter]` is default-on, and
   > which of those keys appear depends on the submission: a text entry has no
   > `discussion_entries`, and only a submission made on a student's behalf has
   > `proxy_submitter`. **Three** `Submission` fixtures are required — text
   > entry, discussion (with a nested `recent_replies[]` and a deleted entry),
   > and proxy — plus a guard fixture for a `proxy_submitter` with no
   > `proxy_submitter_id`. Each comment in the text-entry fixture must also
   > carry the nested `author` object, because `submission_comment_json` emits
   > it beside `author_name`; without it the fixture understates the arm and a
   > pseudonymizer that masks only `author_name` reads as correct.
4. A planner item with `submissions: false` **and** one with `submissions: {…}`
   (§7.2).
5. A planner note with **no `html_url`** (§3.2).
6. A `message` of exactly 4096 characters, asserting we add no truncation flag
   (§7.3) — the guard against someone later adding the heuristic.

**Manifest and counts.** `pnpm generate:manifests` regenerates
`docs/generated/tool-manifest.json`, which embeds each tool's `description`
`[R]`, so every description edit in these increments drags the generated file
along — expect it in each PR and do not hand-edit it. Counts move
**167 → 170** tools and the `student` audience **8 → 11** `[P]`; domains stay at
**42** (§4.1). Every doc that states a count is CI-gated, so the regeneration and
the prose edits must land in the same PR.

**No CHANGELOG edit.** It is release-please-generated here and an open
`chore(main): release …` PR owns the file; the conventional commit subject is the
entry.

---

## 9. Implementation plan

Four increments plus one deferred, strictly ordered. Each is one PR.

### Increment 1 — `get_my_activity_stream_summary` (**S**)

`src/canvas/activity-stream.ts` (`getSummary`), facade registration,
`CanvasActivityStreamSummaryEntry`, the tool, tests, manifest, docs (167 → 168).

- **AC-1 — the `request()`/`paginate()` discriminator is asserted, not assumed.**
  A mocked-fetch test asserts the requested URL is exactly
  `/api/v1/users/self/activity_stream/summary` **with no `per_page` parameter**.
  Prove it is load-bearing by switching the module to `paginate()` and showing
  this one assertion fails. (§5.1: the summary is the one unpaginated endpoint,
  so this is the inverse of AC-5 and the two must not be copy-pasted.)
- **AC-2** `only_active_courses: true` appears on the wire when passed and is
  absent when omitted.
- **AC-3** Manifest regenerated; tool count assertions updated in the same PR.

### Increment 2 — `paginate({ maxItems })` in the shared client (**S**)

No new tool. `src/canvas/client.ts` only.

- **AC-4 — the existing pagination path is byte-identical.** `maxItems` is
  optional and no current call site passes it. Assert with a count floor over the
  existing `tests/canvas/client` pagination tests: the pre-change count passes
  unchanged.
- **AC-5 — the stop actually stops.** With a 3-page mock and `maxItems: 150`,
  exactly 2 fetches occur and 150 items return. Assert the **fetch count**, not
  only the result length — slicing after the fact would satisfy a length-only
  assertion while fetching everything (§5.2: an output cap bounds the result,
  never the work).
- **AC-6 — `assertNotTruncated` does not fire on a deliberate stop.** The same
  scenario must not throw. Prove it is load-bearing by removing the new
  early-exit guard and showing this test, and only this test, goes red.

### Increment 3 — `get_my_activity_stream` (**M**) — the large one

The tool, `anonymizeActivityStream`, the coverage-list entry, the fencing
registry entry and its test mirror, and the six fixtures from §8.

- **AC-7 — the group-context item does not crash and does not invent a
  `course_id`.** Fixture 2 round-trips with `course_id` **absent** from the
  output, not `null`.
- **AC-8 — pseudonymization covers every PII arm.** One test per arm
  (`root_discussion_entries[].user.user_name`, `author_name`, the `Submission`
  `user` + `submission_comments`, `Conversation.latest_messages`). Attribute them
  **individually**: removing each arm's dispatch must fail exactly its own test
  and nothing else. A single "no names in the output" assertion would pass with
  three of the four arms unimplemented.

  > **Amended 2026-10-10 (BRU-2863).** The parenthesised list is the §6.1
  > undercount and must not be read as the scope of this criterion. Per-arm
  > attribution is necessary but was **not sufficient**: the first
  > implementation satisfied all four bullets above and still shipped three real
  > names, because the enumeration — not the attribution — was the defect. The
  > criterion now also requires a test per surface for
  > `discussion_entries[].user_name`, `discussion_entries[].user.display_name`,
  > the `recent_replies[]` recursion, the deleted-entry case (`user` with no
  > `user_name`), `proxy_submitter` with and without its id, and
  > `submission_comments[].author.display_name`; plus a **negative sweep** over
  > every fixture asserting that no real name survives, paired with a
  > flag-off control proving the sweep can fail. The sweep is what covers a
  > surface nobody thought to enumerate — which is the failure mode this
  > criterion, as originally written, did not have an answer for.
  >
  > Where a name cannot be keyed to an id, the rule is **withhold, never pass
  > through**: a `proxy_submitter` with no `proxy_submitter_id`, or a
  > `user_display_json` object with no `id`, gets `WITHHELD_AUTHOR_NAME`. And
  > where a name IS rewritten, the sibling `avatar_image_url` / `pronouns` are
  > nulled, for parity with `applyPseudonymToUser`, which already does this for
  > `avatar_url` / `pronouns` on a full `CanvasUser`.
- **AC-9 — fencing hits exactly the intended fields.** Assert the fenced-field
  set returned by the walk equals `['comment','body','message']` on fixture 3,
  and that `assignment.name`, `course.name` and `title` are **unfenced** — the
  §6.3 over-match risk, which only fixture 3 can exercise.
- **AC-10 — pseudonymizer and fence do not both rewrite a name.** `author_name`
  is pseudonymized and **not** fenced (§6.3); assert the output carries no
  provenance marker inside it.
- **AC-11 — `max_items` truncation metadata.** With a 250-item mock and
  `max_items: 100`: `truncated === true`, `truncation_note` non-null and naming
  `max_items`, `items.length === 100`. And with a 10-item mock:
  `truncated === false`, `truncation_note === null`, `retention_note` still
  present (§7.1).

### Increment 4 — `list_my_planner_items` (**M**)

`src/canvas/planner.ts`, types, the tool, fixtures 4–5, docs (169 → 170).

- **AC-12 — both-or-neither dates reject with a reason.** `start_date` alone is
  rejected with a message naming the ten-year default (§1 C9); both together are
  accepted; neither is accepted and the resolved window is echoed (§7.1).
- **AC-13 — `context_codes: []` is rejected.** Not "silently means all contexts"
  (§5.3). Pair it with a control asserting that *omitting* the field does send no
  `context_codes` and is the documented all-contexts behaviour — otherwise the
  rejection test passes on a tool that is broken for the valid case too.
- **AC-14 — `submissions: false` and `submissions: {…}` both round-trip** with no
  `undefined` reads (§7.2).
- **AC-15 — the nine-plannable-type fixture contains no `user` / `user_name`
  key**, which is what keeps the §6.1 "not PII-bearing" decision honest. Prove it
  is not vacuous by asserting the fixture covers all nine `plannable_type`
  values.

### Increment 5 — deferred: `list_announcements_across_courses` (**S**)

Gated on §7.1 shipping. Not part of this MVP. Its own acceptance criteria must
include the §1 C8 silent-drop detection via `requested_context_codes`.

### Validation in every increment

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Note `pnpm lint` is
`prettier --check src/ tests/` plus ESLint — `README.md` is deliberately outside
it, so do not run prettier over the README `[R]`. Note also that `tsconfig.json`
excludes `tests/`, so "typecheck passed" says nothing about test files `[R]`.

---

## 10. Rollout and compatibility

- **Purely additive.** Three new read-only tools, two new Canvas modules, one new
  optional parameter on `client.paginate()`. No existing tool's name, input,
  output or behaviour changes. A `feat` minor per increment.
- **The library surface grows.** `canvas-lms-mcp/canvas` is an exported entry
  point, so `canvas.activityStream` and `canvas.planner` become public API on
  increment 1 and 4. `client.paginate()`'s new optional argument is
  source-compatible for every existing consumer.
- **Role filtering.** All three are `student`-audience, so a `--role=teacher`
  deployment will not register them. That is correct and intended, but it is a
  visible change to the `teacher` tool count of **zero** and to the `student`
  count of **+3**; the audience-runtime-parity test enforces the manifest agrees
  with what a role filter actually registers `[R]`.
- **Rollback** is per-increment and clean: each PR removes three files or fewer
  plus registry entries. Increment 2 is the only one touching a shared file; its
  AC-4 count floor is what makes reverting it safe to reason about.
- **No release date is promised.** Out of scope per the brief.

---

## 11. Open questions

These are decisions I did not make. Q1 and Q3 are the two that would change the
shape of the work.

| # | Question | Why it is not mine |
| - | --- | --- |
| **Q1** | Is the demand real? The brief's evidence is a competitor release. I did not read its design (the brief forbids it) and cannot measure demand. | Product call. Board/CTO. |
| **Q2** | Should a numeric `course_ids` convenience input be added once BRU-2730's `canvasIdList()` exists? §2 forbids adding one now. | Depends on BRU-2730's phasing. |
| **Q3** | `student` domain vs `dashboard` domain for the three tools (§4.1). I recommend `student` on the naming convention; `dashboard` is a defensible alternative. | Boundary taste; the one call I would change on request. |
| **Q4** | Rename the existing mis-named `CanvasActivityStreamItem` → `CanvasActivityStreamSummaryEntry` (§1 C2)? Mechanical, but it touches `analytics.ts` and its tests, and bundling it would make increment 1 a rename PR. | Scope call. Suggest its own `chore` issue. |
| **Q5** | `/users/self/todo` accepts a `course_ids` filter we do not expose (§1 C1). Worth a follow-up? | Separate tool, separate issue. |
| **Q6** | Both-or-neither planner dates (§5.3) vs filling the missing side with Canvas's ±2-week default. I chose rejection; the alternative is friendlier and diverges from the documented endpoint. | User-visible behaviour. |
| **Q7** | The `` `_group_${group_id}` `` pseudonym scope (§6.2) is the first scope that is neither a course nor derived from one. Needs the FERPA spec owner's sign-off. | Privacy policy, above IC authority. |
| **Q8** | `list_announcements` is unfenced while `list_account_notifications` is fenced for the same text (§6.3). Pre-existing, out of scope here. | Its own issue. |
| **Q9** | Structured output for these tools — deferred to the structured-output project's next batch rather than special-casing the summary tool alone (§7.4). | Owned by that project. |
| **Q10** | If Canvas ever adds a truncation marker to stream `message`, surface it (§7.3). | Upstream-dependent. |

---

## Appendix A — Reproducing the measurements

Every `[S]` claim is at Canvas SHA `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.

```bash
SHA=1c9f0bb8013ed69c4f2efe11fd483025469b7e6c
get() { gh api "repos/instructure/canvas-lms/contents/$1?ref=$SHA" --jq .content | base64 -d; }
```

| Claim | Command | Expected |
| --- | --- | --- |
| stream `default_per_page: 21` | `get lib/api/v1/stream_item.rb \| grep -n default_per_page` | `Api.paginate(scope, self, …, default_per_page: 21)` |
| `MAX_PER_PAGE`, `PER_PAGE` | `get lib/api.rb \| grep -nE '^  (PER_PAGE\|MAX_PER_PAGE)'` | `10`, `100` |
| per_page resolution order | `get lib/api.rb \| grep -n per_page_requested` | `params[:per_page] \|\| options[:default] \|\| PER_PAGE` |
| 4-week TTL | `get app/models/stream_item.rb \| grep -n stream_items_ttl` | `Setting.get("stream_items_ttl", 4.weeks)` |
| 4096 truncation + 3-entry cap | `get app/models/stream_item.rb \| grep -cE '4\.kilobytes\|LATEST_ENTRY_LIMIT'` | **7** lines: 3 × `[0, 4.kilobytes]` truncation sites and 4 × `LATEST_ENTRY_LIMIT` (its `= 3` definition plus 3 uses) |
| summary is unpaginated | `get lib/api/v1/stream_item.rb \| sed -n '/def api_render_stream_summary/,/end/p'` | no `Api.paginate` |
| the `else raise` arm | `get lib/api/v1/stream_item.rb \| grep -n 'Unexpected stream item type'` | present |
| `context_data` derives the key | `get lib/api/v1/context.rb \| grep -n 'context_type.underscore'` | `"#{context_type.underscore}_id" => id.to_i` |
| the doc block contradicting it | `get app/controllers/users_controller.rb \| grep -nE "'context_type'\|'group_id'"` | `'context_type': 'course'`, `'group_id': null` |
| announcements requires context_codes | `get app/controllers/announcements_api_controller.rb \| grep -n 'Missing context_codes'` | 400 render |
| announcements window | same file, `grep -n '14.days.ago'` | `@start_date \|\|= 14.days.ago…; @end_date \|\|= @start_date + 28.days` |
| announcements has no `authorized_action` on index | `get app/controllers/announcements_api_controller.rb \| grep -n authorized_action` | **4** lines, all at 158/159/166/167 — two `authorized_action(` calls plus two `render_unauthorized_action`, every one inside the two accessibility actions. **Zero inside `index`** |
| `latest_only` | same file, `grep -n 'DISTINCT ON'` | `select("DISTINCT ON (context_id) *")` |
| planner asymmetric dates | `get app/controllers/planner_controller.rb \| sed -n '/def set_date_range/,/^  end/p'` | `2.weeks` both-blank, else `10.years` |
| planner unions 9 collections | same file, `sed -n '/def planner_items/,/^  end/p'` | 9 `*_collection` calls |
| `todo_items` unions 2 | `get app/controllers/users_controller.rb \| sed -n '/def todo_items/,/^  end/p'` | `assignments_needing_grading`, `assignments_needing_submitting` |
| `upcoming_events` 1-week / 20 cap | `get app/models/user.rb \| grep -n '1.week.from_now'` | `opts[:end_at] \|\|= 1.week.from_now; opts[:limit] \|\|= 20` |
| `context_name` is a nickname | `get lib/api/v1/planner_item.rb \| grep -n nickname_for` | `context.try(:nickname_for, @user) \|\| context.name` |
| `submissions: false` default | same file, `grep -n 'submissions: false'` | `submission_status = { submissions: false }` |

`[P]` / `[R]` claims, against this repository at `origin/main`:

| Claim | Command | Expected |
| --- | --- | --- |
| BRU-2730 is unimplemented | `git grep -c 'canvasIdInput\|CanvasWireId\|canvas-string-ids' origin/main -- src/` | **0 matches** — this is the precondition verdict (§2), so run it before starting and re-run it if the increments are picked up later |
| 167 tools / 42 domains / 8 student | `node -e` over `docs/generated/tool-manifest.json` | `167`, `42`, `{"shared":50,"admin":12,"educator":97,"student":8}` |
| only 5 tools have output contracts | same, filter `structuredOutput` | `5` |
| all 5 `get_my_*` tools are in `student` | same, filter `name.startsWith('get_my_')` | all `domain === 'student'` |
| 31 canvas modules vs 56 tool files | `git ls-tree origin/main src/canvas/ --name-only \| wc -l` and same for `src/tools/` | `31`, `56` |
| one tool domain spans 4 canvas modules | `git show origin/main:src/tools/student.ts \| grep -o 'canvas\.\w*' \| sort -u` | `submissions`, `users`, `courses`, `enrollments` |
| `paginate` sets `per_page=100`, `request` sets none | `git show origin/main:src/canvas/client.ts \| grep -c per_page` | **4** matching lines — a `has` guard and a `set` in each of the two paginators (client.ts 97/98 and 138/139); **none** inside `request()` |
| `assertNotTruncated` throws on a non-null `nextUrl` | same file, `grep -n -A6 assertNotTruncated` | throws `Results are incomplete: …` |
| `maxPaginationPages` default | same file, `grep -n DEFAULT_MAX_PAGINATION_PAGES` | `1000` |
| `appendCanvasQuery` skips empty arrays and adds `[]` | `git show origin/main:src/canvas/query.ts` | `if (value.length === 0) continue`, `${key}[]` |
| `context_codes` precedent is `z.string()` | `git grep -n context_codes origin/main -- src/tools/` | `z.array(z.string())` in `appointment-groups.ts` |
| no existing `anonymize*` takes a stream item | `git show origin/main:src/pseudonym/pseudonymizer.ts \| grep -n 'async anonymize'` | 7 public methods, none matching |
| the `truncated` + `truncation_note` precedent | `git show origin/main:src/tools/submission-files.ts \| sed -n '165,178p'` | the envelope copied in §7.1 |
