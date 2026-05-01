# Canvas LMS MCP — Skills Catalog Expansion Plan

Date: 2026-05-01
Issue: [BRU-801](/BRU/issues/BRU-801) (parent: [BRU-800](/BRU/issues/BRU-800))
Author: Lead Developer (Opus)

## Goal

Define the next batch of repo-local Canvas workflow skills so we can close the agent-ergonomics gap with `vishalsachdev/canvas-mcp` before v1.0 ships on May 9, 2026, while continuing to differentiate on raw Canvas coverage and embeddability.

## Sources Reviewed

- `src/tools/catalog.ts` — domain registry with `defaultPrimaryAudience` per domain
- `src/tools/*.ts` — per-domain tool definitions (used to verify every tool name cited below)
- `skills/canvas-at-risk-students/SKILL.md`
- `skills/canvas-gradebook-audit/SKILL.md`
- `skills/canvas-outcome-tracker/SKILL.md`
- `docs/superpowers/analysis/2026-04-19-skill-tooling-opportunities-vs-canvas-mcp.md`
- `vishalsachdev/canvas-mcp` `skills/*/SKILL.md` (8 skills, fetched 2026-05-01)

## Scope Note: Tool Surface Has Grown Since 2026-04-19

The 2026-04-19 analysis cites **88 tools across 22 domains**. Re-counting `name: '...'` definitions in `src/tools/*.ts` on `origin/main` today gives **106 tools across 22 domains** (notably `get_assignment`, `download_file`, expanded outcomes). Domains and audience defaults are still the 22 listed in `src/tools/catalog.ts`. Every candidate in this plan cites real tool names verified against `src/tools/`.

---

## 1. Audit of the 3 Shipped Skills

All three skills shipped in v1.9.0 under `skills/`. Each has a single `SKILL.md`, no resources/scripts subfolders, and follows the Anthropic Agent Skills frontmatter spec (`name`, `description`).

### Quality Check vs the Agent Skills Spec

| Skill | Frontmatter | Trigger phrases | Read-only declared | Tool calls verified | Output format | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `canvas-at-risk-students` | ✅ | ✅ | Mostly (write step is `send_conversation`, gated by per-student confirmation) | ✅ all real | ✅ table + tier blocks | Calls `list_course_enrollments` not `list_enrollments` — correct, that's the per-course tool |
| `canvas-gradebook-audit` | ✅ | ✅ | ✅ Read-only end-to-end | ✅ all real (4 unique-to-us gradebook history tools) | ✅ summary + per-grader breakdown | Strong differentiator copy at the bottom; keep |
| `canvas-outcome-tracker` | ✅ | ✅ | ✅ Read-only end-to-end | ✅ all real | ✅ three modes (class / per-student / single-outcome) | Solid; uses 7 of our 12 outcome tools |

### Coverage Gaps in the Shipped Set

The current set is **100% educator-focused**. Audience coverage versus the catalog's four audiences:

| Audience | Shipped skills | Gap |
| --- | --- | --- |
| `educator` | 3 (all of them) | Saturated for tier-1 read workflows; missing grading, discussions, peer reviews, quizzes, daily check |
| `student` | 0 | Missing — high-traffic use case, competitor ships `canvas-week-plan` |
| `admin` | 0 | Missing — no skill exercises `accounts.ts` (`list_accounts`, `get_account_reports`, etc.) |
| `designer` | 0 | Missing — no skill packages course build / QC / syllabus authoring (our 22 module + page + rubric tools are unused at the workflow layer) |

### Revisions Recommended for the 3 Shipped Skills

Small touch-ups only — no rewrites:

1. **`canvas-at-risk-students`** — currently iterates `list_assignments` then per-assignment `list_submissions`. Add a note that for courses with 50+ students, prefer `get_course_analytics` + `get_student_analytics` first to filter the candidate set before paging submissions, to avoid Canvas rate limits. (Bug class avoidance, not a structural change.)
2. **`canvas-gradebook-audit`** — add an explicit "this skill is admin-friendly" line in the description so it surfaces for compliance/accreditation triggers, not just educator triggers. Audience domain stays `educator` (matches `gradebook_history` default), but trigger phrases should pull in admin queries.
3. **`canvas-outcome-tracker`** — note that `get_outcome_contributing_scores` is the slowest call and should be opt-in for the user, which the skill already does correctly; tighten the language slightly. No structural change needed.

