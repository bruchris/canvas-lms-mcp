---
name: canvas-quiz-review
description: Educator skill for reviewing Canvas quiz performance and regrading individual question scores. Surfaces struggling questions, low-scoring students, and per-student answer breakdowns — then lets you adjust scores for specific questions without leaving your agent session. Unique to canvas-lms-mcp (no other Canvas MCP server exposes quiz tools). Trigger phrases include "quiz review", "quiz results", "struggling quiz questions", "quiz scores", "regrade a quiz question", "quiz performance", or "student quiz answers".
---

# Canvas Quiz Review

Educator skill for analysing quiz performance, investigating per-student answers, and regrading individual question scores — all from your agent session.

**canvas-lms-mcp is the only Canvas MCP server with quiz tools.** No other Canvas MCP server exposes `list_quizzes`, `get_quiz`, or `score_quiz_question`. This skill is a unique differentiator.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor or TA role in the target course.
- Student answers and scores are visible in output — only run this in a private or educator-only session.
- Regrading (`score_quiz_question`) requires instructor role. TA role may be restricted depending on institution settings.

## Steps

### 1. Identify the Target Course

Ask the user which course to work with. Accept a course name, course code, or Canvas ID.

### 2. Select a Quiz

Call `list_quizzes` with the course ID. This returns all quizzes with their title, question count, point total, due date, and time limit.

Present a summary and let the user select:

```
Quizzes — [Course Name]

• "Midterm Quiz" — 25 questions, 50 pts, due Mar 15, time limit: 60 min
• "Week 4 Check-in" — 10 questions, 20 pts, due Apr 5, no time limit
• "Final Exam Quiz" — 50 questions, 100 pts, due May 1, time limit: 120 min
```

### 3. Choose a Mode

| Mode | When to use |
|------|-------------|
| **Quiz overview** | See score distribution and flag struggling questions |
| **Per-student answers** | Review one student's answer sheet |
| **Regrade a question** | Adjust the score for one question on one submission |

### 4A. Quiz Overview — Score Distribution and Struggling Questions

1. Call `get_quiz` with the course ID and quiz ID. Note the question count and total points.
2. Call `list_quiz_submissions` with the course ID and quiz ID. This returns all submissions with each student's score, attempt count, and workflow state.
3. Call `list_quiz_questions` with the course ID and quiz ID to get each question's title, type, and point value.

Compute per-question statistics from submissions where possible (if scores are included in the submission response). Identify questions where the class average is below 60% of possible points.

Present the overview:

```
Quiz Overview — "Midterm Quiz" — [Course Name]

SCORE DISTRIBUTION
Class average: 38.4 / 50 pts (76.8%)
Highest: 50 pts  |  Lowest: 21 pts
Submitted: 47/50 students  |  In progress: 0  |  Not started: 3

QUESTIONS TO REVIEW (< 60% class average)
• Q7 "Explain the difference between RAM and ROM" — avg 1.2/4 pts (30%)
• Q12 "Which sorting algorithm is O(n log n)?" — avg 0.6/2 pts (30%)
• Q19 "Describe REST constraints" — avg 2.1/5 pts (42%)

LOW-SCORING STUDENTS (< 70% of total points)
• Student A — 29/50 pts (58%)
• Student B — 31/50 pts (62%)
• Student C — 33/50 pts (66%)
```

Ask if the instructor wants to review per-student answers or regrade a question.

### 4B. Per-Student Answers

1. Identify the student's submission from `list_quiz_submissions` output.
2. Call `get_quiz_submission_answers` with the quiz submission ID. This returns the student's answer for each question, the correct answer (for auto-graded types), and whether they received credit.

Present the answer sheet:

```
Answer Sheet — "Midterm Quiz" — Student A (submission #1847)
Score: 29/50 pts (58%)

Q1 "What does CPU stand for?" — Multiple choice
  Answered: "Central Processing Unit" ✓  (2/2 pts)

Q7 "Explain the difference between RAM and ROM" — Essay
  Answered: "RAM is temporary memory that stores running programs.
             ROM is permanent memory on a chip."
  Score: 1/4 pts  ← needs review

Q12 "Which sorting algorithm is O(n log n)?" — Multiple choice
  Answered: "Bubble sort" ✗ (correct: Merge sort)  (0/2 pts)
```

Ask if any questions should be regraded.

### 4C. Regrade a Question

**Requires explicit user confirmation before adjusting any score.**

Regrading adjusts the score for a single question on a single student's submission. Use this for:
- Essay questions where the auto-score needs an instructor override
- Questions with ambiguous wording where multiple answers should receive credit

Workflow:
1. Identify the submission ID and question ID from the previous steps.
2. Ask the user: "Set the score for [question title] on [student name]'s submission to [N] points out of [max]? This will update their total quiz score."
3. Only after confirmation: call `score_quiz_question` with:
   - `quiz_submission_id`: the submission ID
   - `quiz_submission_attempt`: the attempt number (from `list_quiz_submissions`)
   - `questions`: the array of question score objects with the question ID and new score
4. Report the updated question score and revised submission total.

Repeat for additional questions or students if the instructor needs to batch-regrade.

## Output Format

```
Quiz Review — "Week 4 Check-in" — [Course Name]

SUMMARY
Submitted: 44/46 students  |  Avg: 17.2/20 pts (86%)
Questions needing review: 1

STRUGGLING QUESTION
• Q3 "Define idempotency" — avg 1.8/4 pts (45%)
  Top wrong answers: "when a function returns the same value" (×12),
                    "when a request can be retried safely" (×8, partially correct)

REGRADING
Q3 on Student B's submission: 1 pt → 3 pts ✓  (updated total: 16/20)
```

## Notes

- **Read-only by default** — quiz overview and per-student answer review do not modify any Canvas data.
- `score_quiz_question` is a **write operation** that permanently adjusts a student's quiz score. Always confirm the question, student, and new score before calling it.
- canvas-lms-mcp is the only Canvas MCP server with quiz tools. If another Canvas MCP server is installed alongside this one, the quiz tools will only be available through canvas-lms-mcp.
- `get_quiz_submission_answers` requires the quiz submission ID (not the user ID). Retrieve it from the `id` field in `list_quiz_submissions` results.
- For quizzes with many submissions (100+ students), `list_quiz_submissions` and `list_quiz_questions` may paginate. The MCP server handles pagination automatically.
- Canvas may not expose per-question scoring breakdowns for all quiz types (e.g., survey quizzes). If per-question data is unavailable, note this to the user.
