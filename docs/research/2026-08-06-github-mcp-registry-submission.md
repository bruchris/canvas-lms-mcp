# GitHub MCP Server Registry (github.com/mcp) — submission path and outcome (2026-08-06)

Follow-up to recommendation #3 in [install-surfaces research](2026-08-06-install-surfaces.md) (BRU-2033): pursue listing in the curated GitHub MCP Server Registry that backs VS Code's Extensions-view MCP gallery (`@mcp` search).

## What github.com/mcp actually is

- github.com/mcp is GitHub's own curated directory (~210 servers as of 2026-08-06), separate from — but layered on top of — the official OSS registry at registry.modelcontextprotocol.io. It powers one-click install into VS Code (and VS Code Insiders) and is the discovery surface for the Extensions view MCP gallery. (https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/, https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- GitHub states the design intent is that servers self-publish once to the OSS community registry and then "automatically appear" in the GitHub MCP Registry, with the OSS registry as the single source of truth. **In practice this is not fully automatic yet.** Per GitHub staff (@trent-j) in [discussion #1257](https://github.com/github/github-mcp-server/discussions/1257): *"The GitHub MCP Registry now has the ability to sync **versions** from the open source registry, but onboarding a **new server** is still a manual curation process today."* Once a server has been manually onboarded once, subsequent version bumps sync automatically from the OSS registry — no repeat submission needed.
- There is no public form, API, or documented SLA for the initial onboarding decision. The observed mechanism is a GitHub Discussion in the **Q&A category of `github/github-mcp-server`**, e.g. [#1257](https://github.com/github/github-mcp-server/discussions/1257) (resolved — onboarded ~3 weeks after the initial ask, after a staff member said they'd "share your request with our product team") and [#2844](https://github.com/github/github-mcp-server/discussions/2844) (`io.github.edithatogo/fyi-mcp`, opened 2026-07-09, still unanswered as of this research — nearly a month with no response). This confirms the review is informal, has no committed timeline, and outcomes are not guaranteed.

## Prerequisite check — are we eligible?

Already satisfied, no changes needed:

- **Published on the official registry** with GitHub-OIDC namespace auth and an npm-verified package: `io.github.bruchris/canvas-lms-mcp`, currently at `1.25.0`, description `"TypeScript MCP server for Canvas LMS — 163 tools across 41 domains."` — confirmed live via `registry.modelcontextprotocol.io/v0/servers?search=canvas-lms-mcp` (version history shows every release since 1.15.3 synced correctly, most recently 1.25.0).
- The repo's checked-in `server.json` shows a stale placeholder version (`1.15.1`) — this is expected, not a bug: `.github/workflows/release-please.yml` (`Sync server.json version` step, ~line 129) rewrites `server.json`'s version fields in the CI runner and calls `mcp-publisher publish` directly against that transient copy; the bump is never committed back to the repo. The **published registry entry** is what matters for github.com/mcp eligibility, and it is current.
- MIT license, public repo, active maintenance (releases through 1.25.0, 8 PRs merged in the last week per project state) — matches the informal hygiene bar other onboarded servers cite (no hard documented checklist exists for this registry, unlike the Anthropic Connectors Directory's explicit requirements).

## Action taken

Opened an onboarding request following the `#1257`/`#2844` precedent format (server name, version, repo, license, description) as a Q&A discussion:

**https://github.com/github/github-mcp-server/discussions/3024**

## Outcome / status

**Pending — not invite-only, but no committed SLA.** This is not a hard blocker in the sense of requiring special access we lack; it's a manual, unthrottled queue on GitHub's side with observed wait times ranging from ~3 weeks (#1257) to 4+ weeks with no response yet (#2844, still open). No further action is available on our side beyond what's already been submitted.

**Recommendation:** no code or metadata changes required — we already meet every eligibility signal. Treat discussion #3024 as a fire-and-forget submission; revisit in ~4 weeks (early September 2026) to check for a response, and re-check github.com/mcp search for `canvas-lms-mcp` periodically. If unanswered after 6-8 weeks, a polite bump comment on the same discussion (not a new one, per the duplicate-gate lesson from stale-payload gate sweeps) is reasonable before escalating further.

## Sources

- https://code.visualstudio.com/docs/agent-customization/mcp-servers
- https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/
- https://github.com/github/github-mcp-server/discussions/1257
- https://github.com/github/github-mcp-server/discussions/2844
- https://github.com/github/github-mcp-server/discussions/3024 (our submission)
- https://registry.modelcontextprotocol.io/v0/servers?search=canvas-lms-mcp
