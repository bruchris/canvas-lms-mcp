# Student Guide

Use AI assistants to interact with your Canvas courses through natural language. This guide walks you through setup and provides example prompts to get started.

## Prerequisites

- A Canvas LMS account at your institution
- An AI client that supports MCP (Claude Desktop, Cursor, VS Code, etc.)
- Node.js 22 or later installed on your computer

## Step 1: Generate a Canvas API Token

1. Log in to Canvas at your institution's URL (e.g., `https://school.instructure.com`)
2. Click your profile picture in the top-left, then **Settings**
3. Scroll down to **Approved Integrations**
4. Click **+ New Access Token**
5. Purpose: enter something like "AI Assistant"
6. Expiry: optionally set an expiration date
7. Click **Generate Token**
8. **Copy the token immediately** -- it will not be shown again

Keep this token private. It grants the same access as your Canvas login. If you suspect it has been compromised, return to Settings and delete it.

## Step 2: Configure Claude Desktop

1. Open Claude Desktop
2. Go to **Settings > Developer > Edit Config**
3. Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "@bruchris/canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "paste-your-token-here",
        "CANVAS_BASE_URL": "https://your-school.instructure.com"
      }
    }
  }
}
```

4. Replace `paste-your-token-here` with your actual token
5. Replace `https://your-school.instructure.com` with your institution's Canvas URL
6. Save and restart Claude Desktop

You should see Canvas tools available in the tools menu.

## Step 3: Start Asking Questions

Once configured, you can use natural language to interact with Canvas. Here are 10 example prompts to try:

### Courses and Navigation

**1. "What courses am I enrolled in this semester?"**

Lists all your active Canvas courses with names and IDs. Useful as a starting point to find course IDs for other queries.

**2. "Show me the syllabus for my Biology course"**

Retrieves the syllabus content directly. No more digging through course navigation to find it.

**3. "What modules are in course 12345 and what's in each one?"**

Lists the course modules and their items -- assignments, pages, files, quizzes -- so you can see the full course structure at a glance.

### Assignments and Deadlines

**4. "List all assignments in my English course and their due dates"**

Shows every assignment with due dates, point values, and submission status. Helps you plan your week.

**5. "What's my submission status for the midterm essay in course 12345?"**

Checks whether you've submitted, what grade you received (if graded), and any comments from your instructor.

### Grades and Feedback

**6. "Show me my grades across all assignments in course 12345"**

Lists all your submissions for a course so you can see your standing. Combined with assignment groups, you can estimate your overall grade.

**7. "What feedback did my instructor leave on assignment 67890?"**

Retrieves submission comments so you can read instructor feedback without opening Canvas.

### Quizzes

**8. "What quizzes are available in my Chemistry course?"**

Lists all quizzes with their type, point values, and question counts. Helps you prepare for upcoming assessments.

### Course Content

**9. "Show me the discussion topics in course 12345"**

Lists all discussion threads and announcements so you can stay up to date with class conversations.

**10. "What files have been uploaded to my Math course?"**

Lists all course files with names and sizes. Useful for finding lecture slides, handouts, or supplementary materials.

## Tips

- **Find your course ID**: Ask "list my courses" first. The course ID is the number shown next to each course name. You can also find it in your Canvas URL: `https://school.instructure.com/courses/12345`.
- **Be specific**: Include course names or IDs when you have multiple courses. "Show assignments for Biology" is better than "show assignments."
- **Read-only by default**: As a student, all operations are read-only. You can view your courses, assignments, grades, and submissions, but you cannot modify grades or course content.
- **Token security**: Your token has the same permissions as your Canvas login. Never share it. Delete and regenerate it if you think it has been exposed.
- **Rate limits**: Canvas has API rate limits. If you get a rate limit error, wait a moment and try again.

## Troubleshooting

**"Canvas token is invalid or expired"**
Your token may have expired or been deleted. Generate a new one in Canvas Settings.

**"Failed to connect to Canvas -- check your base URL"**
Verify your `CANVAS_BASE_URL` is correct. It should be your institution's Canvas URL without a trailing `/api/v1`.

**"Course not found -- check the ID"**
Double-check the course ID. You can find it by asking "list my courses" or checking the URL in your browser.

**Tools not appearing in Claude Desktop**
Make sure you saved the config file and restarted Claude Desktop. Check that Node.js 22+ is installed by running `node --version` in your terminal.
