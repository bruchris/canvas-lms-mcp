---
name: canvas-outcome-tracker
description: Generate an outcome mastery report, track learning outcomes for accreditation, produce an outcomes report for program review, and identify which outcomes students are failing. Covers the full Canvas outcomes hierarchy — groups, standards, rollups, and mastery distributions.
---

# Canvas Outcome Tracker

Map student mastery across your learning outcomes — produce the accreditation evidence, program-review summaries, and course-level reports your institution needs.

## Prerequisites

- Canvas MCP server running and connected
- Instructor or admin role with outcome access
- Course ID (or account ID for institution-wide reports)

## Steps

### 1. Retrieve the outcome hierarchy

Call `get_root_outcome_group` with the course ID to get the top-level outcome group. This is the entry point to the full outcome tree for the course or account.

### 2. Enumerate outcomes in each group

Call `list_outcome_group_outcomes` with the group ID to list the specific learning outcomes inside that group. Repeat for sub-groups as needed. Each outcome record includes the mastery point threshold.

### 3. Pull outcome results

Call `get_outcome_results` with the course ID and optionally an outcome ID to get individual student alignment scores — how each student performed on each outcome across assessed assignments.

### 4. Get rollup summaries

Call `get_outcome_rollups` with the course ID to retrieve aggregated mastery scores per student and per outcome. This is the most compact view for reporting — one row per student, one column per outcome, with a mastery/near mastery/not mastered rating.

### 5. Analyse mastery distribution

Call `get_outcome_mastery_distribution` with the course ID and an outcome ID to see the class-wide distribution: how many students are mastered, near mastery, or not mastered. Repeat for each outcome you want to report on.

### 6. Cross-reference enrollment (optional)

Use `list_course_enrollments` to map student IDs from the rollup data back to names and sections, ensuring your report is human-readable.

### 7. Compile the report

Structure your findings by outcome group or accreditation standard. For each outcome, report:
- Class mastery rate (% mastered)
- Distribution breakdown
- Students below mastery threshold who may need intervention

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `get_root_outcome_group` | Entry point: top-level outcome group for the course or account |
| `list_outcome_group_outcomes` | Enumerate individual outcomes within a group |
| `get_outcome_results` | Raw per-student, per-outcome alignment scores |
| `get_outcome_rollups` | Aggregated mastery rollup: one summary row per student |
| `get_outcome_mastery_distribution` | Class-wide mastery distribution for a single outcome |
| `list_course_enrollments` | Resolve student IDs to names for readable reports |

## Example Prompts

- "Generate an outcome mastery report for my course."
- "Which outcomes are students failing in course 12345?"
- "Produce an accreditation report showing mastery rates across all learning outcomes."
- "What percentage of students have mastered the critical thinking outcome?"
- "Give me a program-review summary of outcome performance for this semester."

## Notes / Error Recovery

- Outcomes must be aligned to assignments in Canvas before `get_outcome_results` returns data. If results are empty, verify that rubric criteria link to outcomes.
- `get_outcome_rollups` returns a `rollups` array keyed by student ID. If the course has many students, the response may be paginated — the tool handles pagination automatically.
- `get_outcome_mastery_distribution` requires an outcome ID, not a group ID. Use `list_outcome_group_outcomes` first to get individual outcome IDs.
- Accreditation bodies typically want course-level rollups, not individual student scores. Use `get_outcome_rollups` with `aggregate_stat=mean` or `median` depending on your institution's reporting standard.
