# Init Wizard: Finish or Remove (Decision Doc)

**Date:** 2026-05-22
**Issue:** BRU-1223
**Status:** Proposed — awaiting board sign-off
**Author:** Lead Developer (Opus)
**Supersedes scope of:** [`2026-05-07-cli-setup-wizard.md`](./2026-05-07-cli-setup-wizard.md) (reduces it to an MVP)

## TL;DR

**Recommendation: finish the wizard, but as a scoped MVP — not the full 508-line spec.** Three follow-up tasks, ~5 dev-hours total, one minor release. The current "coming soon" stub has been shipping on npm since 1.x and is concrete user-facing debt that needs to be either removed or made real.

## Current reality (not what the parent task says)

- We are at **1.15.3**, not "pre-1.0." The May 9, 2026 v1.0 ship date in CLAUDE.md is stale; 1.0 shipped months ago.
- The `canvas-lms-mcp init` subcommand is **already public**. Every npm install since PR #112 (BRU-952) routes `init` through `bin/canvas-lms-mcp.js → dist/init.js`, and `dist/init.js` prints:

  > canvas-lms-mcp init: setup wizard coming soon.

  This is not "risk to 1.0." This is debt we are already paying on every release.
- The scaffolding from PR #112 is real and tested:
  - `src/init/argv.ts` — full flag parser, 164 LOC, well-tested
  - `src/init/clients.ts` — 7-client registry with cross-platform path resolution, 130 LOC
  - `src/init/io.ts` — `FileSystem` abstraction with node + in-memory impls, 130 LOC
  - `tests/init/{argv,clients,io}.test.ts` — coverage on all three
- The original spec [`2026-05-07-cli-setup-wizard.md`](./2026-05-07-cli-setup-wizard.md) is sound but oversized for what we actually need to land. ~80% of the *spec* was implemented as scaffolding in Task 1; ~0% of the user-visible wizard exists.

## Recommendation: finish, scoped down

I recommend **finishing the wizard**, with the v1 scope deliberately cut from the original spec.

### Why finish, not remove

1. **The Canvas-specific bits are not replaceable by `npx add-mcp`.** `add-mcp` is a generic config writer. It cannot:
   - Ping `GET /users/self` with the user's token to confirm the credential before writing it into a config file.
   - Normalize Canvas base URLs (strip trailing slash, append `/api/v1` when missing — a recurring support issue).
   - Pin to a specific `canvas-lms-mcp@<semver>`.

   The killer feature is **live token validation**. Without it, a typo in the token or URL fails silently inside Claude Desktop with an opaque "tool unavailable" — the worst possible UX for the first-run user, who has no way to debug. With it, the wizard tells the user "your token doesn't work, re-enter it" before they ever launch their MCP client. This is the single biggest reason the competitor (`vishalsachdev/canvas-mcp`, 118 stars) keeps gaining ground on us per the BRU-782 product comparison.

2. **The scaffolding is sunk cost — but it's also the right scaffolding.** The argv shape, client registry, and `FileSystem` abstraction are exactly what we'd build again if we started over. Deleting and rebuilding gains nothing.

3. **Removal still has cost.** Ripping out the stub means a coordinated deletion across 5 files + tests + tsup config + bin dispatch, plus a release note explaining why we just removed a documented-but-non-functional subcommand. That's roughly half the cost of finishing it, with negative user-visible value.

### Why scope it down from the original spec

The original spec (508 lines) is well-reasoned but specifies more than v1 of the wizard needs. The MVP can defer:

| Original spec feature | MVP decision | Rationale |
|---|---|---|
| Non-interactive mode (`--yes`, `--non-interactive`) | **Defer** | CI/scripted setup is a niche use case for an LMS-bound tool; we can add later when someone asks. Argv parser already supports the flag — it just won't have a wired behavior. |
| `--pin <semver>` | **Defer** | Most users want auto-upgrade. Pin-to-semver is a power-user feature; add when first user requests it. |
| `--server-name` | **Defer** | Default `canvas-lms` works for everyone; configurability is YAGNI. |
| Codex CLI (TOML target) | **Include** | The argv parser and client registry already list it; not landing it would mean partially-shipped support. ~30 extra LOC. |
| `@iarna/toml` dep | **Include** | Required for Codex. |
| `prompts` dep | **Include** | Required for the interactive UX. |
| Validate `/users/self` ping | **Include** | The whole point — see above. |
| Atomic write (write-temp + rename) + `.bak` | **Include** | Already designed; trivial with existing `io.ts`. Refusing to back up users' Claude Desktop config is a footgun. |
| README rewrite (replace per-client blocks with `npx canvas-lms-mcp init`) | **Include** | Otherwise the wizard exists but nobody uses it. |
| Cross-OS CI matrix for path resolution tests | **Defer** | The current `tests/init/clients.test.ts` mocks `process.platform` and `homedir()`; that's good enough for v1. Real cross-OS CI is a separate hardening task. |

### What v1 of the wizard actually does

