# CLI Setup Wizard (`npx canvas-lms-mcp init`)

**Date:** 2026-05-07
**Issue:** `BRU-785`
**Status:** Proposed design, not yet implemented
**Author:** Lead Developer

## Goal

Add an interactive setup command that writes Canvas-MCP configuration into the
config file of any popular MCP client, so installing the server takes one
command instead of "find the right config file, paste the right JSON, restart
the client, hope you didn't typo the env block."

This is the highest-impact adoption-friction fix the project can ship before
v1.0. Research in
[`docs/superpowers/specs/2026-04-19-skill-focused-tooling-opportunities-vs-canvas-mcp.md`](./2026-04-19-skill-focused-tooling-opportunities-vs-canvas-mcp.md)
and the BRU-782 product comparison both flag the missing wizard as the single
biggest reason
[`vishalsachdev/canvas-mcp`](https://github.com/vishalsachdev/canvas-mcp) keeps
adding stars at our expense, despite our larger tool surface and cleaner
architecture.

This document is design-only. It does not change current implementation.

## Non-Goals

- Adding new auth modes. PAT remains the only credential the wizard handles in
  v1; OAuth is covered separately in
  [`2026-04-22-canvas-authentication-modes.md`](./2026-04-22-canvas-authentication-modes.md).
- Configuring the HTTP/`serve` mode. The wizard targets local stdio, which is
  >95% of installs.
- A graphical / web setup tool. CLI only.
- Installing the package globally. The wizard runs as `npx canvas-lms-mcp init`
  and writes configs that themselves use `npx -y canvas-lms-mcp` so the user
  never owns a global install.

## Surface

### Command shape

```
npx canvas-lms-mcp init [--client <id>...] [--token <t>] [--base-url <u>]
                        [--server-name <name>] [--version <semver>]
                        [--non-interactive] [--dry-run] [--no-backup]
                        [--yes]
```

- `init` is a new subcommand alongside the existing default-stdio mode and the
  `serve` subcommand. It reuses `bin/canvas-lms-mcp.js` so we ship one binary,
  not two.
- With no flags, the wizard is fully interactive (prompts for token, URL,
  clients).
- All flags are optional. Any flag that is set skips the matching prompt; this
  enables one-shot CI/scripted installs:
  `npx canvas-lms-mcp init --client claude-desktop --client cursor --token $T --base-url $U --yes`.
- `--dry-run` prints every file that would change and the resulting content,
  without writing.
- `--non-interactive` (alias `--yes`) requires every needed input to come from
  flags or env; the wizard exits non-zero if anything is missing instead of
  prompting.

### Why a subcommand of the existing bin, not a separate command

The competitor ships a separate `canvas-mcp` npm package whose only job is the
wizard. Two reasons we reject that here:

1. Our existing `bin` already accepts subcommands (`serve` is one). Adding
   `init` is a minimal change and keeps "one tool, one name" — users do not
   have to remember which package owns which command.
2. A second npm package means a second release pipeline, a second supply-chain
   target, and a second README to keep in sync. The wizard's runtime cost is
   small (one tiny prompts dependency, see Dependencies below) and only
   activates when `argv[2] === 'init'`, so bundling it into the main package
   does not slow down the stdio hot path.

The cost is that the wizard's dependencies ship with every install, even
installs that never run `init`. The selected dependency footprint is ~30 KB
gzipped (see Dependencies), which is acceptable.

### Routing in `bin/canvas-lms-mcp.js`

Today the bin is one line: `import '../dist/stdio.js'`. We change it to a
dispatcher:

```js
#!/usr/bin/env node
const sub = process.argv[2]
if (sub === 'init') {
  await import('../dist/init.js')
} else if (sub === 'serve') {
  await import('../dist/http.js')
} else {
  await import('../dist/stdio.js')
}
```

`stdio.ts` and `http.ts` already implement the other two paths; `init.ts` is
new. Each module owns its own argv parsing.

## Clients Supported in v1

The list is calibrated to the same six clients the competitor ships, plus
Continue, all of which already have a documented stdio MCP config. Each client
entry below records: format, file path per OS, and the wrapper key the entry
nests under.

| ID | Name | Format | Wrapper key | Path (Win) | Path (macOS) | Path (Linux) |
|---|---|---|---|---|---|---|
| `claude-desktop` | Claude Desktop | JSON | `mcpServers` | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` | `~/.config/Claude/claude_desktop_config.json` |
| `claude-code` | Claude Code | JSON | `mcpServers` | `~/.claude.json` | `~/.claude.json` | `~/.claude.json` |
| `cursor` | Cursor | JSON | `mcpServers` | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| `vscode` | VS Code (Copilot) | JSON | `servers` | `%APPDATA%\Code\User\mcp.json` | `~/Library/Application Support/Code/User/mcp.json` | `~/.config/Code/User/mcp.json` |
| `windsurf` | Windsurf | JSON | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/mcp_config.json` |
| `codex` | Codex CLI | TOML | `mcp_servers` | `~/.codex/config.toml` | `~/.codex/config.toml` | `~/.codex/config.toml` |
| `continue` | Continue | JSON | `mcpServers` | `~/.continue/config.json` | `~/.continue/config.json` | `~/.continue/config.json` |

Notes:

- VS Code uses the wrapper `servers`, not `mcpServers`. This is a real
  divergence from every other client and must be tested.
- Codex CLI is the only TOML target. Everything else is JSON. Most JSON
  clients use `mcpServers` so they share one writer, with a per-client wrapper
  key override.
- Claude Code's `~/.claude.json` is shared across many tools (it also stores
  permissions, history, etc.). The writer must merge — never replace — the
  top-level object.
