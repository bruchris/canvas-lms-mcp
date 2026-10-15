# Design: student course requirement graph (BRU-2952)

- **Status**: design only. No source, tools, manifests, or lockfile changes in the PR that carries this document.
- **Issue**: BRU-2952 (parent BRU-2947, 2026-10-15 product research).
- **Author**: Lead Developer.
- **Date**: 2026-10-15.
- **Repo baseline**: `origin/main` at `ae64c77` (release 2.4.2).
- **Canvas baseline**: `instructure/canvas-lms` `master` pinned at `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`. Every Canvas claim below is anchored to a file in that tree.

## 0. Evidence grading

Every behavioural claim carries a tag. A design that mixes these silently is how a wrong premise survives review.

| Tag | Meaning |
| --- | --- |
| **[D]** | Instructure developer documentation (the YARD `@API` comments that generate `canvas.instructure.com/doc/api`). |
| **[S]** | Canvas source read at the pinned SHA — serializer, model, or controller. |
| **[P]** | Executed against this repo (`origin/main`) — a read of our own code or a run of our own tooling. |
| **[I]** | Inference. Stated as inference, with the facts it rests on. |

The competitor named in the research issue (`angelonrevelo/bettercanvasmcp`) is treated **only** as a demand signal. No field, acceptance criterion, state name, or behavioural claim in this document comes from it; none of its code or docs was read for behaviour. Where this design disagrees with what a wrapper would plausibly do, that is noted as our own conclusion.

## 1. Corrections to the brief's premises — read first

The research issue's framing is mostly right, but four of its specifics do not survive contact with the source. They change the design, so they lead.

### 1.1 There are **six** module completion-requirement types, not five

The brief lists `must_view` / `must_contribute` / `must_submit` / `min_score` / `must_mark_done`. The validated set in `app/models/context_module.rb` `validate_completion_requirements` also contains **`min_percentage`** [S]:

```ruby
scoreable_types = %w[must_submit min_score min_percentage]
validated_reqs = requirements.select do |req|
  if req[:id] && (tag = tags[req[:id]])
    if %w[must_view must_mark_done must_contribute].include?(req[:type])
      true
    elsif scoreable_types.include?(req[:type])
      true if tag.scoreable?
```

and the serializer emits its threshold under a **different key** from `min_score` (`lib/api/v1/context_module.rb`) [S]:

```ruby
ch["min_score"] = criterion[:min_score] if criterion[:type] == "min_score"
ch["min_percentage"] = criterion[:min_percentage] if criterion[:type] == "min_percentage"
```

A design that enumerates five types ships a sixth type that falls through to the default arm. Every table in this document uses the six.

### 1.2 A module's requirements are not necessarily conjunctive — `requirement_type: "one"` exists

`module_json` emits `requirement_type` unconditionally, and `ContextModule#requirement_type` is derived [S]:

```ruby
def requirement_type
  (completion_requirements.present? && requirement_count == 1) ? "one" : "all"
end
```

Under `"one"`, the module is complete when **any single** requirement is met — `evaluate_requirements_met` sets `completed` on `result.met_requirement_count >= count_needed` [S]. So a module showing five unsatisfied rows and one satisfied row is a **completed** module. Any rollup that counts unsatisfied rows and reports "5 things left to do" is wrong on exactly this course design, and wrong in the direction that makes a student do unnecessary work.

Note the asymmetry: `requirement_type` is always serialized, but `requirement_count` is serialized only behind a flag — `hash["requirement_count"] = …  if opts.fetch(:can_have_requirement_count, false)`, set from `@context.requirement_count_api_enabled?` [S]. So the **semantics** are always readable and the **integer** is not. The graph must branch on `requirement_type`, never on the presence of `requirement_count`.

### 1.3 `completion_requirement.completed` is absent, not false, when no progression was loaded

This is the single most important fact in the design. The serializer emits the requirement whenever the content tag has one, but attaches `completed` **only if a progression object was passed** [S]:

```ruby
if (criterion = context_module.completion_requirements&.detect { |r| r[:id] == content_tag.id })
  ch = { "type" => criterion[:type] }
  …
  ch["completed"] = !!(progression.requirements_met.present? && …) if progression
  hash["completion_requirement"] = ch
end
```

and a progression exists only when `find_student` resolved a student — `params[:student_id]`, or the caller being able to `participate_as_student` (`app/controllers/context_modules_api_controller.rb`, `app/controllers/context_module_items_api_controller.rb`) [S]:

```ruby
def find_student
  if params[:student_id]
    …
  elsif @context.grants_right?(@current_user, session, :participate_as_student)
    @student = @current_user
  else
    true
  end
end
```

Consequences:

- A **teacher or admin** token calling these endpoints with no `student_id` gets `completion_requirement` objects with **no `completed` key at all**. A consumer writing `cr.completed === false ? 'unsatisfied' : …` reports every requirement in the course as unsatisfied for that caller. This is the failure this design's `unknown` state exists to prevent.
- Both the module endpoints *and* the module-item endpoints carry it for a student caller. `find_student` is a `before_action` on `index`/`show` in **both** controllers [S] (`before_action :find_student, only: %i[index show select_mastery_path]`). An earlier read of mine concluded the item endpoints were progression-blind; that was wrong, and it matters because it is the difference between one fan-out shape and another.
- `require_user` is skipped for `index`/`show` on the items controller [S], so an anonymous read of a public course also yields no `completed`. Same absence, different cause.

### 1.4 Planner is not the place the "reply count" obligation becomes checkable

The brief points at `details.reply_to_entry_required_count`, which we already model [P] (`src/canvas/types.ts`, `CanvasPlannerItem.details`). It is a **required count**, not a **completed count**: it tells you the course requires N replies-to-entries, never how many the student has made. The same number is also on the discussion topic itself — `json[:reply_to_entry_required_count]` alongside `json[:is_checkpointed]`, emitted only `if topic.checkpoints?` [S] (`lib/api/v1/discussion_topics.rb`).

So planner's role in this design is strictly what the brief demands elsewhere: **context, never completion proof**. The checkable half lives in the two checkpoint sub-assignments (§5.4).