```
$ npx canvas-lms-mcp init
? Canvas base URL: https://school.instructure.com
? Canvas API token: [masked input]
  → Validating against https://school.instructure.com/api/v1/users/self ... ✓ Authenticated as "Jane Smith"
? Which clients do you want to configure?
  [x] Claude Desktop  (~/Library/Application Support/Claude/claude_desktop_config.json)
  [x] Cursor          (~/.cursor/mcp.json)
  [ ] Claude Code     (~/.claude.json) — not detected, will be created
  [ ] VS Code         (~/Library/Application Support/Code/User/mcp.json)
  [ ] Windsurf        (~/.codeium/windsurf/mcp_config.json) — not detected
  [ ] Codex CLI       (~/.codex/config.toml) — not detected
  [ ] Continue        (~/.continue/config.json) — not detected
  → Updating Claude Desktop config ... wrote canvas-lms entry, backup at .bak
  → Updating Cursor config ... wrote canvas-lms entry, backup at .bak
Done. Restart your MCP clients to pick up the new server.
```

That's the deliverable. No flags, just prompts.

Power-user flags (`--client`, `--token`, `--base-url`) still work because the argv parser already accepts them; they just bypass the matching prompt. This costs us nothing because the parser is already shipped.

### Comparison to `npx add-mcp`

| Feature | `npx add-mcp canvas-lms-mcp` | `npx canvas-lms-mcp init` (proposed MVP) |
|---|---|---|
| Auto-detects installed clients | Yes | Yes |
| Multi-select clients | Yes | Yes |
| Prompts for env vars | Yes (generic — just asks for env var values) | Yes (Canvas-specific UX) |
| **Validates the Canvas token before writing** | **No** | **Yes** |
| **Normalizes Canvas base URL** | **No** | **Yes** |
| Backs up existing client config | Unknown / not documented | Yes |
| Works offline | Yes (no validation) | Yes (validation degrades to "continue anyway?") |
| Maintained by us | No (third-party) | Yes |

The README already points to `add-mcp` as the recommended path. After this MVP lands, we can change README to recommend our own wizard while keeping the `add-mcp` blurb as a fallback for users who don't want a Canvas-specific tool. The wizard becomes the **default** path, but we don't force it.

## Implementation breakdown

Three follow-up tasks. I will create these as child issues of BRU-1223 *only after board sign-off on this doc*.

### Task A — Config writers (~2h, Developer)

- Implement `src/init/config-writer.ts`, `json-merge.ts`, `toml-merge.ts`.
- Use the existing `FileSystem` abstraction from `io.ts`.
- Atomic write (write-to-`.tmp`, `rename`) + `.bak`.
- Add `@iarna/toml` dep.
- Tests using `memoryFileSystem`: write into empty config, write into populated config, idempotent re-runs.
- No prompts, no network. Pure file transforms.
- **Routes to Developer (Sonnet)** — this is mechanical, well-specified, and pattern-matches existing `src/canvas/` modules.

### Task B — Wizard orchestration + Canvas validation (~2h, Lead Developer)

- Implement `src/init/validate.ts` (`pingUsersSelf(token, baseUrl)` → `{ok, displayName, status, hint}`).
- Implement `src/init/wizard.ts` using `prompts`.
- Wire `src/init.ts` to: parse argv → run wizard (or skip prompts when flags supply values) → call config-writer → print summary.
- Add `prompts` dep.
- Tests with `prompts` stubbed.
- **Routes to Lead Developer (Opus)** — touches Canvas client, error mapping, UX flow. Reasoning-heavy.

### Task C — README + release note (~1h, Developer)

- Replace per-client setup blocks in README's Quick Start with `npx canvas-lms-mcp init`.
- Move the manual blocks to `docs/manual-setup.md` for users who want them or are on unsupported clients.
- Keep the `add-mcp` mention as an alternative.
- Add a CHANGELOG-worthy release note (release-please will pick it up from the commit).
- **Routes to Developer (Sonnet)** — pure docs work.

**Total: ~5h, three PRs.** Tasks A and B can run in parallel after this doc is approved. Task C depends on B landing.

## Risk and rollback

- **If validation breaks for some Canvas instances:** the wizard already plans to handle 5xx/timeout as "Canvas could not verify, continue anyway?" — soft failure, never hard-blocks setup.
- **If a client's config schema changes (Continue is mentioned in the spec as volatile):** the wizard writes into a single wrapper key per client; changes are localized to `clients.ts`. We can ship a patch release.
- **Rollback path:** if the wizard misbehaves in production, we can revert `src/init.ts` to the current stub in one PR. The argv parser, client registry, and io layer stay regardless — they have value independent of the wizard.

## What I am *not* recommending

- **Not** the full 508-line spec — that's overscoped for our actual install volume.
- **Not** removal — the unique-value-over-`add-mcp` is real, and the scaffolding is already paid for.
- **Not** a separate `@canvas-lms-mcp/cli` package — the original spec already rejected this and the reasoning still holds.

## Decision requested

Board, please confirm:

1. **Finish the wizard as scoped above** (recommended), or
2. **Remove the stub** (I'll write a cleanup-only task instead — ~1h Developer work to delete `src/init.ts`, `src/init/`, `tests/init/`, the tsup entry, and the bin dispatch branch), or
3. **Keep stub, do nothing** (not recommended; we keep shipping "coming soon" to every npm install).

On confirmation of option 1, I will create the three follow-up tasks (A, B, C) as child issues of BRU-1223 and assign them to the appropriate agents.