- The Continue path may change between releases of Continue; we record it once
  in `clients.ts` and update if it moves.

Clients deliberately not in v1: Zed (no stable MCP config path yet), JetBrains
plugin (alpha as of this writing), Open WebUI (different transport story).

## Config Write Shape

Each client gets an entry whose semantics match what we already document in
`README.md` — the wizard codifies that documentation, it does not invent a new
shape.

### JSON clients (Claude Desktop, Cursor, Claude Code, Windsurf, Continue)

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "npx",
      "args": ["-y", "canvas-lms-mcp@<pinned-version>"],
      "env": {
        "CANVAS_API_TOKEN": "<token>",
        "CANVAS_BASE_URL": "<base-url>"
      }
    }
  }
}
```

### VS Code

Identical to above but under `"servers"` instead of `"mcpServers"`.

### Codex CLI (TOML)

```toml
[mcp_servers.canvas-lms]
command = "npx"
args = ["-y", "canvas-lms-mcp@<pinned-version>"]

[mcp_servers.canvas-lms.env]
CANVAS_API_TOKEN = "<token>"
CANVAS_BASE_URL = "<base-url>"
```

### Differences from the competitor's wizard

The competitor writes a *hosted* `url + headers` config because their wizard
points clients at `https://mcp.illinihunt.org/mcp`. We do not run a hosted
service in v1, so we always write the **stdio** form (`command + args + env`).
This is intentional — it preserves "your token never leaves your machine"
and matches the only auth mode we support.

If/when we ship a hosted endpoint, we add a `--remote <url>` flag that flips
the wizard to write `url + headers` form. The shape of that future work is
already prefigured in
[`2026-04-19-hosted-service-feasibility.md`](../2026-04-19-hosted-service-feasibility.md);
the wizard is the natural place to surface that choice.

### Server-entry name

Default: `canvas-lms`. Configurable via `--server-name`. We already use
`canvas-lms` in `README.md`, so changing the default would introduce a
documentation/wizard mismatch.

### Version pinning

By default the wizard writes `args: ["-y", "canvas-lms-mcp"]` — unpinned, the
same as our README. With `--version <semver>` it writes
`canvas-lms-mcp@<semver>`. Rationale: most users want auto-upgrade; users with
production setups want pinning, and they explicitly opt in.

## Inputs

| Input | Source order | Required? | Validation |
|---|---|---|---|
| Canvas base URL | `--base-url` flag → `CANVAS_BASE_URL` env → prompt | yes | parses as `https:` URL; trailing slash stripped; appends `/api/v1` if missing |
| Canvas API token | `--token` flag → `CANVAS_API_TOKEN` env → prompt (masked input) | yes | non-empty; live-pinged against `/api/v1/users/self` (see Validation) |
| Selected clients | `--client <id>` (repeatable) → multiselect prompt | yes | at least one; each must be in `clients.ts` |
| Server entry name | `--server-name` flag → defaults to `canvas-lms` | no | matches `/^[a-z][a-z0-9-]{0,40}$/` |
| Pinned version | `--version` flag → unpinned | no | parses as semver |

The token prompt uses `prompts`'s `password` type so the value is not echoed
or saved to shell history. We never persist the token anywhere except into the
client config files the user explicitly approves.

## Validation: ping `/api/v1/users/self`

Before writing anything, the wizard issues:

