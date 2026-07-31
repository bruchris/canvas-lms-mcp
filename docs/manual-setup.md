# Manual Client Setup

Use this guide if `npx canvas-lms-mcp init` doesn't support your client yet,
or if you prefer to edit config files by hand.

For the interactive setup wizard, see the [Quick Start](../README.md#quick-start) section.

## Prerequisites

1. Log in to your Canvas instance.
2. Go to **Account > Settings**.
3. Scroll to **Approved Integrations** and click **+ New Access Token**.
4. Give it a name (e.g., "MCP Server") and click **Generate Token**.
5. Copy the token immediately — you won't see it again.

## Claude Desktop

Add to your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

## Cursor

**One-click install:** [Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=canvas-lms-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNhbnZhcy1sbXMtbWNwIl0sImVudiI6eyJDQU5WQVNfQVBJX1RPS0VOIjoieW91ci10b2tlbi1oZXJlIiwiQ0FOVkFTX0JBU0VfVVJMIjoiaHR0cHM6Ly95b3VyLWluc3RpdHV0aW9uLmluc3RydWN0dXJlLmNvbSJ9fQ==) — opens Cursor with canvas-lms-mcp pre-configured (replace placeholder credentials after install).

Or add manually to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

## VS Code

**One-click install:** [Install in VS Code](vscode:mcp/install?%7B%22name%22%3A%22canvas-lms%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22canvas-lms-mcp%22%5D%2C%22env%22%3A%7B%22CANVAS_API_TOKEN%22%3A%22your-token-here%22%2C%22CANVAS_BASE_URL%22%3A%22https%3A%2F%2Fyour-institution.instructure.com%22%7D%7D) · [VS Code Insiders](vscode-insiders:mcp/install?%7B%22name%22%3A%22canvas-lms%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22canvas-lms-mcp%22%5D%2C%22env%22%3A%7B%22CANVAS_API_TOKEN%22%3A%22your-token-here%22%2C%22CANVAS_BASE_URL%22%3A%22https%3A%2F%2Fyour-institution.instructure.com%22%7D%7D) — opens VS Code with canvas-lms-mcp pre-configured (replace placeholder credentials after install).

Or add manually to your VS Code settings (`settings.json` or `mcp.json`):

```json
{
  "mcp": {
    "servers": {
      "canvas-lms": {
        "command": "npx",
        "args": ["-y", "canvas-lms-mcp"],
        "env": {
          "CANVAS_API_TOKEN": "your-token-here",
          "CANVAS_BASE_URL": "https://your-institution.instructure.com"
        }
      }
    }
  }
}
```

Or use the one-liner:

```bash
code --add-mcp '{"name":"canvas-lms","command":"npx","args":["-y","canvas-lms-mcp"],"env":{"CANVAS_API_TOKEN":"your-token","CANVAS_BASE_URL":"https://school.instructure.com"}}'
```

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.canvas-lms]
command = "npx"
args = ["-y", "canvas-lms-mcp"]

[mcp_servers.canvas-lms.env]
CANVAS_API_TOKEN = "your-token-here"
CANVAS_BASE_URL = "https://your-institution.instructure.com"
```

Or use the one-liner:

```bash
codex mcp add canvas-lms -- npx canvas-lms-mcp
```

## Continue

Add to `~/.continue/config.json`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add canvas-lms --env CANVAS_API_TOKEN=your-token --env CANVAS_BASE_URL=https://school.instructure.com -- npx -y canvas-lms-mcp
```

Or add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_BASE_URL": "https://your-institution.instructure.com"
      }
    }
  }
}
```

## Gemini CLI

```bash
gemini mcp add canvas-lms npx canvas-lms-mcp
```

## ChatGPT / HTTP Clients

Run the server in HTTP mode, then point your client at the endpoint:

```bash
npx canvas-lms-mcp serve --port 3001 \
  --token your-token-here \
  --base-url https://your-institution.instructure.com
```

The MCP endpoint is `http://localhost:3001/mcp`. Per-request credentials can
be passed via `X-Canvas-Token` and `X-Canvas-Base-URL` headers.
