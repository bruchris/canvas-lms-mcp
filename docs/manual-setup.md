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

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

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

Add to your VS Code settings (`settings.json` or `mcp.json`):

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