```
GET <base-url>/api/v1/users/self
Authorization: Bearer <token>
```

with a 5 s timeout and:

- `200` → green check, proceed.
- `401` → red, "Token is not accepted by Canvas. Re-enter token (or Ctrl-C to
  abort)." The wizard re-prompts only the token, not the URL.
- `404` / DNS failure / `ENOTFOUND` → red, "Canvas URL is unreachable." The
  wizard re-prompts only the URL.
- `5xx` / network timeout → yellow, "Canvas responded with <status>. Token
  could not be verified. Continue anyway?" (default no) — Canvas instances do
  occasionally return 503 during maintenance, and we do not want to block a
  setup at 2 a.m. when the user is sure their token is right.

We use the existing `CanvasHttpClient` for this — the wizard imports
`createCanvasMCPServer`'s underlying client factory and reuses its retry/auth
plumbing, so validation behavior tracks runtime behavior automatically.

The user-self ping is the same call the competitor uses, the same call most
LMS plugins use as a smoke test, and it requires no scopes beyond what every
PAT has.

## Failure Modes

| Situation | Behavior |
|---|---|
| Config dir does not exist (e.g., user has never opened Cursor) | `mkdir -p`, then write. Print an info note: "Cursor config dir was created — Cursor will pick this up on next launch." |
| User lacks write permission on dir / file | Catch `EACCES`, print path, print exact JSON/TOML the user can paste manually, exit non-zero. Never silently skip — silent skip is the worst possible UX here. |
| Existing config file is malformed JSON/TOML | Backup the malformed file (see Backup), print parse error with line/col, ask user "Overwrite with a clean config containing only canvas-lms? [y/N]". Default no. |
| Existing config has another MCP server registered (not `canvas-lms`) | Merge — preserve every untouched key. Only the `canvas-lms` (or chosen `--server-name`) entry is replaced. |
| Existing config already has a `canvas-lms` entry | Replace it. Print a diff-style summary so the user sees what changed. |
| Token validation fails after 3 retries | Exit non-zero. Print the last HTTP status / error and the user's exact token length so they can sanity-check. Never print the token itself. |
| User Ctrl-C mid-prompt | `prompts`'s `onCancel` handler aborts cleanly. No partial writes. |
| Disk full mid-write | The atomic-write strategy (write-to-temp-then-rename, see Atomic writes) leaves the original file untouched. The error is surfaced and the wizard exits non-zero. |
| Malformed input from CLI flag (bad semver, bad URL) | Validate before any prompting. Exit non-zero with the offending flag named. |

### Atomic writes

For each target file:

1. Read the existing file (if present), parse it.
2. Compute the new content as a string.
3. Copy the existing file to `<path>.bak` (unless `--no-backup`).
4. Write to `<path>.tmp` in the same directory.
5. `fs.rename(<path>.tmp, <path>)`.

`fs.rename` within a single filesystem is atomic on every platform we
support, so a crash between steps 4 and 5 leaves the original file intact.

### Backup policy

- `<path>.bak` is overwritten on every run. Two consecutive runs do not
  produce `.bak.bak`. We document this — the user should treat `.bak` as
  "the previous run's snapshot," not "the original."
- Disable with `--no-backup` (useful for CI where checked-in templates make
  backups noise).

## Distribution: single package vs sub-package

**Recommendation: single package.** Add `init` to the existing
`canvas-lms-mcp` package; do not publish a `@canvas-lms-mcp/cli` companion.

### Single-package trade-offs

Pros:

- One npm package, one release line, one supply-chain target, one README.
- Users have one command to remember (`canvas-lms-mcp`).
- The wizard can `import` the existing Canvas client for live token
  validation without crossing a package boundary or duplicating version-pinned
  fetch behavior.

Cons:

- The wizard's deps (`prompts`, `@iarna/toml`) ship with every install,
  including stdio-only installs that never call `init`. Total cost: ~30 KB
  gzipped, both pure JS, both already in the npm dependency graph of common
  tools the user has installed.
- `npx canvas-lms-mcp init` triggers a re-resolution of the latest version,
  same as `npx canvas-lms-mcp`. There is no extra cold-start.

### Why we reject a separate `@canvas-lms-mcp/cli` package

A second package buys nothing meaningful (the wizard runs as `npx`, so its
size barely matters to users). It costs us:

- Two release pipelines to keep in lockstep.
- Two security-scanned packages on every Renovate run.
- A guaranteed mismatch when one package gets bumped and the other doesn't.