These revisions are NOT in scope for this plan's PRs — they should land in a small follow-up unless the board prefers to bundle.

---

## 2. Comparison with `vishalsachdev/canvas-mcp` Skills

Fetched live from `https://github.com/vishalsachdev/canvas-mcp/tree/main/skills` on 2026-05-01. Eight skills:

| # | Skill (vishalsachdev) | Audience | Description (verbatim, abridged) |
| --- | --- | --- | --- |
| 1 | `canvas-week-plan` | student | "Student weekly assignment planner. Shows due dates, submission status, grades, peer reviews across all courses." |
| 2 | `canvas-morning-check` | educator | "Educator morning course health check. Submission rates, struggling students, grade distribution, upcoming deadlines." |
| 3 | `canvas-discussion-facilitator` | shared | "Browse, read, reply to, and create discussion posts. For students and educators." |
| 4 | `canvas-bulk-grading` | educator | "Bulk grading workflows using rubrics. Single grading, batch grading, and code execution strategies with safety-first dry runs." |
| 5 | `canvas-peer-review-manager` | educator | "Tracks completion rates, analyzes comment quality, flags problematic reviews, sends targeted reminders." |
| 6 | `canvas-course-builder` | designer | "Scaffold course structures from specs, templates, or existing courses. Modules, pages, assignments, discussions in bulk." |
| 7 | `canvas-course-qc` | designer | "Audits module structure, content completeness, publishing state, date consistency, rubric coverage." |
| 8 | `canvas-accessibility-auditor` | designer | "WCAG accessibility audit. UFIXIT integration, scan, fix, re-scan." |

### Patterns We SHOULD Adopt

1. **Audience labels in the description text** — every competitor skill names its audience in the first sentence (e.g., "Student weekly assignment planner", "Educator morning…"). This makes trigger matching work better in agent clients. Our 3 shipped skills bury audience inside body copy. **Apply to every new skill in this plan.**
2. **A "Trigger phrases include …" sentence in the description.** Our shipped skills already do this correctly — keep it.
3. **A Prerequisites block** declaring server connection + required Canvas role + privacy notes. Our skills do this; keep it.
4. **Decision-tree-style "Choose strategy" sections** (see `canvas-bulk-grading` Step 3). Useful for skills with size-dependent flows.
5. **Output format examples in code fences.** Lowers the chance the agent invents a layout. Our shipped skills do this; reinforce in new skills.
6. **A clear "Read-only / write" stance at the top.** Our shipped skills declare it in `Notes`; competitor declares it inline at each write step. Either works — pick one and apply consistently.

### Patterns We Should NOT Adopt

1. **Calls to tools we don't have.** Competitor skills routinely call `get_assignment_details`, `get_my_submission_status`, `get_my_course_grades`, `get_my_peer_reviews_todo`, `get_peer_review_completion_analytics`, `get_assignment_analytics`, `bulk_grade_submissions`, `get_course_structure`, `scan_course_content_accessibility`, `fetch_ufixit_report`, `execute_typescript`. Mapping table is in §3 below; **any candidate that depends on a tool we don't have is downgraded to P2 or flagged in §5**.
2. **Code-execution escape hatch (`execute_typescript`).** Out of scope for v1.0; spec deliberately excludes it.
3. **UFIXIT / accessibility-tool integration.** We have no `scan_course_content_accessibility` tool. Adopting their accessibility skill would require a new tool surface and a third-party dependency — defer post-v1.0.
4. **`bulk_*` tools.** We don't have `bulk_grade_submissions` or `bulk_update_pages`. A grading-pass skill must iterate one submission at a time. Don't pretend we have a batch path.
5. **Anonymization toggle (`ENABLE_DATA_ANONYMIZATION`).** Competitor mentions this in skills; we have no equivalent env-driven anonymization layer. Don't claim FERPA features in our skills until we ship that capability (post-v1.0 per the 2026-04-19 doc).
6. **One-shot aggregators they invented (`get_course_structure`).** Our equivalent is to walk `list_modules` + `list_module_items` + `list_pages` + `list_assignments`. Document the walk explicitly so the agent paces itself.

---

