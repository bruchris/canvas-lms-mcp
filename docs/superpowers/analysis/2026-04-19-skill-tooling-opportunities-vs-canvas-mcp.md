# Skill-Focused Tooling Opportunities vs `vishalsachdev/canvas-mcp`

Date: 2026-04-19

Scope: compare `bruchris/canvas-lms-mcp` on `origin/main` with `vishalsachdev/canvas-mcp` at commit `6f80b59e39848c4bc05a2e8eb1adb3e42a8470f2`, with emphasis on skill packaging, workflow discoverability, and what is realistic before the Canvas v1.0 deadline on May 9, 2026.

## Sources Reviewed

- Local repo:
  - `README.md`
  - `AGENTS.md`
  - `src/tools/index.ts`
  - `src/resources/index.ts`
  - `src/server.ts`
  - `src/http.ts`
  - `src/cli.ts`
  - `src/tools/courses.ts`
  - `src/tools/student.ts`
  - `docs/integration-guide.md`
  - `docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md`
- Comparison repo:
  - `README.md`
  - `AGENTS.md`
  - `src/canvas_mcp/server.py`
  - `src/canvas_mcp/resources/resources.py`
  - `src/canvas_mcp/tools/*.py`
  - `tools/TOOL_MANIFEST.json`
  - `tools/README.md`
  - `skills/*/SKILL.md`

## Executive Take

`canvas-lms-mcp` is no longer behind on raw breadth. Both repos now register 88 tools. The difference is packaging.

`vishalsachdev/canvas-mcp` is easier for an agent to discover and compose because it ships:

- 8 installable workflow skills
- audience-oriented tool narratives in both `README.md` and `AGENTS.md`
- a machine-readable `tools/TOOL_MANIFEST.json`
- developer-discovery tools (`search_canvas_tools`, `list_code_api_modules`)
- a code-execution escape hatch (`execute_typescript`)
- 1 prompt plus 3 resources in `src/canvas_mcp/resources/resources.py`

`canvas-lms-mcp` is stronger as a reusable TypeScript library and has materially broader general-purpose Canvas coverage in admin, dashboard, quizzes, conversations, student self-service, analytics, calendar, and accounts. The current weakness is that those capabilities are exposed as a flat tool surface with almost no workflow guidance beyond prose docs.

The realistic v1.0 opportunity is not "match their platform." It is "package our existing strengths into agent-friendly workflow entry points."

## Side-by-Side Capability Map

| Area | `canvas-lms-mcp` | `canvas-mcp` | Assessment |
| --- | --- | --- | --- |
| Runtime tool count | 88 tools in `src/tools/index.ts` | 88 tools across `src/canvas_mcp/tools/*.py` | Parity on count |
| Library / embeddability | First-class TypeScript library export in `package.json`, `src/server.ts`, `docs/integration-guide.md` | No equivalent embeddable MCP/server factory surface; repo is Python-first | Local advantage |
| Workflow skills | No shipped `.agents/skills` or `.claude/skills` despite spec calling for them | 8 shipped skills under `skills/` and promoted in `README.md` | Remote advantage |
| Tool discovery metadata | Human-readable inventory in `README.md` and `AGENTS.md` only | `tools/TOOL_MANIFEST.json` plus `tools/README.md` plus `search_canvas_tools` | Remote advantage |
| Prompts / resources | 2 resources in `src/resources/` and no MCP prompts | 3 resources plus `summarize-course` prompt in `src/canvas_mcp/resources/resources.py` | Remote advantage |
| Audience shaping | Flat tool registry, no role profile | `CANVAS_ROLE` filtering in `src/canvas_mcp/server.py` plus student/educator/shared framing | Remote advantage |
| Student workflow surface | Strong raw tools: `get_my_courses`, `get_my_grades`, `get_my_submissions`, `get_my_upcoming_assignments`, `get_todo_items`, `get_missing_submissions`, `get_upcoming_events` | Better packaged student flows: `get_my_upcoming_assignments`, `get_my_submission_status`, `get_my_course_grades`, `get_my_todo_items`, `get_my_peer_reviews_todo`, plus `canvas-week-plan` | Split: local has more endpoints, remote has better packaging |
| Educator grading | `grade_submission`, `submit_rubric_assessment`, `score_quiz_question`, assignment CRUD, quiz tooling, peer review CRUD | `bulk_grade_submissions`, `grade_with_rubric`, grading skill, code execution bulk path | Split: local broader, remote better workflow ergonomics |
| Learning designer / accessibility | No dedicated designer domain | `get_course_structure`, accessibility scan/remediation/reporting, 3 design/QC skills | Remote advantage |
| Messaging / follow-up campaigns | `send_conversation`, `list_conversations`, `get_conversation`, unread count | richer follow-up workflows: reminders, campaigns, mark read, conversation details | Remote advantage |
| Hosted / HTTP story | Strong HTTP transport and local library embedding in `src/http.ts` and `docs/integration-guide.md` | Hosted service and local install both documented in `README.md` | Different strengths; not the main v1.0 gap |

## Exact Tool-Level Differences

