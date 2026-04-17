# Getting Started with Canvas LMS MCP Server

Connect your Canvas courses to an AI assistant in under 5 minutes. No programming experience required.

## What You'll Need

- A Canvas LMS account (instructor or admin role)
- **Node.js 22 or later** — [download from nodejs.org](https://nodejs.org). During installation, leave all defaults checked. To check if you already have it, open a terminal and type `node --version`. You need `v22` or higher.
- An AI client — one of the following:
  - [Claude Desktop](https://claude.ai/download) (recommended for beginners)
  - [Cursor](https://www.cursor.com)
  - [VS Code](https://code.visualstudio.com) with the GitHub Copilot extension

## Step 1: Get Your Canvas API Token

Your Canvas API token lets the AI assistant read your courses and grades on your behalf. Keep it private — it has the same access as your Canvas login.

1. Log in to your Canvas instance (e.g., `https://school.instructure.com`)
2. Click your profile picture in the top-left corner, then **Settings**
3. Scroll down to **Approved Integrations**
4. Click **+ New Access Token**
5. In the **Purpose** field, type something like `AI Assistant`
6. Leave the expiry blank (or set a date if your institution requires it)
7. Click **Generate Token**
8. **Copy the token immediately** — it will not be shown again

> **Security note:** If you ever share your token by accident, go back to Settings, find the token, and click **Delete** to revoke it.

## Step 2: Find Your Canvas Base URL

This is the web address of your institution's Canvas site, minus any page paths.

Examples:
- `https://school.instructure.com`
- `https://canvas.myuniversity.edu`
- `https://myinstitution.instructure.com`

Copy just the base domain — nothing after `.com` or `.edu`.

## Step 3: Configure Your AI Client

Choose the AI client you installed:

### Claude Desktop

1. Open Claude Desktop
2. Go to **Settings** (gear icon) → **Developer** section → **Edit Config**
3. This opens a file called `claude_desktop_config.json`. Paste the following inside the curly braces, replacing the placeholder values:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "paste-your-token-here",
        "CANVAS_BASE_URL": "https://your-school.instructure.com"
      }
    }
  }
}
```

4. Save the file and **fully quit and reopen** Claude Desktop

You should see a hammer icon (🔨) in the bottom-left of the chat input — click it to confirm Canvas tools are listed.

### Cursor

1. Open Cursor
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) and type **Open MCP Settings**
3. Add the following, replacing the placeholder values:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "paste-your-token-here",
        "CANVAS_BASE_URL": "https://your-school.instructure.com"
      }
    }
  }
}
```

4. Save and reload the window (`Ctrl+Shift+P` → **Reload Window**)

### VS Code

Run this command in your terminal (replace the values in quotes):

```bash
code --add-mcp '{"name":"canvas-lms","command":"npx","args":["-y","canvas-lms-mcp"],"env":{"CANVAS_API_TOKEN":"your-token","CANVAS_BASE_URL":"https://your-school.instructure.com"}}'
```

> **Windows users:** The single quotes above don't work in PowerShell or Command Prompt. Use the manual JSON method below instead.

Or add it manually to VS Code settings (`settings.json`):

```json
{
  "mcp.servers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "paste-your-token-here",
        "CANVAS_BASE_URL": "https://your-school.instructure.com"
      }
    }
  }
}
```

## Step 4: Your First Query

Open a new chat in your AI client and try one of these:

> **"List all my active courses"**

The AI will call Canvas on your behalf and display your courses. From there, you can ask follow-up questions like:

> **"Show me the assignments for [course name]"**

> **"Which students haven't submitted the midterm yet?"**

> **"What's the average grade on the final exam in my Biology course?"**

You don't need course IDs — just describe what you want in plain English and the assistant will figure out the rest.

## Troubleshooting

### "Canvas token is invalid or expired" (401 error)

Your token is wrong or has been revoked.

- Double-check the token in your config — it should be a long alphanumeric string
- Go to Canvas → **Settings → Approved Integrations** and confirm the token still exists
- If it was deleted, generate a new one and update your config file

### "You don't have permission to perform this action in this course" (403 error)

Your Canvas account doesn't have access to the resource you requested.

- Instructors can only access courses they are enrolled in
- Some operations (like grading) require instructor or TA role
- Contact your Canvas administrator if you believe you should have access

### "Course/assignment/submission not found" (404 error)

The course ID doesn't exist or you're not enrolled.

- Try asking "list my courses" first to confirm which courses are accessible
- If a course recently ended, it may no longer appear in active enrollments

### "Failed to connect to Canvas — check your base URL"

The `CANVAS_BASE_URL` in your config is wrong.

- Make sure it starts with `https://`
- Do not include trailing slashes or page paths (e.g., `/courses`)
- Correct: `https://school.instructure.com`
- Incorrect: `https://school.instructure.com/courses/12345`

### Canvas tools don't appear in the AI client

- Make sure you **fully quit** (not just closed the window) and reopened the AI client after editing the config
- Check that Node.js 22+ is installed: open a terminal and run `node --version`
- On first run, `npx` downloads the package — this may take 30 seconds

### Config file syntax error

JSON is strict about commas and quotes. If the AI client shows an error on startup:

- Make sure every `"key": "value"` pair is separated by a comma — except the last one in a block
- Use a JSON validator like [jsonlint.com](https://jsonlint.com) to find the problem line

## Next Steps

- [Educator Guide](educator-guide.md) — Grading workflows, write operations, privacy considerations
- [Student Guide](student-guide.md) — Setup guide for students
- [Integration Guide](integration-guide.md) — For developers: API patterns and library usage
