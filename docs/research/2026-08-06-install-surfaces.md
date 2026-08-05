# Install Surfaces Research — Is our one-click setup still state of the art? (2026-08-06)

Research question: Is the current install story (.mcpb bundle for Claude Desktop + Cursor/VS Code deeplink badges + `npx canvas-lms-mcp` quick start) still the best way to expose canvas-lms-mcp to modern agents, and which newer capability surfaces should we adopt?

## Executive summary

- **.mcpb is alive and well.** The format was renamed from DXT to MCPB, donated to the open MCP project, and remains the recommended one-click packaging for Claude Desktop on macOS/Windows. No deprecation. Keep shipping it.
- **Agent Skills became an open standard (agentskills.io, Dec 2025)** adopted by ~32 tools including VS Code, Codex CLI, Gemini CLI, Cursor, and Goose. Vercel's skills.sh (`npx skills add`, Jan 2026) is the de-facto npm-of-skills. We already ship 16 skills and are installable via `npx skills add bruchris/canvas-lms-mcp` — this is now a first-class distribution channel, not an accessory.
- **The biggest genuine gap is a Claude Code plugin** (`.claude-plugin/plugin.json` marketplace entry bundling our MCP config + skills + commands as one versioned install). We have all the ingredients but no plugin manifest.
- **The second gap is remote/hosted MCP.** Claude.ai web/mobile, ChatGPT connectors, and the Anthropic API can only use remote (Streamable HTTP + OAuth 2.1) servers — local stdio never reaches those surfaces. Our `src/http.ts` transport exists; a hosted deployment plus an Anthropic Connectors Directory submission would unlock claude.ai/ChatGPT users, but requires OAuth 2.1 + PKCE, hosting, privacy policy, and review — a real product decision, not a packaging tweak.
- We are already listed on the official MCP Registry (`io.github.bruchris/canvas-lms-mcp`, `server.json` in repo) — ahead of both competitors on registry presence. Deeplinks (`cursor://…/mcp/install`, `vscode:mcp/install`) remain the current mechanisms; nothing has replaced them.

## 1. MCPB / Desktop Extensions status