The separate-package pattern only earns its keep when the CLI is large or
has independent versioning needs. Neither applies here.

## Module Structure

All new code lives under `src/init/`. New files:

```
src/init.ts                       # entry point: wires argv → wizard → writer
src/init/argv.ts                  # parseInitArgs(args): InitConfig | InitError
src/init/wizard.ts                # runWizard(InitConfig): Promise<ResolvedInputs>
src/init/clients.ts               # static client registry (paths, formats, wrappers)
src/init/validate.ts              # pingCanvasUsersSelf(token, baseUrl)
src/init/config-writer.ts         # writeClientConfig(client, inputs, opts): WriteResult
src/init/json-merge.ts            # deep-merge that preserves untouched keys
src/init/toml-merge.ts            # same, for TOML (Codex)
src/init/io.ts                    # FileSystem interface + node fs implementation
src/init/format-summary.ts        # green/yellow/red output for human review
```

Tests live under `tests/init/` mirroring the structure.

### Public exports

`src/init.ts` is invoked only by `bin/canvas-lms-mcp.js`. It is not added to
`package.json`'s `exports` map — the wizard is not a library API.

The `clients.ts` registry is the only file a future contributor needs to edit
to add a new client. Every other module is client-agnostic.

### Why a `FileSystem` interface

The unit tests for `config-writer` and the `*-merge` modules need to run
without touching real client config files. We pass an injectable
`FileSystem` (read, write, exists, copy, mkdir, rename) and provide:

- `nodeFileSystem` — wraps `node:fs/promises`.
- `memoryFileSystem` — in-memory map keyed by path, used in tests.

This is the same pattern we already use elsewhere in `src/canvas/` for the
HTTP client (which is similarly injection-friendly). Tests never write to
`~/.cursor/mcp.json`.

### Argv parsing

We do not pull in `commander` or `yargs`. The existing `parseArgs` in
`src/cli.ts` is hand-rolled; `parseInitArgs` follows the same style for
consistency. Total parser size: <100 lines.

## Test Strategy

| Layer | What we test | How |
|---|---|---|
| `clients.ts` | Path resolution per OS for every client | Snapshot tests with `process.platform` and `homedir()` mocked. |
| `json-merge.ts` | Untouched keys preserved; existing entry replaced; new entry inserted; nested keys merged correctly | Property-style tests: feed in arbitrary input JSON, assert only the targeted entry changed. |
| `toml-merge.ts` | Same matrix as JSON, but in TOML | Same property tests, plus a "TOML round-trips through `@iarna/toml` losslessly" check. |
| `config-writer.ts` | Atomic write semantics; backup creation; idempotent re-runs (writing the same input twice produces byte-identical output the second time) | `memoryFileSystem` plus snapshot of the resulting file content. |
| `validate.ts` | 200 / 401 / 404 / 5xx / timeout / DNS-fail outcomes | `fetch` mocked; assert the right user-facing message and exit code. |
| `wizard.ts` | All flag-driven non-interactive paths | Stub `prompts`, drive entirely by `InitConfig`. |
| End-to-end | "Run the wizard against a clean tmp dir, then run it again, then assert merge is idempotent" | Real `node:fs` against `os.tmpdir()`; one test per client, one cross-client test. |

Tests must never:

- Read or write files under the user's real home directory.
- Make a real HTTP call to Canvas (or any host).
- Exit the process. (`process.exit` in production code paths is wrapped in a
  `Result`-returning function during tests.)

We add a CI matrix run on Windows + macOS + Linux for the `clients.ts` path
tests, since that is the only place OS branching exists.

### Snapshot fixtures

For each supported client we ship a fixture: an "existing config that
already has another MCP server" plus the expected merged result. Tests assert
both directions (writing into empty config, writing into populated config).
Snapshot fixtures live at `tests/init/fixtures/<client-id>/`.

## Dependencies

New runtime deps:

- `prompts` (^2.4.2) — small, MIT-licensed, no native deps. Same library the
  competitor uses; widely deployed (>50M weekly downloads). ~13 KB gzipped.
- `@iarna/toml` (^2.2.5) — pure-JS TOML parser/serializer. ~17 KB gzipped.
  Required for Codex CLI's `config.toml`.

Both are tree-shakable. They only land in the install bundle, not the
runtime hot path of stdio mode.

We deliberately do not pull in:

- `chalk` / `kleur` — `prompts` already does color, and we use the same.
- `inquirer` — bigger, slower, and has a CommonJS-only history that fights
  with our ESM build.
- `commander` / `yargs` — overkill for ~10 flags.