Important caveat: the comparison repo's `tools/TOOL_MANIFEST.json` documents only the discovery-facing subset. The actual runtime surface comes from `@mcp.tool` registrations in `src/canvas_mcp/tools/*.py`, which also total 88 tools.

### Overlapping Tool Names

These exact tool names exist in both repos:

`create_assignment`, `create_module`, `create_page`, `delete_page`, `get_my_upcoming_assignments`, `get_rubric`, `get_rubric_assessment`, `get_student_analytics`, `list_announcements`, `list_assignments`, `list_conversations`, `list_courses`, `list_groups`, `list_module_items`, `list_modules`, `list_pages`, `list_peer_reviews`, `list_rubrics`, `list_submissions`, `post_discussion_entry`, `send_conversation`, `update_assignment`, `update_module`

### Tools Unique to `canvas-lms-mcp`

These are real surface-area advantages, not just renames:

#### Platform, admin, and student self-service

`health_check`, `get_account`, `list_accounts`, `list_sub_accounts`, `list_account_courses`, `list_account_users`, `get_account_reports`, `get_dashboard_cards`, `get_todo_items`, `get_upcoming_events`, `get_missing_submissions`, `get_my_courses`, `get_my_grades`, `get_my_submissions`, `get_profile`

#### Course, user, enrollment, and analytics breadth

`get_course`, `get_syllabus`, `list_course_users`, `list_students`, `get_user`, `search_users`, `list_enrollments`, `enroll_user`, `remove_enrollment`, `get_course_analytics`, `get_course_activity_stream`, `search_course_content`

#### Submissions, quizzes, files, conversations, calendar

`get_submission`, `comment_on_submission`, `grade_submission`, `get_quiz`, `list_quizzes`, `list_quiz_submissions`, `list_quiz_questions`, `get_quiz_submission_answers`, `score_quiz_question`, `get_file`, `list_files`, `list_folders`, `upload_file`, `delete_file`, `get_conversation`, `get_conversation_unread_count`, `list_calendar_events`, `create_calendar_event`, `update_calendar_event`

#### Additional CRUD and workflow coverage

`create_course`, `update_course`, `create_discussion`, `update_discussion`, `delete_discussion`, `create_module_item`, `update_page`, `delete_assignment`, `create_peer_review`, `delete_peer_review`, `get_submission_peer_reviews`

### Tools Unique to `canvas-mcp`

These are mostly workflow and discoverability features rather than core Canvas breadth:

#### Skill-enabling discovery and bulk execution

`search_canvas_tools`, `list_code_api_modules`, `execute_typescript`

#### Learning designer and accessibility stack

`get_course_structure`, `scan_course_content_accessibility`, `fetch_ufixit_report`, `parse_ufixit_violations`, `format_accessibility_summary`, `fix_accessibility_issues`

#### Peer-review analytics and outreach workflows

`get_peer_review_assignments`, `get_peer_review_completion_analytics`, `get_peer_review_followup_list`, `get_peer_review_comments`, `analyze_peer_review_quality`, `identify_problematic_peer_reviews`, `extract_peer_review_dataset`, `generate_peer_review_feedback_report`, `generate_peer_review_report`, `send_peer_review_reminders`, `send_peer_review_followup_campaign`

#### Content authoring and discussion ergonomics

`get_course_content_overview`, `get_front_page`, `get_page_content`, `get_page_details`, `edit_page_content`, `update_page_settings`, `bulk_update_pages`, `get_discussion_topic_details`, `get_discussion_entry_details`, `get_discussion_with_replies`, `list_discussion_topics`, `list_discussion_entries`, `reply_to_discussion_entry`

#### Module, file, messaging, and admin helpers

`add_module_item`, `update_module_item`, `delete_module`, `delete_module_item`, `list_course_files`, `download_course_file`, `get_conversation_details`, `get_unread_count`, `mark_conversations_read`, `list_users`, `create_student_anonymization_map`, `get_anonymization_status`

#### Announcement-specific operations

`create_announcement`, `delete_announcement`, `delete_announcement_with_confirmation`, `delete_announcements_by_criteria`, `bulk_delete_announcements`

### Rename-Equivalent Capabilities

Several apparent gaps are mostly naming or packaging differences:

| `canvas-lms-mcp` | `canvas-mcp` | Notes |
| --- | --- | --- |
| `get_course` + `get_syllabus` | `get_course_details` | Remote bundles syllabus/context into one entry point |
| `get_assignment` | `get_assignment_details` | Similar underlying value, better remote naming for discovery |
| `submit_rubric_assessment` | `grade_with_rubric` | Remote name is clearer for educators |
| `create_module_item` | `add_module_item` | Same intent, remote name is friendlier |
| `upload_file` | `upload_course_file` | Same intent, remote name is clearer |
| `list_discussions` + `get_discussion` | `list_discussion_topics` + `get_discussion_topic_details` | Mostly vocabulary |
| `get_conversation_unread_count` | `get_unread_count` | Equivalent narrow function |

## Skill / Discoverability Positioning Analysis

### Where `canvas-mcp` is stronger

