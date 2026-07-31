# Privacy Policy

_Last updated: 2026-07-31_

Canvas LMS MCP Server (`canvas-lms-mcp`) is open-source software (MIT) that runs
**locally on your own machine** as a [Model Context Protocol](https://modelcontextprotocol.io)
server. This document explains exactly what the software does with your data.

## Summary

The maintainers of `canvas-lms-mcp` operate **no servers**, run **no hosted
service**, and collect **no telemetry, analytics, or usage data**. The software
is a local bridge between your AI client (e.g. Claude Desktop) and **your own
Canvas instance**. Your Canvas API token and all Canvas data stay on your
machine and travel directly between your machine and your Canvas instance.

## What data the software handles

- **Canvas API token and base URL** — supplied by you through your MCP client's
  configuration (or the `CANVAS_API_TOKEN` / `CANVAS_BASE_URL` environment
  variables or CLI flags). These are read from your local configuration at
  startup and used only to authenticate requests to your Canvas instance.
- **Canvas data** — courses, assignments, submissions, grades, rubrics, users,
  and other records returned by the Canvas REST API in response to the tools you
  invoke. This may include student personal information (names, email addresses,
  submission content) depending on the tools called and your Canvas permissions.

## How data is collected, used, and stored

- **Collection.** Data is fetched on demand from your Canvas instance only when
  you (or your AI agent, on your behalf) invoke a tool. The software never
  crawls or bulk-exports data on its own.
- **Usage.** Fetched data is returned to your local AI client as the tool
  result so the model can answer your request. Canvas write operations (grading,
  commenting, content changes) are performed only when you invoke a write tool,
  and Canvas enforces its own permissions server-side — this software does not
  bypass them.
- **Storage.** The server itself is stateless and keeps no database. The only
  data it may write to local disk is:
  - **FERPA pseudonym maps** (optional) — when `CANVAS_PSEUDONYMIZE_STUDENTS` is
    enabled, a local map of student identifiers to stable pseudonyms is
    persisted under your OS application-data directory (override with
    `CANVAS_PSEUDONYM_DIR`). This never leaves your machine.
  - **Audit log** (optional) — pseudonym reverse-lookup calls are logged to
    stderr, and to `CANVAS_PSEUDONYM_AUDIT_LOG` if you set it.
- Beyond those optional local files, retained copies of Canvas data live only in
  **your AI client's own chat history**, which is governed by that client's
  privacy policy, not by this software.

## Third-party sharing

The software shares data with **no third parties**. The only network
destination it contacts is the Canvas instance whose base URL you configure.
Canvas data is not sent to the maintainers, to any analytics provider, or to any
service other than your own Canvas instance. (Your AI client separately sends
tool results to its own model provider — that flow is controlled by your AI
client, not by this software.)

## Optional FERPA pseudonymization

To reduce exposure of student personal information to the language model, the
server offers an opt-in mode (`CANVAS_PSEUDONYMIZE_STUDENTS=true`) that replaces
student names and contact details in tool output with stable local pseudonyms
before the data reaches the model. This processing happens entirely on your
machine. See the [FERPA mode section of the README](README.md#ferpa-mode-student-pseudonymization)
for details and limitations.

## Data retention

The maintainers retain nothing — no servers, no logs, no backups. On your
machine, the optional pseudonym maps and audit log persist until you delete
them; Canvas data itself is retained only in your AI client's chat history and
in your Canvas instance. You can remove local state at any time by deleting the
pseudonym directory and uninstalling the extension.

## Self-hosted HTTP mode

If you (or your organization) instead run the package as a hosted HTTP server,
you become the operator and data controller for that deployment: authentication
is per-request and no Canvas data is persisted by the server, but this policy
describes the software's behavior, not any hosting environment you add around it.

## Contact

Questions, concerns, or requests about privacy should be filed as a GitHub issue
at <https://github.com/bruchris/canvas-lms-mcp/issues>.