## 2. Inventory: what `origin/main` already exposes

All rows verified by reading `origin/main` at `ae64c77` [P].

| Live surface | Client call | Carries requirement evidence? | Gap |
| --- | --- | --- | --- |
| `list_modules` | `modules.list` → `GET /courses/:id/modules` | Module `state` / `completed_at` / `requirement_type` reach the client (handler returns the body un-projected). | No `include[]=items`, so **zero** per-item requirements. `CanvasModule` models 8 fields and none of the requirement fields. |
| `list_module_items` | `modules.listItems` → `…/modules/:mid/items` | `completion_requirement` reaches the client for a student caller. | No `include[]=content_details`, so no `locked_for_user` and no effective `due_at`. `CanvasModuleItem` does not model `completion_requirement` at all. |
| `get_module` | `modules.get` | Same as `list_modules`, single module. | Same. |
| `get_course_structure`, `view_course_structure` | `modules.getCourseStructure` | **No.** The handler projects each item to a 9-key allowlist that omits `completion_requirement`, and each module to a 5-key shape that omits `state`, `completed_at`, `requirement_type`, `requirement_count`. | Requirement evidence is *fetched and then discarded*. `content_details` is opt-in via `includeContentDetails`. |
| `list_discussions`, `get_discussion`, `list_group_discussions`, `get_group_discussion` | `discussions.list` / `get` / `listForGroup` / `getForGroup` | **Yes, already** — the handlers return the raw body, and `require_initial_post`, `user_can_see_posts`, `locked`, `topic_children`, `group_topic_children`, `is_checkpointed`, `reply_to_entry_required_count` are all in it. | `CanvasDiscussionTopic` models **7 fields** (`id`, `title`, `message`, `posted_at`, `discussion_type`, `published`, `is_announcement`). Everything above is untyped, undocumented, and unasserted. `get`/`getForGroup` already send `include[]=all_dates`. |
| `get_my_submissions` | `submissions.listMy` → `/courses/:id/students/submissions?student_ids[]=self` | Submission state only. | Sends **no** `include[]`, and the tool exposes no `include` input — so no `assignment`, no `submission_comments`, no `rubric_assessment`, no `sub_assignment_submissions`. |
| `list_my_planner_items` | `planner.listItems` | `submissions` status object, `plannable_date`, `details.reply_to_entry_required_count`. | Correct and bounded already (`maxItems`, `limit + 1` truncation probe). Context only, by §1.4. |
| `get_todo_items` | `dashboard.listTodo` → `/users/self/todo` | Assignments needing submitting. | Narrower than planner; no module or discussion obligations. |
| `list_assignment_overrides`, `set_student_assignment_dates` | `assignments.listOverrides` | Override rows. | Educator-audience and override-authoring; not the student's effective-date path (§5.5). |
| `list_assignments`, `get_assignment` | `assignments.list` / `get` | `all_dates`, `overrides`, `submission` are all available as `include` options already [P]. | Not wired to any requirement view. |

Two conclusions fall out:

1. **Almost nothing is missing from the wire.** Of the signals this design needs, exactly two require a new request parameter: `include[]=items` on the modules list (or the per-module item fan-out) and `include[]=content_details` for lock state and effective dates. Everything else already reaches the caller today.
2. **What is missing is a contract.** Four of the five evidence-bearing fields are not in our types, not in any output contract (`grep` over `src/tools/output/` and `tests/tools/fixtures/output-fixtures.ts` for these five tool names returns nothing [P]), and not in any description. A caller has no way to know `completed` can be absent, or that `user_can_see_posts` means what §5.3 says it means.

## 3. The output model

### 3.1 States

Five states, as the brief requires, with the evidentiary rule that makes each one reachable.

| State | Meaning | Required evidence |
| --- | --- | --- |
| `satisfied` | Canvas itself records the requirement as met. | `completion_requirement.completed === true`, or the §5.3 two-field discussion derivation, or a checkpoint sub-assignment with a submitted state. |
| `unsatisfied` | Canvas records it as not met **and** we can rule out every "we cannot see it" case in §3.3. | `completed === false` plus the disambiguation in §4.2. |
| `unknown` | The requirement exists; its state is not determinable from what the caller is allowed to see. | `completed` key **absent**; or `completed === false` on a numeric requirement whose matching submission is unposted (§4.2); or an opaque item type (§5.6). |
| `blocked` | The requirement cannot currently be acted on, regardless of its own state. | `content_details.locked_for_user === true`, or module `state === 'locked'`, or an unsatisfied prerequisite module, or `require_sequential_progress` with the item past the current position. |
| `not_required` | The item is in the module but carries no completion requirement. | No `completion_requirement` key on the item. |