## 3. Candidate List (11 Skills)

Naming convention: kebab-case, `canvas-` prefix, audience reflected in the first sentence of the description. All cited tool names exist in `src/tools/*.ts` on `origin/main` (verified 2026-05-01).

| # | Skill name | Audience | One-line description | MCP tools orchestrated | Value / use case | Effort | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `canvas-week-plan` | student | What's due across all my courses this week, with submission status, grades, and pending peer reviews. | `get_my_courses`, `get_my_upcoming_assignments`, `get_my_grades`, `get_my_submissions`, `get_todo_items`, `get_upcoming_events`, `list_peer_reviews` | Highest-traffic student workflow per competitor; closes the obvious "where's my week" gap. | S | P0 |
| 2 | `canvas-student-todo` | student | Today-focused: what's due now, what's missing, what's upcoming on the calendar. | `get_todo_items`, `get_missing_submissions`, `get_upcoming_events`, `get_dashboard_cards`, `get_my_courses` | Daily companion to `canvas-week-plan`; uses the four `dashboard.ts` tools we have that competitor lacks. | S | P0 |
| 3 | `canvas-morning-check` | educator | Start-of-day course health check: submission rates, struggling students, upcoming deadlines, grade distribution. | `list_courses`, `list_assignments`, `list_submissions`, `get_course_analytics`, `get_student_analytics`, `get_dashboard_cards`, `list_course_enrollments` | Tier-1 educator skill. Direct port of competitor's most-used skill, on our broader analytics surface. | M | P0 |
| 4 | `canvas-grading-pass` | educator | Walk a single assignment's submission queue: surface pending, grade with rubric, comment, advance. One submission at a time. | `list_assignments`, `list_submissions`, `get_submission`, `grade_submission`, `comment_on_submission`, `submit_rubric_assessment`, `list_rubrics`, `get_rubric`, `get_rubric_assessment` | Recommended in 2026-04-19 doc. We can't match competitor's `bulk_grade_submissions`, but a tight one-by-one queue still gets most of the value. | M | P0 |
| 5 | `canvas-course-qc` | designer | Pre-publish quality gate: empty modules, missing dates, unpublished items, rubric coverage, date sequencing. | `list_modules`, `get_module`, `list_module_items`, `list_assignments`, `get_assignment`, `list_pages`, `get_page`, `list_rubrics`, `get_course`, `get_syllabus` | First designer-audience skill; competitor flagship, doable on our surface (walk modules instead of one aggregate call). | M | P0 |
| 6 | `canvas-discussion-facilitator` | educator | Browse discussion topics, read threads, reply, create new topics, monitor participation. | `list_discussions`, `get_discussion`, `list_announcements`, `post_discussion_entry`, `create_discussion`, `update_discussion` | Direct port. Note: competitor reads threaded entries; we expose `get_discussion` which returns entries in a single call. Skill must call out this naming difference. | S | P1 |
| 7 | `canvas-quiz-review` | educator | Find struggling questions, review per-student answers, regrade individual question scores. | `list_quizzes`, `get_quiz`, `list_quiz_submissions`, `list_quiz_questions`, `get_quiz_submission_answers`, `score_quiz_question` | Uses our 6-tool quiz surface (competitor has none on quizzes). Pure differentiator. | M | P1 |
| 8 | `canvas-course-pulse` | educator | Week-over-week course health: assignment performance trends, activity stream, who's logging in, who isn't. | `get_course_analytics`, `get_course_activity_stream`, `get_student_analytics`, `list_course_enrollments`, `list_assignments` | Recommended in 2026-04-19 doc; complements `canvas-morning-check` with a longer-horizon view. | S | P1 |
| 9 | `canvas-syllabus-coach` | designer | Read syllabus + front page, propose copy improvements, optionally apply edits. | `get_course`, `get_syllabus`, `update_course`, `list_pages`, `get_page`, `update_page`, `create_page` | Second designer skill. Light writes (educator-confirmed before each `update_*`). | S | P1 |
| 10 | `canvas-peer-review-tracker` | educator | Track who's been assigned what, who's submitted, send reminders. Lite version — no comment-quality scoring. | `list_peer_reviews`, `get_submission_peer_reviews`, `create_peer_review`, `list_submissions`, `get_submission`, `list_course_enrollments`, `send_conversation` | We have only 4 of competitor's 11 peer-review tools. This skill packages the 4 we DO have. Honest scope; flag deferred analytics in §5. | M | P1 |
| 11 | `canvas-admin-roster` | admin | Sub-account oversight: course counts, enrollment summaries, account-level user lookup, account reports. | `list_accounts`, `list_sub_accounts`, `list_account_courses`, `list_account_users`, `get_account`, `get_account_reports`, `list_enrollments`, `enroll_user`, `remove_enrollment` | First admin-audience skill; uses our 6-tool `accounts.ts` domain (competitor doesn't ship admin skills). | M | P1 |

### Audience Distribution

| Audience | Count | Required (per acceptance criteria) | Status |
| --- | --- | --- | --- |
| student | 2 | ≥ 2 | ✅ |
| educator | 6 | ≥ 4 | ✅ |
| admin | 1 | ≥ 1 | ✅ |
| designer | 2 | ≥ 1 | ✅ |
| **Total** | **11** | within 8–12 | ✅ |

### Tool Coverage Notes

- Every cited tool exists in `src/tools/*.ts` today (verified by grep on 2026-05-01).
- No candidate above is gated on adding a new tool. The two skills that would benefit from new tools (`canvas-grading-pass` would benefit from `bulk_grade_submissions`, `canvas-peer-review-tracker` from `get_peer_review_completion_analytics`) are scoped to the existing surface and listed in §5 as follow-up product work, not blockers.

---

## 4. Recommended Implementation Batches

Three PRs, each reviewable on its own. Each batch is sized for a single PR with QA + CTO review, per current project policy. All three skills per skill = one folder under `skills/<skill-name>/SKILL.md`, no scripts/resources unless a skill explicitly needs them.

### Batch 1 — Audience Coverage (P0, 5 skills)

**Goal:** ship one skill per audience before v1.0 launch, eliminating the 100%-educator coverage gap.

| Skill | Audience |
| --- | --- |
| `canvas-week-plan` | student |
| `canvas-student-todo` | student |
| `canvas-morning-check` | educator |
| `canvas-grading-pass` | educator |
| `canvas-course-qc` | designer |

Why batch this way: every shipped skill is currently educator-only. This batch lands the first student-, designer-, and high-traffic educator skills together so v1.0 marketing copy can claim "skills for students, educators, and learning designers" without future PRs needed to make that true.

**Routing:** Developer (Sonnet). Mechanical SKILL.md authoring against verified tool names. ~5 files, ~150–250 lines each. Single PR.

### Batch 2 — Educator + Designer Enrichment (P1, 4 skills)

| Skill | Audience |
| --- | --- |
| `canvas-discussion-facilitator` | educator |
| `canvas-quiz-review` | educator |
| `canvas-course-pulse` | educator |
| `canvas-syllabus-coach` | designer |

Why batch this way: these are all single-domain skills (discussions / quizzes / analytics / pages) with no cross-skill dependencies. Two of them (`canvas-quiz-review`, `canvas-course-pulse`) are pure differentiators against competitor.

**Routing:** Developer (Sonnet).

### Batch 3 — Workflow Heavy (P1, 2 skills)

| Skill | Audience |
| --- | --- |
| `canvas-peer-review-tracker` | educator |
| `canvas-admin-roster` | admin |

Why batch this way: both require multi-step orchestration narratives (peer-review-tracker walks `list_peer_reviews` per assignment; admin-roster walks the account hierarchy). Higher per-skill reasoning load for the author, smaller batch keeps the PR small enough for a careful review.

**Routing:** Lead Developer (Opus) — both involve some product/architecture judgment about how much functionality to claim given missing aggregator tools. Or Developer (Sonnet) if scope is locked tight in the subtasks.

### Sequencing

Batch 1 → Batch 2 → Batch 3, serialized to avoid file-overlap and skills.sh metadata conflicts. Batch 1 must merge before May 9 to count toward v1.0; Batches 2–3 can land post-v1.0 without delaying the release.

---

## 5. Open Questions / Risks

### Questions for the Board

1. **Bulk grading.** `canvas-grading-pass` is one-at-a-time because we have only `grade_submission`, not `bulk_grade_submissions`. Adding a bulk tool is a feature decision (rate-limit handling, error semantics, dry-run mode). Worth scheduling for v1.1, or defer indefinitely?
2. **Peer-review analytics.** Competitor ships 11 peer-review tools; we have 4. `canvas-peer-review-tracker` is honest about this (no completion-rate analytics, no comment-quality scoring). Should we prioritize adding `get_peer_review_completion_analytics` and `get_peer_review_comments` so the skill can match competitor parity? If yes, that's a separate Canvas client work item.
3. **Anonymization.** Competitor skills cite an `ENABLE_DATA_ANONYMIZATION` env var. We don't have that capability. For `canvas-morning-check` and `canvas-peer-review-tracker` (which surface student names), should we (a) ship without an anonymization layer and document the privacy trade-off in the skill body, or (b) gate these skills on a small anonymization helper landing first? The 2026-04-19 doc puts FERPA/anonymization in post-v1.0; default is (a).
4. **Admin audience reach.** `canvas-admin-roster` is only useful to users with an admin Canvas token. Should we ship it anyway (small absolute-numbers audience but unique to us), or hold and prioritize a richer educator skill instead?
5. **Designer audience naming.** The catalog has audiences `student | educator | admin | shared` — no `designer`. Should designer-audience skills declare `educator` in tooling metadata (since designers usually have educator-equivalent tokens) and only label "designer" in human-readable description text? This plan assumes yes; confirm.

### Technical Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cited tool names drift as we add/rename tools post-merge | Skills break silently | Add a CI test that grep-validates every `SKILL.md` tool reference exists in `src/tools/*.ts`. Tracked separately. |
| Competitor adds skills.sh distribution before us | We look behind on packaging despite shipping more skills | Skills.sh distribution is deliberately deferred per project plan; this is a known-and-accepted trade. |
| Skills written against tools we then deprecate | Skill rot | Cross-reference every skill in v1.0 release notes; deprecation policy required separately. |
| `canvas-course-qc` and `canvas-morning-check` walk many endpoints; rate limits | Slow on large courses | Each affected skill includes a "for courses with >N enrolled, narrow scope first" note. Same pattern already used in `canvas-at-risk-students`. |
| Designer skills make HTML edits via `update_page` / `update_course` | Risk of damaging course content | Designer skills declare write steps explicitly and require user confirmation per write. Same pattern as `canvas-at-risk-students` outreach step. |

### Skills NOT Included (and Why)

- **`canvas-accessibility-auditor`** — needs `scan_course_content_accessibility` and `fetch_ufixit_report`, neither of which we have. Defer post-v1.0 with a separate tool-surface decision.
- **`canvas-bulk-grading`** — needs `bulk_grade_submissions`. Replaced by `canvas-grading-pass` (single-pass) for now.
- **`canvas-course-builder`** — could be done on our existing CRUD surface, but it's a high-write skill (creates many modules, pages, assignments at once) and the safety/idempotency story needs more design work than this plan covers. P2; revisit after Batch 3.
- **A general `canvas-conversation-followup` (educator inbox triage)** — feasible on our 4 conversation tools, but value overlaps with `canvas-at-risk-students` (which already drives outreach). Skip for now to avoid skill sprawl.

---

## Acceptance Checklist

- [x] Plan committed to `docs/superpowers/plans/2026-05-01-skills-expansion.md` on a feature branch
- [x] Cites `src/tools/catalog.ts`
- [x] Cites `docs/superpowers/analysis/2026-04-19-skill-tooling-opportunities-vs-canvas-mcp.md`
- [x] Audit of 3 shipped skills (§1)
- [x] Comparison with all 8 vishalsachdev skills (§2)
- [x] Candidate table with required columns (§3)
- [x] ≥2 student, ≥4 educator, ≥1 admin, ≥1 designer
- [x] Implementation batches sized for single-PR review (§4)
- [x] Open questions / risks (§5)
- [x] No `SKILL.md` files written in this PR
- [x] No skills.sh changes in this PR
- [x] Every cited tool name verified against `src/tools/*.ts` on 2026-05-01

## Next Action

Open PR. Assign to QA for first-pass review. After QA approves, hand to CTO. Once merged, create three child issues — one per batch — and route Batch 1 to Developer (Sonnet) so it lands before the May 9 v1.0 cut.