- The format was **renamed from DXT to MCPB** ("MCP Bundles"); CLI moved `dxt` → `mcpb`, extension `.dxt` → `.mcpb`; legacy `.dxt` files still load. The repo now lives under the MCP org and its loader code "is used by Claude for macOS and Windows to load and verify MCPB bundles" — actively maintained, **no deprecation notices**, explicitly designed for adoption beyond Claude. (https://github.com/modelcontextprotocol/mcpb)
- Official Claude docs still present desktop extensions (.mcpb) as the current packaging path for local servers in Claude Desktop. (https://claude.com/docs/connectors/custom/desktop-extensions)
- **Connectors Directory:** submissions are for **remote** MCP servers (and MCP Apps) only — Streamable HTTP transport, OAuth 2.1 with PKCE, the OAuth discovery RFCs, tool annotations, session management, 401 discovery contract; plus docs URL, privacy policy, icon, test account; submitted via the portal in Claude.ai admin settings, tracked in a submissions dashboard (escalation: mcp-review@anthropic.com). A local-stdio/.mcpb package cannot be listed. (https://claude.com/docs/connectors/building/submission, https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq)

**Verdict:** keep the .mcpb release asset; it is still the best Claude Desktop local install. Directory listing requires going remote (see §5).

## 2. Agent Skills ecosystem

- Anthropic released **Agent Skills as an open specification** on 2025-12-18; the authoritative spec is at https://agentskills.io/specification (mirrored in https://github.com/agentskills/agentskills and referenced from https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md). A skill = directory + `SKILL.md` (YAML frontmatter + instructions) + optional scripts/resources.
- Adoption is broad: VS Code and OpenAI (ChatGPT + Codex CLI) within 48 hours; by March 2026 ~32 tools including Gemini CLI, JetBrains Junie, AWS Kiro, Block Goose, Cursor, GitHub read the same SKILL.md format. (https://www.unite.ai/anthropic-opens-agent-skills-standard-continuing-its-pattern-of-building-industry-infrastructure/)
- **skills.sh** (Vercel, launched 2026-01-20) is the leading skills registry/leaderboard with npm-style `npx skills add <owner>/<repo>` install. (https://skills.sh, coverage: https://www.totalum.app/blog/agent-skills-marketplaces-2026)
- Skills-first distribution is displacing MCP for *knowledge/workflow* use cases (no server process needed), but not for authenticated API access like Canvas — our model (MCP server for the 163 API tools + skills for the workflows on top) matches how the ecosystem says to pair them.

**Verdict:** we're already on this train (16 skills, `npx skills add` in README). Ensure skills stay conformant with the agentskills.io spec and are listed/rankable on skills.sh.

## 3. Claude Code plugins

- A Claude Code **plugin** is a versioned directory with a `.claude-plugin/plugin.json` manifest bundling skills, agents, hooks, slash commands, LSP configs, **and `.mcp.json` MCP server config** into one installable unit, distributed via plugin **marketplaces** (a git repo with `.claude-plugin/marketplace.json`; users run `/plugin marketplace add owner/repo` then `/plugin install`). (https://code.claude.com/docs/en/plugins-reference)
- This is the only surface that installs our MCP server *and* our 16 skills *and* commands in one step for Claude Code users, with update/versioning semantics. Community directories (claudemarketplaces.com etc.) index plugins for discovery.

**Verdict:** adopt. Add `.claude-plugin/plugin.json` + `marketplace.json` to this repo (MCP config via `npx canvas-lms-mcp`, skills/ already in place). Low effort, high leverage for Claude Code users.

## 4. Official MCP Registry and client directories

- **registry.modelcontextprotocol.io** requires a validated `server.json`: namespace auth (GitHub OIDC for `io.github.*`, DNS for domain namespaces), package-ownership verification, and allow-listed package registries — npm (registry.npmjs.org), PyPI, NuGet, Docker/OCI, and **MCPB via GitHub/GitLab release assets**. Remote servers need a reachable endpoint with `sse` or `streamable-http`. (https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md, https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md)
- **We are already published** (`io.github.bruchris/canvas-lms-mcp`, badge in README; `server.json` in repo — note its ≤100-char description assert in the release workflow).
- **VS Code** now surfaces MCP servers in the Extensions view (`@mcp` search) backed by the curated GitHub MCP Server Registry, with one-click install; MCP support is GA. (https://code.visualstudio.com/docs/agent-customization/mcp-servers, https://github.blog/changelog/2025-07-14-model-context-protocol-mcp-support-in-vs-code-is-generally-available/)
- **Cursor** documents official one-click install links and its docs directory. (https://cursor.com/docs/context/mcp/install-links, https://cursor.com/docs/mcp)

**Verdict:** registry presence is done; the incremental win is getting into the *curated* GitHub MCP Server Registry that feeds the VS Code gallery.

## 5. Remote/hosted MCP (Streamable HTTP + OAuth)

- **Streamable HTTP is the standard remote transport** (since the 2025-03 MCP spec); clients are dropping SSE. (https://sunpeak.ai/blogs/claude-connector-sse-to-streamable-http/)
- **Claude.ai web, mobile, and the API only reach remote servers** — local stdio is desktop/CLI-only. Custom connectors on claude.ai use OAuth (callback `https://claude.ai/api/mcp/auth_callback`) with automatic token refresh. (https://www.clauder-navi.com/en/claude-remote-mcp, https://sunpeak.ai/blogs/claude-connector-oauth-authentication/)
- **OpenAI/ChatGPT** supports remote MCP across the Agents SDK, Responses API, and ChatGPT desktop Apps & Connectors — again remote-only. (https://truthifi.com/education/state-of-mcp-2026-ai-agents-custom-connectors)
- What hosting buys: zero-install for claude.ai/ChatGPT/mobile users (institutions can't install desktop apps on lab machines), eligibility for the Anthropic Connectors Directory (§1), and MCP Apps UI later. Cost: running a service, OAuth 2.1 + PKCE (Canvas tokens are per-user PATs — an OAuth layer or token-entry flow is needed), privacy policy, support channel, directory review. Note our `src/http.ts` per-request-auth transport is the seed of this.

**Verdict:** the single biggest reach expansion available, but it converts the project from "npm package" to "operated service" — decide deliberately.

## 6. One-click deeplinks

- **Cursor:** `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_CONFIG` remains the current, officially documented mechanism. (https://cursor.com/docs/context/mcp/install-links)
- **VS Code:** `vscode:mcp/install?{url-encoded JSON}` still current; plus the newer in-product gallery path (§4). (https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- **Claude Desktop/Code:** no public MCP-install deeplink scheme; Claude Desktop's one-click path is .mcpb double-click, Claude Code's is `claude mcp add` / plugins.
- Security note: the "DeepJack" Cursor deeplink 1-click-RCE research (https://adversa.ai/blog/cursor-security-deepjack-deeplink-vulnerability-mcp-rce/) means clients may add extra confirmation friction, but deeplinks are not deprecated.

**Verdict:** keep the badges; nothing newer has replaced them.

## 7. Competitor install UX

- **vishalsachdev/canvas-mcp** (168★, Python/uv): now offers a one-click **canvas-mcp.mcpb** release download, plus `python scripts/install.py` automated installer and manual uv setup; ships **5 agent skills**; markets "works with Claude, Cursor, Codex, and 40+ agents" and has a docs site (canvas-mcp.illinihunt.org) with per-audience guides. (https://github.com/vishalsachdev/canvas-mcp)
- **DMontgomery40/mcp-canvas** (101★): abandoned; legacy manual config only.
- Neither offers a hosted/remote option, official-registry listing, or a Claude Code plugin — our .mcpb + npx + registry + 16 skills already exceeds them; the differentiators left are the plugin and remote hosting.

## Ranked recommendations for canvas-lms-mcp

1. **Ship a Claude Code plugin (adopt, low effort).** Add `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` bundling `.mcp.json` (npx-based) + existing `skills/` + commands; advertise `/plugin marketplace add bruchris/canvas-lms-mcp`. One-step install for the fastest-growing client; no competitor has it.
2. **Double down on skills.sh distribution (adopt, near-zero effort).** Verify all 16 skills conform to the agentskills.io spec, confirm the skills.sh listing/leaderboard entry, keep `npx skills add` prominent. Skills are now cross-agent (Codex, Gemini CLI, VS Code) — free reach beyond MCP clients.
3. **Pursue the curated GitHub MCP Server Registry / VS Code gallery listing (adopt, small effort).** We're on the official registry already; the VS Code Extensions-view gallery is the discovery surface users actually see.
4. **Spec a hosted remote option (investigate now, adopt if the service cost is acceptable).** Streamable HTTP + OAuth 2.1/PKCE on top of `src/http.ts`; it is the *only* route to claude.ai web/mobile, ChatGPT connectors, and the Anthropic Connectors Directory. Treat as an RFC: hosting cost, Canvas per-user token handling, privacy policy, review process.
5. **Keep .mcpb, npx quick start, and Cursor/VS Code deeplink badges as-is (retain).** All three remain the current recommended mechanisms; .mcpb was renamed, not deprecated. Only maintenance item: track `@anthropic-ai/mcpb` CLI naming in our release tooling.
6. **Skip:** third-party aggregator listings beyond what's organic (Glama, mcpmarket, etc. scrape the official registry); a separate DXT artifact (legacy, auto-compatible); an Electron/desktop wrapper (MCP Apps SEP-1865 covers UI needs if we go remote later).