`not_required` is a sixth state the brief does not name, and it is not optional: without it, an item with no requirement is either silently dropped (and the student cannot see the module's shape) or coerced into `unknown` (and the `unknown` count becomes meaningless). It is distinct from `unknown` in exactly the way that matters — `not_required` is a **fact**, `unknown` is an **absence of fact**.

### 3.2 Every row names its evidence

Each row in the graph carries a `provenance` object. This is the contract clause that makes the whole thing truthful, and it is the clause a wrapper omits.

```
{
  state: 'satisfied' | 'unsatisfied' | 'unknown' | 'blocked' | 'not_required',
  requirement: { type: 'must_view' | 'must_contribute' | 'must_submit'
                       | 'must_mark_done' | 'min_score' | 'min_percentage',
                 min_score?: number, min_percentage?: number } | null,
  provenance: {
    source: 'module_item.completion_requirement'
          | 'discussion_topic.user_can_see_posts'
          | 'submission.workflow_state'
          | 'checkpoint_submission'
          | 'module_item.content_details.locked_for_user'
          | 'module.state'
          | 'module.prerequisite',
    endpoint: string,   // the exact Canvas path the fact came from
    field: string,      // the exact field read
    caveat: string | null
  },
  context: { … }        // planner/page text etc. NEVER a `source`
}
```

Two rules on this object:

- **`context` can never promote a row.** Planner items, page bodies, `plannable_date`, and assignment descriptions populate `context`. No value in `context` may be read when computing `state`. This is a code-level invariant, not a convention: the state function should take only the evidence subtree as its argument (§7.2), so a planner field is not in scope at the call site where state is decided.
- **`caveat` is not decoration.** The excusal case (§4.1) and the unposted-score case (§4.2) are *correct* `satisfied` / `unknown` verdicts that a student will misread without the sentence. Every rule in §4 that produces a surprising verdict sets `caveat`.

### 3.3 The four ways `completed === false` is not "unsatisfied"

Ranked by how often a real course hits them.

1. **No progression was loaded** — the key is absent, not false (§1.3). Caller is not a student, or is an unauthenticated reader of a public course.
2. **An unposted grade on a numeric requirement** (§4.2). `evaluate_numeric_requirement_met` returns early, so the stored action stays absent, so `completed` is `false` — identically to scoring below the threshold.
3. **A latched requirement whose event was never recorded** (§4.3). `must_contribute` and `must_mark_done` are re-evaluated as `false` on every pass; only a side-effecting event sets them. Genuinely unsatisfied, but *undiscoverable from any other endpoint* — so the row is honest only if it says so.
4. **The item is invisible to the student.** `completion_requirements` is iterated against `content_tags_for(user, …)` and `next unless tag` [S] — a requirement on a tag the student cannot see is skipped entirely, and the module can therefore complete with requirements the student never saw. This produces no row at all, which is correct, but it means **row count is not a stable property of the course** across callers.

## 4. Precedence rules, derived from the evaluator

All from `app/models/context_module_progression.rb` at the pinned SHA [S].

### 4.1 Excusal beats everything, silently

```ruby
subs = get_submissions(tag) if tag.scoreable?
if subs&.any? { |sub| sub.respond_to?(:excused?) && sub.excused? }
  calc.check_action!(req, true)
  next
end
```

An excused submission marks the requirement met **before** the type is even examined. So `must_submit`, `min_score`, and `min_percentage` all read `completed: true` on an excused assignment the student never touched.

**Rule.** `satisfied`, with `caveat` naming excusal whenever the matching submission has `excused === true`. Reporting a bare `satisfied` here is defensible and useless; reporting `unsatisfied` because nothing was submitted contradicts Canvas.

### 4.2 `min_score` / `min_percentage`: unposted is indistinguishable from below-threshold *in the module payload*

```ruby
if (unposted_sub = subs.detect { |sub| sub.is_a?(Submission) && !sub.posted? })
  update_incomplete_requirement!(requirement, nil) unless unposted_sub.unsubmitted?
  return
end
```

The early `return` yields `nil`, the action is never added, `completed` serializes as `false`. Canvas keeps the discriminating detail in `incomplete_requirements` (`score: nil` for unposted vs a number for below-threshold) — and **`incomplete_requirements` is not serialized by `module_json` or `module_item_json`** [S]. There is no `include[]` that exposes it.

**Rule.** On an unsatisfied numeric requirement, cross-reference the student's own submission for that assignment:

- submission exists, `posted_at` is null (or `score` is null with a non-`unsubmitted` `workflow_state`) → **`unknown`**, caveat "submitted; grade not yet posted, so Canvas cannot evaluate the threshold".
- submission has a posted score below the threshold → **`unsatisfied`**, caveat carrying score and threshold.
- no submission → **`unsatisfied`**, caveat "nothing submitted".

This is the one place the design *requires* a second endpoint to produce a truthful row, and it is why the recommended option in §8 is not "add a field to `list_module_items`".

One further asymmetry: the `CompletedRequirementCalculator` constructor drops stored numeric actions (`actions_done.reject! { |r| r[:type] == "min_score" || r[:type] == "min_percentage" }` [S]), so numeric requirements are **recomputed on every evaluation** while the other four are **latched**. A numeric requirement can therefore go from `satisfied` back to `unsatisfied` without the student doing anything (a grade change, a posting-policy change, a regrade). The other four cannot. Worth one sentence in the tool description.

### 4.3 `must_view` can be satisfied by submitting, and `must_contribute` by nothing we can see

```ruby
def check_view_requirements
  view_requirements.each do |req|
    # should mark a must_view as true if a completed must_submit/min_score/min_percentage action already exists
    check_action!(req, requirement_met?(req, include_type: false))
  end
end
```

`must_view` is resolved **last**, against the type-agnostic action set — so a submit action satisfies a `must_view` requirement on the same tag.

```ruby
elsif %w[must_contribute must_mark_done].include? req[:type]
  # must_contribute is handled by ContextModule#update_for
  calc.check_action!(req, false)
```

**Rule.** For `must_contribute` and `must_mark_done`, trust the stored `completed` and emit a caveat stating that Canvas records these only from an in-app action and that no other endpoint can corroborate them. Specifically: **do not** attempt to derive `must_contribute` on a discussion from the student having entries in the topic. The two are set by different code paths and can legitimately disagree, and inventing the inference would make a wrong row look authoritative.

### 4.4 `must_submit`: a graded-with-no-attempt submission is **not** a submission (except on a checkpointed discussion)

```ruby
if sub.workflow_state == "graded" && sub.attempt.nil? && !(
  tag.content_type_discussion? &&
  tag.content&.assignment&.checkpoints_parent?
)
  # is a manual grade - doesn't count for submission. Excluding discussion checkpoints
  false
elsif %w[submitted graded complete pending_review].include?(sub.workflow_state)
  true
end
```

So a teacher entering a grade by hand does **not** satisfy `must_submit` — unless the item is a checkpointed discussion, where it does. Four `workflow_state` values count as submitted: `submitted`, `graded`, `complete`, `pending_review`.

**Rule.** Never derive `must_submit` from `workflow_state === 'graded'` alone. If the graph corroborates a `must_submit` row against a submission, it must reproduce the `attempt === null` carve-out and the checkpointed-discussion exception, or omit the corroboration and report Canvas's `completed` verbatim. The recommended option does the latter for `must_submit` — Canvas's own answer is already correct, and a second implementation of this rule is a second place to be wrong.

### 4.5 Rollup

Given per-row states and the module's `requirement_type`:

- `requirement_type === 'one'`: module is `satisfied` if **any** row is `satisfied`. If none is and at least one is `unknown`, the module is `unknown` — not `unsatisfied`.
- `requirement_type === 'all'`: module is `satisfied` only if every requirement row is `satisfied`; `unknown` if any row is `unknown` and none is `unsatisfied`; `unsatisfied` otherwise.
- `blocked` on the module (from `state === 'locked'` or an unsatisfied prerequisite) **overrides** the row rollup, and the rows are still returned — a student needs to see what is waiting behind the lock.
- Where the module's own `state` is present, report it **alongside** the derived rollup and flag any disagreement rather than preferring one. A disagreement means our rules are wrong or the progression is stale (`outdated?` / `mark_as_outdated` exist in the model [S]), and both are things a caller should hear about rather than have resolved for them.

## 5. Bounded fan-out and the hard cases

### 5.1 The `include[]=items` cliff — a silent zero

```ruby
if includes.include?("items") && count <= Api::MAX_PER_PAGE
```

`Api::MAX_PER_PAGE = 100` [S] (`lib/api.rb:23`; `PER_PAGE = 10` on the same line pair). A module with **101 or more** items returns **no `items` key at all** — not a truncated array, not an error.

Our own `getCourseStructure` then does `let items = mod.items ?? []` [P], so such a module is reported with zero items and `summary.total_items` is silently undercounted. That is a pre-existing reporting defect in a shipped tool, independent of this design; it is recorded in §10 as a follow-up rather than fixed here, because this task is design-only.

**Rule for the graph.** Never treat a missing `items` key as an empty module. Compare `items_count` against `items.length`; on mismatch or absence, fall back to the per-module `…/modules/:mid/items` endpoint (which paginates properly) and set a note. A module with `items_count > 100` is the *common* shape in a large content-heavy course, not an exotic one.

### 5.2 Request budget

The graph is **course-scoped by construction** — a cross-course variant multiplies every bound below by the course count and is explicitly out of scope (§9).

| Phase | Requests | Bound |
| --- | --- | --- |
| Modules + inlined items | 1 page, then `Link rel="next"` | `maxItems` on modules, with `per_page=100` set explicitly (never rely on the `PER_PAGE = 10` default — the same hazard already documented for planner and activity stream [P]). |
| Oversized-module recovery | 1 paginated call per module where `items.length !== items_count` | Hard cap; past the cap, remaining modules are returned with `state: 'unknown'` rows and a truncation note. |
| Student submissions | 1 paginated call, `student_ids[]=self` | One call for the whole course. Needed only if any `min_score`/`min_percentage` row is unsatisfied (§4.2) — skip it entirely otherwise. |
| Discussion topics | 1 paginated course-level call | Needed only if a `require_initial_post` or checkpointed topic appears as a module item or is requested. Never one call per topic. |
| Group child topics | 1 call for the student's groups, then only the child topics their groups own | §5.3. |
| Planner (`context` only) | 0 by default | Opt-in via a parameter. It is context, so it must not be on the critical path. |

Every phase must be expressible as "N requests where N is a function of module count, not item count", and the truncation flag must follow the repo's established pattern: fetch `limit + 1`, report `truncated` plus a `truncation_note` naming the parameter to change — exactly as `list_my_planner_items` and `get_my_activity_stream` already do [P]. The existing comment in `src/canvas/planner.ts` makes the reason explicit: `paginate()` reports what it accumulated, never whether more was waiting.

### 5.3 `require_initial_post`: a sound two-field derivation, valid only for a student caller

`serialize_additional_topic_fields` emits both fields unconditionally [S]:

```ruby
fields = { require_initial_post: topic.require_initial_post?,
           user_can_see_posts: topic.user_can_see_posts?(user),
```

and the predicate is [S] (`app/models/discussion_topic.rb`):

```ruby
def user_can_see_posts?(user, session = nil, associated_user_ids = [])
  return false unless user

  !require_initial_post? || grants_right?(user, session, :read_as_admin) ||
    ([user.id] + associated_user_ids).intersect?(user_ids_who_have_posted_and_admins)
end
```

Therefore, **for a caller who is a student in the course and not an admin**:

| `require_initial_post` | `user_can_see_posts` | Verdict |
| --- | --- | --- |
| `true` | `false` | Initial post **not** made → `unsatisfied`. Positive evidence, not an inference from silence. |
| `true` | `true` | Initial post made → `satisfied`. |
| `false` | `true` | No initial-post obligation → `not_required`. |
| `false` | `false` | Unreachable for an authenticated caller (the predicate's first disjunct). If observed, `unknown` and log it — it means our model of the predicate is wrong. |

This is strictly better than probing the entries endpoint, which costs a request per topic and answers with a 403 that is ambiguous between "you have not posted" and "you cannot read this topic".

**The guard that makes it safe.** `grants_right?(:read_as_admin)` short-circuits to `true`, and `user_ids_who_have_posted_and_admins` counts admins as having posted. So for a teacher, TA, admin, or account-level token the derivation **always reads `satisfied`** and is worthless. The rule must therefore be: emit this row only when the caller's own enrollment in the course is a student enrollment; otherwise emit `unknown` with a caveat naming the admin short-circuit. Shipping the derivation without that gate produces a confidently wrong "you have posted everywhere" for every educator caller.

### 5.4 Checkpointed discussions

`reply_to_entry_required_count` and `is_checkpointed` are emitted only `if topic.checkpoints?` [S]. The two obligations are separate sub-assignments, `CheckpointLabels::REPLY_TO_TOPIC` and `CheckpointLabels::REPLY_TO_ENTRY` [S] (`app/models/discussion_topic.rb`), each with its own due date and its own submission.

So a checkpointed discussion is **two rows**, not one:

- *reply to topic* — satisfied from the `REPLY_TO_TOPIC` sub-assignment's submission state.
- *reply to entries* — requires N replies, where N is `reply_to_entry_required_count`. **Canvas does not expose a per-student "replies made" counter on either the topic or the planner item.** The sub-assignment's submission state answers "has the student met the checkpoint" as a binary; the count is the requirement, never the progress.

**Rule.** Emit the count as the requirement, emit the sub-assignment's submission state as the evidence, and never render "2 of 3 replies done" — that figure does not exist in the API and would be fabricated. Where the sub-assignment submission is not reachable, `unknown`. And note that §4.4's carve-out applies here in reverse: on a checkpointed discussion, a hand-entered grade *does* satisfy `must_submit`.

Our `get_my_submissions` sends no `include[]` [P], so sub-assignment submissions are not currently reachable through it. This is the second of the two genuine wire gaps (§2).

### 5.5 Overrides and effective due dates

The good news is already in the serializer. `content_details` applies the caller's overrides before reading the dates [S]:

```ruby
item = item.assignment if item.is_a?(DiscussionTopic) && item.assignment
item = item.overridden_for(current_user) if item.respond_to?(:overridden_for)
attrs = %i[usage_rights locked hidden lock_explanation display_name due_at unlock_at lock_at points_possible]
attrs.each do |attr|
  if (val = item.try(attr))
    details[attr] = val
  end
end
```

So `content_details.due_at` **is** the effective, override-applied due date for the calling user. The graph should use it and should **not** reconstruct effective dates from `list_assignment_overrides` — that tool exists for educators authoring overrides, needs permissions a student does not have, and would be a second implementation of Canvas's own resolution.

Two traps in the same five lines:

- The `if (val = item.try(attr))` guard is a **truthiness** test, so `points_possible: 0` and `locked: false` are **omitted from the hash entirely**. Absence of `locked` must not be read as "not locked"; absence of `points_possible` must not be read as "no value".
- The authoritative lock signal is a different field. `locked_json` always sets `locked_for_user` and adds `lock_info` / `lock_explanation` only when locked [S] (`lib/api/v1/locked.rb`). `locked_for_user` is therefore the reliable boolean and the correct source for the `blocked` state; `details[:locked]` is not.

`require_sequential_progress` is on the module and serialized [S], but the progression's `current_position` is **not**. So "this item is locked because you have not finished the previous one" is only observable per-item via `content_details.locked_for_user`. That is the justification for `include[]=content_details` being mandatory rather than optional in this design.

### 5.6 New Quizzes and LTI: opaque by construction

A New Quizzes assignment appears as a module item of type `Assignment` (not `Quiz`), and a plain LTI placement appears as `ExternalTool`. For `ExternalTool` items the serializer emits `external_url` and a sessionless launch URL [S] — and nothing about what the student did inside the tool. Canvas's own requirement evaluation reaches these through the associated submission where one exists (`get_submissions` falls through to `Submission.active.where(assignment_id: tag.content_id …)` [S]) and not at all where none does.

**Rule.** `ExternalTool` and `ExternalUrl` items with a `must_view` or `must_contribute` requirement are `unknown` unless `completed` is present, and when it is present it is reported verbatim with a caveat that the underlying activity is outside Canvas. New Quizzes items are handled as ordinary `Assignment` items with no special casing — their `must_submit`/`min_score` rows go through the same submission evidence. **No quiz is started, no attempt is created, and no LTI launch is performed**, which is both a privacy constraint (§6) and the reason a launch-based "did they do it" probe is not on the table.

## 6. Security and privacy constraints

Non-negotiable, and each one is a test in §11.

1. **Current user only, by default.** The graph's identity source is `self` — `student_ids[]=self` on submissions, no `student_id` parameter on the modules calls. A `student_id` parameter would make the tool an educator surveillance surface and would silently change the meaning of every `user_can_see_posts` row (§5.3). If a teacher-facing variant is ever wanted it is a separate tool with a separate audience tag and a separate PII review, not a parameter on this one. **Recommendation: no `student_id` parameter in v1.**
2. **No writes, no state mutation, no attempt starts.** `readOnlyHint: true`, no `destructiveHint`. Note that Canvas's own `must_view` requirements are satisfied *by viewing*, through `mark_as_read`-style endpoints the module-items controller also hosts; this tool touches none of them. A read-only requirement graph must not be able to complete a requirement as a side effect of being called.
3. **No session-cookie reuse and no HTML-page scraping.** Every fact comes from `/api/v1` with the configured token through `CanvasHttpClient`. The repo has no cookie path and must not gain one for this.
4. **Untrusted-content fencing.** Discussion titles, assignment names, page bodies, planner notes, and `lock_explanation` are Canvas-authored and can contain instructions aimed at the calling model. `lock_explanation` is the easy one to miss — it is server-generated text with interpolated course content. Every such field must route through the existing provenance-fencing path (BRU-2104) and the tool must be added to the fencing registry in the same PR that introduces it. This is checked by the existing fencing tests, which walk by field name.
5. **PII.** The current-user-only scope means the graph should carry **no third-party user record at all**. That is a property to assert, not assume: the known hazards are the discussion topic's `author` display object (`user_display_json`, nulled when anonymous [S]) and anything reached via submission `include[]`. If the implementation surfaces either, the tool must be routed through the pseudonymizer and added to `PSEUDONYMIZER_WRAPPED_TOOLS` per `CLAUDE.md` step 6. **The stronger design is to project those fields out entirely** so the question does not arise — a requirement graph has no use for a topic's author. Recent history makes the case: BRU-2863 and BRU-2864 were both PII escapes through display objects a name-pattern audit did not pattern-match. Whichever path is taken, the PR owes an explicit negative sweep over the fixtures for every real name, paired with a control asserting those names *are* present with the feature disabled.
6. **Anonymous discussions.** `anonymous_state` is in the topic's allowed fields [S] and `author` is nulled for anonymous topics. The graph must not attempt to attribute entries in an anonymous topic, and `must_contribute` on one stays exactly as §4.3 says: Canvas's stored value, verbatim, with the caveat.

## 7. Options considered

### 7.1 Option A — incremental fields on existing tools

Type `completion_requirement` on `CanvasModuleItem`; add `require_initial_post` / `user_can_see_posts` to `CanvasDiscussionTopic`; add `include[]=items` and `include[]=content_details`; stop `get_course_structure` from stripping requirement evidence; add an `include` input to `get_my_submissions`.

- **For.** Smallest diff. Fixes the real gaps (§2) where they are. Every one of these is independently valuable even if no graph is ever built. Several are latent-defect repairs, not features.
- **Against.** Does not deliver the thing the research asked for. All the reasoning in §3 and §4 — the five states, the unposted-score disambiguation, the admin short-circuit gate, the `requirement_type: "one"` rollup — stays in the model's head, where it will be re-derived differently every call. The `completed`-absent trap (§1.3) is exactly the kind of thing a caller gets wrong, and typing the field without documenting the absence arguably makes it *more* dangerous, because now it looks modelled.

### 7.2 Option B — a new composite read-only tool (recommended)

One tool, `get_my_course_requirements(course_id)`, built on the existing clients plus the two wire additions from Option A, returning the §3 model.

- **For.** The design's value is the truth-preserving contract, and a contract needs a single enforcement point. The precedence rules in §4 become one pure function over an evidence subtree — testable against contradictory fixtures without any network, and the natural place to enforce the §3.2 invariant that `context` cannot promote a row (pass the function only the evidence, so planner fields are not in scope). The request budget in §5.2 is enforced in one place. The privacy properties in §6 are assertable about one tool.
- **Against.** A new composite tool in a 176-tool server. It overlaps `get_course_structure` in shape, and two tools that both walk modules will drift. Mitigation: the graph must **not** call `getCourseStructure` (which strips its evidence, §2) and must say so in a code comment, or a later refactor will "simplify" it into exactly the bug this design exists to prevent.

### 7.3 Option C — a student skill over existing tools

A `skills/` workflow that tells the model to call `list_modules`, `list_module_items`, `list_discussions`, `get_my_submissions` and reason about the results.

- **For.** Zero new tool surface, and the repo already serves skills as MCP prompts from one file.
- **Against.** **This is the option to reject explicitly.** Every rule in §4 becomes a prose instruction the model may or may not follow, on a question where the failure is silent and confidently wrong: a model told "`completed: false` means not done" will say a teacher's whole course is incomplete (§1.3), will count six unsatisfied rows on a `requirement_type: "one"` module (§1.2), and will read an unposted grade as a failing one (§4.2). There is no test that can hold a prompt to these rules. A skill is the right wrapper *around* Option B — "here is how to help a student plan their week, using `get_my_course_requirements`" — and the wrong substitute for it.

### 7.4 Recommendation

**Option B, delivered on top of the Option A field work, with Option C as a follow-on skill.**

The deciding argument is §4.2 plus §5.3. Both require correlating two endpoints and both have a wrong answer that looks right. Those are the two properties that make something a tool rather than a prompt, and a composite tool is the only option where they can be tested.

Scope discipline: the Option A items that are *not* needed by the graph (an `include` input on `get_my_submissions` beyond what the graph needs, un-stripping `get_course_structure`) should be split out as their own tasks rather than ride along — see §10.

## 8. Proposed interface

Named here only because §7 compared the alternatives first, per the issue's acceptance criteria.

```
get_my_course_requirements
  course_id          : CanvasId                  (required)
  include_discussions: boolean = true            // §5.3 + §5.4 rows
  include_context    : boolean = false           // §3.2 `context`; planner fan-out
  max_modules        : number  = 50  (max 200)   // §5.2 bound; `limit + 1` truncation probe
  audience           : 'student'                 // ToolDefinition tag, not an input
  annotations        : readOnlyHint, openWorldHint
```

Response, in outline:

```
{
  course_id, course_name,
  caller_is_student: boolean,     // gates §5.3; false ⇒ discussion rows are `unknown`
  modules: [{
    id, name, position,
    requirement_type: 'all' | 'one',
    requirement_count: number | null,          // null when withheld (§1.2)
    canvas_state: string | null,               // progression workflow_state, verbatim
    derived_state: 'satisfied' | 'unsatisfied' | 'unknown' | 'blocked',
    state_disagreement: boolean,               // §4.5
    rows: [ /* §3.2 */ ],
    items_truncated: boolean                   // §5.1 cliff
  }],
  summary: { satisfied, unsatisfied, unknown, blocked, not_required },
  truncated: boolean,
  truncation_note: string | null,
  notes: string[]                              // non-fatal degradations
}
```

`summary` deliberately reports five counts rather than one "things left to do" number. A single number cannot be computed honestly across mixed `requirement_type` values and a non-zero `unknown` count, and inventing one is the failure mode this whole design is arguing against.

Output contract per `CLAUDE.md` step 8: envelope and summary are ours, so `z.strictObject`; any Canvas-sourced object passed through (`content_details`, a topic subset) is `z.looseObject` with no constraints, `z.string()` for dates, `.nullish()` throughout. A fixture is required in `OUTPUT_FIXTURES` or CI fails.

## 9. Out of scope and non-goals

- **Cross-course.** One course per call. A cross-course variant multiplies every §5.2 bound by the course count; `list_my_planner_items` already covers the cross-course *context* need.
- **Any `student_id` / teacher view** (§6.1).
- **Writes of any kind**, including `mark_as_read`, planner overrides, `must_view` satisfaction as a side effect, quiz attempts, and LTI launches (§6.2).
- **Grade prediction.** `project_grade` and `explain_grade` exist. The graph reports requirement states, not grade outcomes.
- **A "percent complete" figure**, and **"N of M replies made"** (§5.4). Neither exists in the API.
- **Mastery paths / conditional release.** `include[]=mastery_paths` exists [S] and is a separate domain.
- **Reconstructing effective due dates from overrides** (§5.5). Canvas already did it.
- **Deriving `must_contribute` from discussion entries** (§4.3).
- **Any behaviour copied from the competitor.** Noted again because it is an acceptance criterion.
- **A single composite tool across modules *and* planner *and* grades.** Context stays in `context`.

## 10. Follow-up tasks this design identifies (file separately, do not ride along)

1. **`getCourseStructure` undercounts oversized modules** (§5.1). `mod.items ?? []` turns a module with more than 100 items into a zero-item module and silently undercounts `summary.total_items`. Live defect in two shipped tools (`get_course_structure`, `view_course_structure`). Needs a fixture with `items_count: 142` and no `items` key, and — per the nearest-neighbour rule — a sibling fixture with `items: []`, because `[]` is truthy in JS and takes the opposite branch of any `mod.items &&` guard.
2. **`get_course_structure` strips requirement evidence it already fetched** (§2). Whether to stop stripping is a contract change on a shipped tool and is the CTO's call, not this design's.
3. **`CanvasDiscussionTopic` models 7 of the topic's fields** (§2). Typing the requirement-relevant ones is useful independently of the graph.
4. **`get_my_submissions` exposes no `include` input** (§5.4), so sub-assignment submissions and submission comments are unreachable through the student path.

## 11. Test strategy

### 11.1 The limitation to state up front

Every test here is against **mocked** Canvas responses (`CLAUDE.md`: never hit a real Canvas). So the suite can prove our precedence rules are implemented as designed, and **cannot** prove the fixtures match what a real Canvas sends. The mitigation is that every fixture field in §4 and §5 is traceable to a named Canvas file at the pinned SHA, and every fixture should carry that citation in a comment. A fixture with no citation is an assumption wearing a test's clothes — and this repo has been bitten by exactly that (BRU-2594: a fixture asserted a field the serializer emits only for ungraded attempts, and it stood for two months).

### 11.2 Fixtures required for contradictory and partial responses

Each of these exists to make one §4/§5 rule fail if it is wrong. Several are "fail-closed" shapes that no happy-path fixture reaches — and per the repo's own history, a fail-closed branch no fixture reaches scores zero on an injection matrix and is therefore decoration.

| Fixture | Shape | Rule it guards |
| --- | --- | --- |
| `completed`-absent | `completion_requirement` with `type` and no `completed` key | §1.3 — must be `unknown`, never `unsatisfied` |
| `requirement_type: 'one'` | 6 rows, 1 satisfied, `requirement_count` **withheld** | §1.2, §4.5 |
| `min_percentage` | sixth type with `min_percentage`, no `min_score` | §1.1 |
| Excused | `completed: true`, submission `excused: true`, nothing submitted | §4.1 — `satisfied` **with** caveat |
| Unposted numeric | `completed: false` + submission submitted, `posted_at: null`, `score: null` | §4.2 — `unknown` |
| Below-threshold numeric | `completed: false` + posted score below `min_score` | §4.2 — `unsatisfied`; the control that proves the row above is not trivially `unknown` |
| Manual grade, no attempt | `workflow_state: 'graded'`, `attempt: null`, non-checkpointed | §4.4 |
| Checkpointed discussion | same shape, `checkpoints_parent` — opposite verdict | §4.4 carve-out; a pair, because one alone cannot show the asymmetry |
| `must_view` via submit | `must_view` and `must_submit` on one tag, submit action present | §4.3 |
| Oversized module | `items_count: 142`, **no `items` key** | §5.1 — must trigger per-module fallback, not report 0 |
| Empty module | `items_count: 0`, `items: []` | §5.1 nearest neighbour — truthy `[]` takes the other branch |
| `require_initial_post` not posted | `require_initial_post: true`, `user_can_see_posts: false` | §5.3 |
| Admin short-circuit | same, but caller is not a student | §5.3 gate — must be `unknown`, not `satisfied` |
| Locked item | `content_details.locked_for_user: true`, `lock_explanation` present | §3.1 `blocked`; §6.4 fencing of `lock_explanation` |
| Truthiness-dropped fields | `content_details` with **no** `locked` and **no** `points_possible` keys | §5.5 — absence is not `false`/`0` |
| Sequential progress | `require_sequential_progress: true`, later items `locked_for_user` | §5.5 |
| `ExternalTool` requirement | `must_view` on an LTI item, no `completed` | §5.6 |
| Group child topic | root with `topic_children` + `group_topic_children`, student in one group | §5.3 group path |
| Stale progression | module `state: 'completed'` contradicting the rows | §4.5 `state_disagreement` |

### 11.3 How the implementation PR must prove itself

- **Red-first, with honest accounting.** Many of the rows above assert an *absence* and so pass against a stub by construction. The implementation PR should create the state function as a no-op stub first, record the red count, and report `+N tests` broken down into red-first versus characterization. A bare `+N tests` on a PR like this is unreadable.
- **One injection per rule, with one-to-one attribution.** Revert each §4 rule singly and record which tests go red. Anything that scores **zero** is the finding — either it is characterization (say so) or no fixture reaches it (add one). The states gate, the `caller_is_student` gate, and the oversized-module fallback are the three most likely zeros.
- **Anti-vacuity on every negative.** The "no third-party name anywhere" sweep (§6.5) needs a paired control asserting those names *are* present with pseudonymization disabled, or it can pass by looking in the wrong place.
- **A wire test, armed.** Assertions about what the tool's schema and `structuredContent` look like must go through a real `Client` over `InMemoryTransport` with `listTools()` called **first** — the SDK populates its output validator cache from `tools/list`, so a probe that calls the tool without listing first goes green while the payload is broken for every real client.
- **A request-count assertion.** §5.2 is a cost claim; assert the number of `fetch` calls for a fixed fixture, including that the submissions call is **skipped** when no numeric row is unsatisfied.

## 12. Implementation sequence (PR-sized)

Each step is independently reviewable and independently valuable. Step 1 is a prerequisite for 2; 2 is a prerequisite for 3.

| PR | Scope | Why this size |
| --- | --- | --- |
| **1** | Types and requests only: `completion_requirement` (six types, `completed` **optional**) and the module requirement fields on `CanvasModule`; `require_initial_post` / `user_can_see_posts` / `topic_children` / `group_topic_children` / `is_checkpointed` / `reply_to_entry_required_count` on `CanvasDiscussionTopic`; a `listWithItems` variant taking `include[]=content_details` and an explicit `per_page`. No new tool. | Pure type/request work with no behaviour to argue about, and it makes the field absences in §1.3 and §5.5 compiler-visible before any logic depends on them. Declaring `completed` optional is the whole point — it forces every consumer to handle the absent case. |
| **2** | The pure state function and its fixtures: §4 precedence, §3 states, §4.5 rollup. No tool registration, no network. | This is where all the risk is and where every §11.2 fixture lands. Reviewable as a table of inputs to verdicts. Keeping it tool-free means the injection matrix attributes to rules, not to plumbing. |
| **3** | The tool: `get_my_course_requirements`, fan-out bounds (§5.2), `caller_is_student` resolution, output contract + `OUTPUT_FIXTURES`, fencing registry entry, audience tag, armed wire test, request-count assertion. | The only PR that adds surface area, and by then the semantics are already tested. |
| **4** | Optional: a `skills/` student workflow over the tool (Option C in its correct role), plus the counts CI checks per `CLAUDE.md`. | Separable; adds no behaviour. |

Follow-ups from §10 are their own tasks and are **not** part of this sequence.

## 13. Open questions for CTO / board

Decisions this design deliberately does not make, because they change user-visible behaviour or commit scope.

1. **Does `get_course_structure` stop stripping requirement evidence?** (§10.2) A contract change on a shipped tool. The alternative is accepting two module walkers.
2. **`caller_is_student: false` — degrade or refuse?** This design degrades: discussion rows become `unknown` and the rest still returns. Refusing outright is defensible and simpler. Board's call on which is less confusing to an educator who calls a student tool.
3. **Is any teacher-facing variant wanted at all?** §6.1 recommends no `student_id` parameter ever. If a teacher view is wanted it needs its own PII review.
4. **Where `canvas_state` and `derived_state` disagree, is reporting both acceptable?** (§4.5) It is honest and it is also the kind of output a caller may find hard to act on. Alternative: prefer `canvas_state` and record the disagreement only in `notes`.
5. **Tool name.** `get_my_course_requirements` follows the `get_my_*` student convention. `get_my_course_progress` reads better and risks being confused with grades.
6. **Does step 4 (the skill) get committed to now**, or deferred? If deferred, it needs a dated check and a named owner — an unconditional deferral with neither is how a follow-up becomes ownerless.

## 14. Reproduction appendix

Every command below was executed while writing this document; counts are the observed output, not expectations. `SHA=1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.

**Canvas source.** Each file is fetched by full path (never `basename`, which silently overwrites same-named files from different directories):

```
gh api "repos/instructure/canvas-lms/contents/<path>?ref=$SHA" --jq '.content' | base64 -d
```

| Claim | File | Check |
| --- | --- | --- |
| §1.1 six types | `app/models/context_module.rb` | `grep -n 'min_percentage' ` → 5 hits, incl. `scoreable_types` |
| §1.2 derived `requirement_type` | `app/models/context_module.rb` | `grep -n -A2 'def requirement_type'` |
| §1.3 `completed` gated on progression | `lib/api/v1/context_module.rb` | `grep -n 'if progression'` → 2 hits (module `state`, item `completed`) |
| §1.3 `find_student` | both module controllers | `grep -n 'find_student'` → `before_action … only: %i[index show …]` in each |
| §4.1 excusal | `app/models/context_module_progression.rb` | `grep -n 'excused?'` |
| §4.2 unposted early return | same | `grep -n -A4 'unposted_sub'` |
| §4.2 numeric actions dropped | same | `grep -n 'actions_done.reject!'` |
| §4.3 `must_view` last | same | `grep -n -A4 'def check_view_requirements'` |
| §4.4 manual-grade carve-out | same | `grep -n -B2 -A6 'is a manual grade'` |
| §5.1 cliff | `lib/api/v1/context_module.rb`, `lib/api.rb` | `grep -n 'Api::MAX_PER_PAGE'`; `grep -n 'MAX_PER_PAGE = '` → `100` |
| §5.3 predicate | `app/models/discussion_topic.rb` | `awk '/def user_can_see_posts\?/,/^  end/'` |
| §5.3 both fields unconditional | `lib/api/v1/discussion_topics.rb` | `grep -n 'user_can_see_posts'` inside `serialize_additional_topic_fields` |
| §5.4 checkpoint labels | `app/models/discussion_topic.rb` | `grep -n 'REPLY_TO_TOPIC\|REPLY_TO_ENTRY'` → 4 hits |
| §5.5 `overridden_for` + truthiness | `lib/api/v1/context_module.rb` | `grep -n -A8 'def content_details'` |
| §5.5 `locked_for_user` always set | `lib/api/v1/locked.rb` | `grep -n -A8 'def locked_json'` |

**This repo**, at `ae64c77`:

| Claim | Check |
| --- | --- |
| §2 `completion_requirement` unmodelled | `grep -n 'completion_requirement' src/canvas/types.ts` → no match |
| §2 `CanvasDiscussionTopic` is 7 fields | `awk '/^export interface CanvasDiscussionTopic/,/^}/' src/canvas/types.ts` |
| §2 `getCourseStructure` strips | read the item projection in `src/canvas/modules.ts` — 9 keys, no `completion_requirement` |
| §2 no output contracts | `grep -rn 'list_modules\|list_module_items\|list_discussions\|get_my_submissions\|list_my_planner_items' src/tools/output/ tests/tools/fixtures/output-fixtures.ts` → no match |
| §2 handlers un-projected | `src/tools/modules.ts` and `src/tools/discussions.ts` return `canvas.<module>.<call>(…)` directly |
| §2 `listMy` sends no include | `src/canvas/submissions.ts`, `listMy` sets only `student_ids: ['self']` |
| §5.1 `?? []` | `src/canvas/modules.ts`, `let items = mod.items ?? []` |
| §5.2 `PER_PAGE = 10` hazard already documented | the doc comment on `PlannerModule.listItems` in `src/canvas/planner.ts` |