## Security & Privacy

- The wizard never writes the token to disk except inside the user-approved
  client config files. No telemetry, no log file, no `.canvas-mcp/history`.
- The token prompt uses masked input. The token never appears in
  `process.argv` unless the user passed `--token` themselves (in which case
  `ps -ef` exposure is a property of their own shell history, not us).
- `.bak` files contain the previous version of the config and may contain
  the previous token. We document this. The wizard prints
  `Backup written: ~/.cursor/mcp.json.bak (contains your previous token —
  delete after verifying the new config works)`.
- `--dry-run` redacts the token in printed output to avoid scrollback /
  CI-log leakage.
- We never call any external service except the user-supplied Canvas base
  URL during validation.

## Implementation Breakdown

A reasonable split into follow-up tasks the Developer (or Lead Developer for
the multi-layer pieces) can pick up:

### Task 1 — Core infrastructure (Lead Developer; ~3 h)

- Add `bin/canvas-lms-mcp.js` subcommand dispatcher.
- Stand up `src/init/argv.ts`, `src/init/io.ts`, `src/init/clients.ts`.
- Wire `src/init.ts` entry as a no-op that prints "init coming soon" and exits
  zero, so the dispatcher works end-to-end.
- Add the `tests/init/clients.test.ts` snapshot per OS.
- No network, no prompts, no real writes yet.

### Task 2 — Config writers (Developer; ~3 h)

- Implement `json-merge.ts`, `toml-merge.ts`, `config-writer.ts`.
- All tests in this task run against `memoryFileSystem`.
- No prompts, no Canvas validation yet.
- Add fixture-based tests for every client.

### Task 3 — Wizard + Canvas validation (Lead Developer; ~3 h)

- Implement `validate.ts` against the existing `CanvasHttpClient`.
- Implement `wizard.ts` (prompts orchestration, retry on bad token).
- Wire `src/init.ts` to call wizard → writer.
- Add E2E tests against `os.tmpdir()`.

### Task 4 — Docs + README (Developer; ~1 h)

- Replace the per-client config blocks in `README.md` with a one-liner:
  `npx canvas-lms-mcp init`.
- Move the manual JSON/TOML blocks into `docs/manual-setup.md` for users who
  prefer them or are on unsupported clients.
- Add a one-line release note for the next minor version.

Total: ~10 h across three parallel-eligible PRs. Tasks 1 and 2 can be done in
parallel. Task 3 depends on both. Task 4 depends on Task 3.

## Open Questions

These do not block this design doc from landing. They get resolved during
Task 1.

1. Does `~/.claude.json` stay the right path for Claude Code, or has the
   official Claude Code release moved it? Verify before Task 1 lands.
2. VS Code's `mcp.json` lives under `User/`, but VS Code Insiders uses a
   different folder. Do we add `vscode-insiders` as a separate client ID?
   Recommendation: yes, but only after v1 ships and we see real demand.
3. Continue's config schema has been changing. Verify the `mcpServers`
   wrapper key is still right at the time Task 2 begins.

## Success Criteria

- A new user with a working Canvas token can go from `npx canvas-lms-mcp init`
  to a working MCP server in their client of choice in under 60 seconds.
- Re-running the wizard with the same inputs produces a byte-identical config
  (idempotent).
- Re-running the wizard with different inputs preserves every other key in
  the user's config (non-destructive merge).
- README's "Setup" section becomes one paragraph, not seven copy-paste blocks.
- The wizard is testable without ever touching a real client's config file.

## References

- Competitor wizard:
  [`vishalsachdev/canvas-mcp/cli`](https://github.com/vishalsachdev/canvas-mcp/tree/main/cli)
- Companion analyses:
  [`2026-04-19-skill-focused-tooling-opportunities-vs-canvas-mcp.md`](./2026-04-19-skill-focused-tooling-opportunities-vs-canvas-mcp.md),
  [`2026-04-22-canvas-authentication-modes.md`](./2026-04-22-canvas-authentication-modes.md)
- Canvas users-self endpoint:
  https://canvas.instructure.com/doc/api/users.html#method.users.api_show
- MCP client config references:
  - Claude Desktop: https://modelcontextprotocol.io/quickstart/user
  - Cursor: https://docs.cursor.com/context/model-context-protocol
  - VS Code Copilot MCP: https://code.visualstudio.com/docs/copilot/copilot-mcp
  - Codex CLI: https://github.com/openai/codex
  - Windsurf: https://docs.codeium.com/windsurf/mcp
