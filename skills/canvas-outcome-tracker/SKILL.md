---
name: canvas-outcome-tracker
description: Track student mastery of learning outcomes in Canvas. Shows outcome rollups by student, mastery distribution across the class, and which outcomes have the lowest proficiency rates. Built for accreditation reviews, program assessment, and advising. Trigger phrases include "outcome tracker", "learning outcomes", "mastery data", "accreditation report", "outcome mastery", or "who hasn't mastered".
---

# Canvas Outcome Tracker

Surface learning outcome mastery data across a course — by outcome, by student, or by group — to support program assessment and accreditation reporting.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or admin role in the target course.
- The course must have outcomes aligned to assignments (contact your Canvas admin if outcomes are not visible).

## Steps

### 1. Identify the Target Course

Ask the user which course to analyse. Accept a course name, code, or Canvas ID.

If unclear, call `list_courses` to let them select.

### 2. Load the Outcome Structure

Call `get_root_outcome_group` to get the top-level outcome group for the course. Then call `list_outcome_groups` to retrieve all outcome groups in the course.

For each group, call `list_outcome_group_outcomes` to enumerate the individual outcomes. Build a flat list:
- Outcome ID
- Outcome title
- Mastery points threshold

Ask the user if they want to focus on a specific outcome group or review all outcomes.

### 3. Choose Report Type

Offer three modes:

| Mode | Description |
|------|-------------|
| **Class overview** | Mastery distribution for all outcomes at once |
| **Per-student rollup** | Which outcomes each student has or hasn't mastered |
| **Single outcome deep-dive** | All students' results for one outcome |

### 4A. Class Overview — Mastery Distribution

For each outcome, call `get_outcome_mastery_distribution` with the course ID and outcome ID. This returns the count of students at each mastery level (exceeds / meets / approaching / not yet).

Summarise as a ranked table, lowest mastery first:

```
Outcome Mastery Distribution — [Course Name]

LOWEST MASTERY (action needed)
• "Critical Analysis" — 38% not yet mastered (19/50 students)
• "APA Citation" — 24% not yet mastered (12/50 students)

MEETING EXPECTATIONS
• "Thesis Construction" — 82% mastered
• "Research Synthesis" — 79% mastered
```

### 4B. Per-Student Rollup

Call `get_outcome_rollups` with the course ID. This returns each student's rolled-up mastery status per outcome.

Format as a matrix or highlight students with 3+ unmastered outcomes as high-priority advising targets.

### 4C. Single Outcome Deep-Dive

Call `get_outcome_results` with the course ID and outcome ID to retrieve individual student result records — score, alignment source, and mastery status.

Call `get_outcome_contributing_scores` for the detailed score breakdown per student if the user wants to see which assignments contributed to mastery.

### 5. Present Actionable Recommendations

Based on the data, suggest:
- Outcomes to reteach or remediate
- Students to flag for advising (multiple unmastered outcomes)
- Alignment gaps (outcomes with zero results — may not be linked to assignments)

Ask if the instructor wants to export the data or drill further into any outcome.

## Output Format

```
Outcome Tracker — [Course Name]

SUMMARY
Total outcomes tracked: 12
Students at or above mastery on all outcomes: 31/50 (62%)
Outcomes needing attention (< 70% mastery): 3

AT-RISK STUDENTS (3+ unmastered outcomes)
• Jordan Lee — 5 unmastered outcomes
• Sam Park — 4 unmastered outcomes

OUTCOME HEALTH SNAPSHOT
✗ Critical Analysis        38% mastered  ← reteach recommended
✗ APA Citation            64% mastered
✗ Thesis Construction     68% mastered
✓ Research Synthesis      79% mastered
✓ Source Evaluation       84% mastered
```

## Notes

- This skill is fully **read-only** — it reports mastery data but does not modify outcomes or grades.
- Outcome results are only available for outcomes that have been aligned to graded assignments. Unaligned outcomes will show zero results.
- For accreditation exports, gather the output from `get_outcome_rollups` and `get_outcome_mastery_distribution` — these map directly to standard program assessment formats.
- `get_outcome_contributing_scores` provides the most granular data and may be slow on large courses; use it selectively.