1. It packages workflows as first-class installable skills rather than expecting the agent to infer them from a flat inventory.
2. It documents tools by audience and use case, not just by Canvas domain.
3. It provides machine-readable metadata and runtime discovery so an agent can self-orient.
4. It exposes a small set of "entry point" tools with highly discoverable names such as `get_assignment_details`, `grade_with_rubric`, and `get_course_structure`.

### Where `canvas-lms-mcp` is stronger

1. It has a cleaner reusable architecture for a TypeScript ecosystem: standalone Canvas client, MCP server factory, stdio/HTTP/library integration, and explicit `canvas-lms-mcp/canvas` export.
2. Its raw Canvas coverage is better for product integrations and general-purpose automation.
3. Its HTTP transport is already production-shaped for embedded multi-tenant applications.

### The actual positioning gap

The local repo is currently optimized for developers integrating Canvas into apps. The comparison repo is optimized for agents discovering repeatable workflows.

That is why the comparison repo "feels smarter" despite not having more raw capability in the Canvas API itself.

### Concrete causes of the gap

1. The spec anticipated skill packaging in v1.1, but the current repo has no `.agents/skills` directory at all.
2. `README.md` and `AGENTS.md` enumerate tools, but they do not give agents machine-readable workflow groupings or recommended decision paths.
3. Local tool schemas are mostly numeric-ID oriented, while the comparison repo standardizes on `course_identifier` and user-facing names. That makes its workflow docs easier to write and easier for agents to apply.
4. The local repo ships zero MCP prompts. The comparison repo uses prompts and skill docs as discovery rails.

## Prioritized Recommendations

### Do Now

| Recommendation | Why | Effort | Risk | Timeline impact |
| --- | --- | --- | --- | --- |
| Add 3 repo-local workflow skills under `.agents/skills/` and mirror to `.claude/skills/`: `canvas-week-plan`, `canvas-grading-pass`, `canvas-course-pulse` | Highest leverage packaging fix using existing tools only; directly addresses the missing skill layer without taking on a new platform | M | Low | 2-4 days; safe before v1.0 |
| Add a machine-readable workflow/tool manifest, ideally generated from the tool registry plus a small hand-maintained workflow catalog | Gives agents and docs a stable discovery surface similar to `tools/TOOL_MANIFEST.json` without changing tool behavior | S-M | Low | 1-2 days |
| Add 2-3 MCP prompts for high-frequency starting points: weekly plan, grading queue, summarize course | Prompts are lower maintenance than full new tools and make discoverability visible inside prompt-aware clients | S | Low | 1 day |

### Defer Until After v1.0

| Recommendation | Why defer | Effort | Risk | Timeline impact |
| --- | --- | --- | --- | --- |
| Publish to skills.sh or build an external skill distribution story | Valuable, but distribution plumbing and compatibility testing are a separate release concern; the spec already places this in v1.1 | M | Medium | Would distract from v1.0 ship criteria |
| Add role-based runtime tool filtering like `CANVAS_ROLE` | Useful for ergonomics, but it creates surface-area branching, test matrix expansion, and possible confusion with library consumers | M | Medium | Non-trivial regression risk near ship |
| Build a code-execution API / sandboxed bulk-operation layer | This is a real product branch, not a packaging tweak. It also creates security, platform, and maintenance burden | L | High | Would materially threaten May 9 |
| Add FERPA anonymization, accessibility remediation, or hosted-service features | Strong differentiators, but they are not skill/discoverability fixes and all carry policy or operational complexity | L | High | Post-v1.0 only |

## Recommended v1.0 Scope Decision

### Include in v1.0

1. Repo-local workflow skills that orchestrate existing tools.
2. A machine-readable manifest for tools and recommended workflows.
3. A small MCP prompt set for common entry points.

These improvements make the current 88-tool surface easier to use without destabilizing the underlying Canvas client, tool registry, or transports.

### Explicitly Keep Out of v1.0

1. Public skills.sh distribution.
2. Runtime role-filtering.
3. Code execution and sandbox infrastructure.
4. Hosted-service positioning work.
5. FERPA/anonymization and accessibility product features.

## Release-Impact Statement

If we do nothing, v1.0 will launch with stronger raw Canvas coverage than `canvas-mcp` but weaker agent ergonomics. Agents will see many tools, yet have little help choosing the right sequence for common workflows.

If we implement only the three "Do now" recommendations, v1.0 meaningfully improves agent usability without reopening architecture or security decisions:

- local repo gains visible workflow packaging
- docs gain a durable discovery surface
- prompt-aware clients get first-run entry points
- no new risky Canvas API domains are introduced

That is the right trade before May 9. It narrows the perception gap with `canvas-mcp` while preserving the current roadmap distinction: `canvas-lms-mcp` remains the better embeddable TypeScript Canvas platform, and v1.1 can own external skill distribution.

## Suggested Top 3 for the CTO

1. Ship repo-local skills now, not skills.sh now.
2. Add a generated manifest plus workflow catalog so agents can self-discover the tool surface.
3. Add prompts as lightweight workflow entry points instead of adding more v1.0 tools.
