# MCP Skills Extension (SEP-2640): serving Canvas workflow skills over MCP

- **Date:** 2026-09-15
- **Issue:** BRU-2549 (parent BRU-2547, Product Research 2026-09-14)
- **Status:** Proposed — design only. No source change, dependency bump, or public compatibility promise is made by this document.
- **Base:** `origin/main` @ `db2c5e2` (canvas-lms-mcp 1.29.3), `@modelcontextprotocol/sdk` 1.30.0

## 0. Recommendation

**Adopt, in phases, on SDK 1.30.0. Do not wait for SDK v2, and do not move the SDK v2 gate.**

1. **SDK v2 is not needed.** I built a prototype on the real built server factory. On SDK 1.30.0 it passes the official SEP-2640 server conformance scenarios: enumeration **30/30**, manifest **5/5** with one warning that the design below removes. The extension declaration reaches the wire over InMemory, stdio and stateless Streamable HTTP (§4). No released SDK in either line has a skills helper. The TypeScript one is an unmerged PR against the v2 branch (§7).
2. **Fix what is broken today first (Phase 0).** `skills/canvas-admin-roster/SKILL.md` has had invalid YAML frontmatter since #102 (2026-05-01). Three independent parsers reject it (§3.2). This matters beyond MCP: any Agent Skills consumer that parses frontmatter with a real YAML parser cannot read that skill. Under SEP-2640 it is worse, because hosts **MUST** reject the skill. ChatGPT's importer rejects *every* skill if any one fails.
3. **Ship the extension opt-in, not default-on (Phase 1).** None of the mainstream clients support it: Claude Desktop, Claude web, Cursor, VS Code and Goose all show no Skills support. The only production consumer, ChatGPT, imports skills once at plugin-submission time and caps an import at **five** skills; we ship sixteen (§5). Default-on would add 16 entries to every existing user's `resources/list` for no client-side benefit yet.
4. **Shape the catalog per deployment afterwards (Phase 2).** This means a role- and registry-aware listing plus an allowlist, so a ChatGPT submission can serve ≤5 skills.

Estimated size: Phase 0 **S** (1 PR), Phase 1 **M** (1 PR), Phase 2 **S–M** (1 PR). Phase 3 is folded into the existing SDK v2 migration and does not add a new trigger. Details in §8.

## 1. Corrections to the brief

The brief and the research note it cites carry premises that do not survive contact with the sources. Each one changes the design, so they come first.

| # | Brief / research note says | Evidence | Consequence |
| - | --- | --- | --- |
| 1 | "This repo already ships **three** skills" | `skills/*/SKILL.md` at `db2c5e2`: **16** directories. `.claude-plugin/plugin.json` says "16 educator/student workflow skills", guarded by `tests/docs/skill-count-consistency.test.ts`. | 16 exceeds ChatGPT's five-skill import cap, so a curation mechanism is required (§5, Phase 2). |
| 2 | Specify "resource/**archive** delivery" | SEP-2640 *Appendix: Deferred Features → Archive Distribution*: "The Core Maintainers removed archives during review". The conformance traceability file `src/seps/sep-2640.yaml` records that "the five archive rows" were removed. | No archive design. Each file is an individually addressable resource, which is the only form SEP-2640 defines. |
| 3 | Decide whether it can land on SDK 1.30.0 "or must wait for SDK v2" (implies v2 helps) | TS SDK PR #2818 (`installSkills`) is **open**, base `main` (the v2 line), head `b0091060`. The `v1.x` branch tree has **0** paths matching `skill`. npm: `@modelcontextprotocol/sdk` latest `1.30.0`, `@modelcontextprotocol/server` latest `2.0.0`. | Migrating to v2 today buys nothing for this feature. The ~80-line handler is ours to write on either line (§7). |
| 4 | "SDK wrappers … cited by the SEP" (implies they exist) | The Python (#3485), C# (#1856) and Go (#1238) SDK PRs cited under *Reference Implementation* are all **open** as of 2026-09-15. Only `modelcontextprotocol/conformance#330` is merged (2026-09-11). `github/github-mcp-server#3046` is open and titled "[Demo]". | We copy wire shapes from the SEP text, not from a released SDK. The conformance suite is the only executable oracle. |
| 5 | Implied: capability negotiation is a two-sided handshake | In the MCP schema, `extensions` exists on `ServerCapabilities`/`ClientCapabilities` in **2026-07-28 only**. The **2025-11-25** `ServerCapabilities` has `experimental` but no `extensions`. SDK 1.30.0 nevertheless models it: `ServerCapabilitiesSchema.extensions: z.record(z.string(), AssertObjectSchema).optional()` in `dist/esm/types.js`, while negotiating `LATEST_PROTOCOL_VERSION = '2025-11-25'`. | On our wire the declaration rides the `initialize` result. The server never gates on client capabilities (§6.2). |
| 6 | Implied: the server can serve the skills it "ships" | `package.json` `files` is `["bin/","dist/"]`. `npm pack --dry-run` lists **0** skill files. | An `npx canvas-lms-mcp` user has no `skills/` on disk. The content must be embedded at build time (§6.1). |

## 2. What SEP-2640 requires of a server

Sources, all official:

- SEP-2640 text: `modelcontextprotocol/modelcontextprotocol` `seps/2640-skills-extension.md` at merge commit `1eb5bbe8` (PR #2640, merged 2026-09-13T21:27:52Z, Status **Final**, Extensions Track).
- Skills overview: `docs/extensions/skills/overview.mdx`, last change `0744fd2a7b` 2026-09-11, published by PR #3353.
- Extension support matrix: `docs/extensions/client-matrix.mdx`.
- Extensions negotiation: `docs/extensions/overview.mdx`.

Section names below are the SEP's headings.

| Requirement | Level | SEP section | This design |
| --- | --- | --- | --- |
| Declare `capabilities.extensions["io.modelcontextprotocol/skills"]`; `{}` means no optional features | MUST (to use the extension) | Capability Declaration | `{}` (§6.2) |
| A declaring server also declares `resources` | MUST | Capability Declaration | Already true: `McpServer` declares it once any resource is registered. Probe shows capability keys `tools,resources,extensions`. |
| Implement `skills/list` (may be empty or partial; optional cursor; an entry is atomic across pages) | MUST | Enumeration via `skills/list` | Single page, every served skill (§6.3) |
| Implement `skills/get`, answering for every served skill; unknown URI → `-32602`; no cursor | MUST | Retrieval via `skills/get` | §6.4 |
| Entry = `{uri, frontmatter, resources}`. `frontmatter` is verbatim YAML rendered as JSON, **identical** to the file. `resources` is the **complete** `{uri, digest, size}` array, or `"dynamic"`. | MUST | Frontmatter, Resources | Build-time catalog; never `"dynamic"` (§6.1) |
| `digest` = `sha256:` + 64 lowercase hex over the file's **raw bytes**; `size` = byte length | MUST | Integrity and verification | Computed from the embedded bytes; `size` is bytes, not UTF-16 length (§3.2) |
| URI `skill://<skill-path>/<file-path>`; the final `<skill-path>` segment equals `frontmatter.name`; the first segment SHOULD be an RFC 3986 reg-name | SHOULD scheme / MUST name | Resource Mapping | `skill://<name>/SKILL.md`, no prefix (§6.7) |
| `SKILL.md` resource: `mimeType` `text/markdown`; `name` and `description` taken from frontmatter | SHOULD | Resource Metadata | §6.5. The prototype got `name` wrong, and conformance flagged it. |
| ≤ 512 resources and ≤ 16 MiB per skill | SHOULD NOT exceed | Limits | Asserted at generation (§6.12) |
| `resources/directory/read` only when `directoryRead: true` | MAY | Directory Listing | Not declared (§8, deferred) |
| `ttlMs`/`cacheScope` on `skills/list` | from 2026-07-28 | Enumeration | Not applicable on 2025-11-25. Conformance marks these checks SKIPPED (§4). |
| A `resources/read` of a `SKILL.md` does not activate a skill | host rule | Reading | Nothing server-side to do |
| Treat skill content as untrusted, tag origin, ignore MCP-origin `allowed-tools`, content-bound approval, cache isolation | host MUST | Security Implications | Host obligations we **cannot** enforce; we avoid giving hosts anything to gate (§6.11) |
| Error table: unknown skill/file or invalid directory URI → `-32602`; internal failure → `-32603` | normative summary | overview.mdx *Error Handling* | §6.9 |

Backward compatibility (SEP *Backward Compatibility*): "a client that predates the extension never issues [`skills/*`]". A client without the extension "sees `skill://` resources as ordinary resources, which they are." That sentence is the entire fallback story (§6.10).

## 3. Repository inventory (`db2c5e2`)

### 3.1 Surfaces the design touches

| Surface | Today | Evidence |
| --- | --- | --- |
| Skills | 16 dirs, each only a `SKILL.md`; no `references/`, `scripts/` or `assets/`. Relative references inside skills: **0**. | probe `catalog.relativeRefs: []` |
| Frontmatter keys | Exactly `name,description` in all 16; no `allowed-tools`, `license` or `metadata` | probe `frontmatterKeySets` |
| Sizes | 103,282 bytes total; largest 11,872 (`canvas-admin-roster`); longest description 602 chars (limit 1,024) | probe |
| Line endings | All LF, no BOM (`git ls-files --eol skills/` → `16 i/lf w/lf`); **no `.gitattributes`** | shell |
| Resources | `src/resources/index.ts` `registerAllResources`: two `canvas://` templates (`list: undefined`) plus two `ui://` MCP Apps resources. `resources/list` returns **2** entries. | probe control |
| Server factory | `createCanvasMCPServer` in `src/server.ts`: `new McpServer({name, version})` with no `instructions`; tools, then resources; returns **before** `connect` | source |
| stdio | `src/stdio.ts`: one server, one `StdioServerTransport` | source |
| HTTP | `src/http.ts`: **a fresh server per POST** (`sessionIdGenerator: undefined`). A missing token → 400 before any MCP handling. `X-Canvas-Role` narrows the tools. `destructiveTools` is server config only. | source |
| Packaging | `files: ["bin/","dist/"]`; skills are distributed via `.claude-plugin/` (Claude Code) and `npx skills add bruchris/canvas-lms-mcp` (README "Agent Skills") | `npm pack --dry-run` |
| Generated-artifact precedent | `pnpm generate:manifests` → `docs/generated/*.json`, gated by `tests/discovery/manifests.test.ts` "matches the committed generated JSON artifact" | source |
| Vendored-protocol precedent | `src/mcp-apps.ts`: three MCP Apps symbols vendored on v1, "Retype against @modelcontextprotocol/server in Phase 1" | source |
| Env-flag doc surfaces | `CANVAS_ENABLE_ASSIGNMENT_SUBMISSION` appears in `README.md`, `docs/educator-guide.md`, `src/cli.ts`, `src/server.ts`, `src/tools/types.ts` | `git grep` |
| `dist/` baseline | 2,712 KiB | `du` |

### 3.2 Two defects the measurement surfaced

**(a) `canvas-admin-roster` frontmatter is not YAML.** Its `description:` is a plain scalar containing `: ` ("…walking the Canvas account hierarchy: list account…").

| Parser | Result |
| --- | --- |
| `yaml` 2.9.1, the parser the conformance suite uses in `src/scenarios/server/skills/helpers.ts` | `BLOCK_AS_IMPLICIT_KEY` |
| `js-yaml` 4.3.2 | `bad indentation of a mapping entry` |
| PyYAML 6.0.3 | `mapping values are not allowed here` |

The other 15 parse cleanly with all three parsers, and on those 15 a naive `key: value` split agrees with the real parser. The defect was introduced in `88ed233` (#102, 2026-05-01). I have not tested which Agent Skills *hosts* choke on it today, so I make no claim about Claude Code or `skills.sh` behaviour. Under SEP-2640, however, the outcome is determined: hosts "MUST parse its YAML frontmatter and compare it field-by-field … Any discrepancy MUST be treated as a verification failure". An unparseable block cannot compare equal.

**(b) Every skill contains non-ASCII.** All 16 contain characters such as `—`, so `text.length !== Buffer.byteLength(text)` for **16/16**. An implementation that computes `size` from the JS string would publish a wrong size for every skill. Hosts treat a size mismatch as a digest mismatch (SEP *Resources*).

## 4. Measurements

All probes live in `$PAPERCLIP_RUN_SCRATCH_DIR` and are not committed. They import the **built** `dist/server.js` from this commit, resolve `@modelcontextprotocol/sdk` 1.30.0 from the repository lockfile, and run on Node 24.18.1 on Windows. They replicate the `src/stdio.ts` and `src/http.ts` wiring and add the extension. They do not exercise the shipped entry binaries, which do not contain the feature.

The extension under test is about 40 lines: register one static resource per file, call `server.server.registerCapabilities({extensions:{…}})`, and call `server.server.setRequestHandler` for `skills/list` and `skills/get` with Zod request schemas.

### 4.1 Wire probe

| Check | Result |
| --- | --- |
| Negotiated protocol | `2025-11-25` |
| `initialize` capability keys | `tools, resources, extensions` |
| `capabilities.extensions` on the wire: InMemory raw JSON-RPC, **stdio** child process, stateless **HTTP** | `{"io.modelcontextprotocol/skills":{}}` on all three |
| **Control**: identical factory, extension not installed | `extensions` absent; `skills/list` → `-32601 Method not found`; `resources/list` = 2 |
| `skills/list` | 16 entries; keys `skills` only (no `resultType`, correct for 2025-11-25) |
| Host-side replica: `resources/read` every URI, hash the UTF-8 bytes of `text`, compare `size` + `digest` | **16/16** verified (InMemory); stdio and HTTP spot checks verified |
| Host-side replica: re-parse the fetched frontmatter and compare with the entry | **15/16**. `canvas-admin-roster` fails (§3.2a). |
| `resources/list` | 2 → **18**; all 16 skill entries carry `description` and `mimeType: text/markdown` |
| `tools/list` with the extension on | 163, the same as the default configuration |
| `skills/get` known URI | equal to its `skills/list` entry |
| `skills/get` unknown URI | `-32602` |
| `skills/get` with no `uri` | **`-32603`**: the SDK's Zod parse failure surfaces as Internal error. The design validates params itself (§6.9). |
| `skills/list` with a cursor | `-32602` |
| `resources/read` of an unknown `skill://` URI | `-32602` |
| `resources/read` with a differently-cased authority | `-32602` (exact-match lookup) |
| `resources/directory/read` (not declared) | `-32601` |
| `registerCapabilities` after `connect` | throws "Cannot register capabilities after connecting to transport". Installation must happen inside the factory. |
| SDK **v1 `Client`** | `getServerCapabilities().extensions` preserved; `client.request({method:'skills/list'}, schema)` → 16 |
| HTTP | 4 POSTs → 4 server instances, all 200; `skills/get` over HTTP equals the listing entry |
| Per-request construction cost, median of N=60 | plain factory **5.27 ms**; plus extension with a precomputed catalog **5.00 ms** (no difference within noise); plus reading and hashing `skills/` per request **9.01 ms** |

The process emitted a libuv `UV_HANDLE_CLOSING` assertion on exit after the results file was written. It is a Windows teardown artifact of the harness and does not affect the results.

### 4.2 Official conformance suite

`modelcontextprotocol/conformance` at `7169291` (#330), built from source. The npm release `0.1.16` was last modified 2026-08-07 and predates the SEP-2640 scenarios. The target was the prototype served over a replica of `src/http.ts`.

| Run | Result |
| --- | --- |
| Default flags | Every scenario errors: "Unsupported protocol version: **2026-07-28** (supported versions: 2025-11-25, …)". The runner defaults to 2026-07-28 and SDK 1.30.0's transport rejects that version with HTTP 400. |
| `--spec-version 2025-11-25` | Every scenario **SKIPPED** "not applicable at spec version 2025-11-25 (extension scenario, not on the spec timeline)", **with exit code 0**. A green run here means nothing. |
| `--spec-version 2025-11-25 --force`, 16 skills | `sep-2640-skills-enumeration` **30/30** (plus 2 SKIPPED: the cache attributes are 2026-07-28 only). `sep-2640-skills-manifest` **5/5**, 1 WARNING `sep-2640-skillmd-metadata-name`: the prototype registered the resource name as `skill:<dir>`. `sep-2640-skills-directory` 1/1, 6 SKIPPED (no `directoryRead`). |
| Same, 15 skills (admin-roster excluded) | Identical to the 16-skill run |
| Same, **only** `canvas-admin-roster` served | enumeration **28/29, FAILURE `sep-2640-skillmd-frontmatter`** |

The last two rows show the suite *can* detect §3.2a, but the 16-skill run did not. The reason is that `readbackChecks` in `src/scenarios/server/skills/enumeration.ts` reads back **one** sample: `entries.find(e => … e.uri.endsWith('/SKILL.md'))`, which is the first entry, `canvas-accessibility-sweep`. **A green conformance run is therefore not a per-skill guard.** Our own tests must parse every skill (§8).

### 4.3 Skill visibility against the tool registry

For each skill, I matched the backticked identifiers that are real tool names in `docs/generated/tool-manifest.json`. I then checked them against the tools each factory configuration actually registers.

| `role` | `destructiveTools` | tools registered | skills whose tools are all present | skills naming a missing tool |
| --- | --- | --- | --- | --- |
| (all) | allow | 163 | **16** | 0 |
| (all) | block | 156 | 15 | `office-hours` (`delete_appointment_group`) |
| student | allow / block | 56 | **2** | 13 |
| teacher | allow | 145 | 13 | `admin-roster`, `student-todo`, `week-plan` |
| teacher | block | 138 | 12 | the above + `office-hours` |
| admin | allow | 157 | 14 | `student-todo`, `week-plan` |
| admin | block | 150 | 13 | the above + `office-hours` |

Write tools named by skills: `grading-pass` (grade/rubric/comment), `admin-roster` (`enroll_user`, `remove_enrollment`), `office-hours` (appointment-group writes including `delete_appointment_group`), `peer-review-tracker` (`create_peer_review`, `delete_peer_review`, `send_conversation`), `discussion-facilitator`, `quiz-review`, `syllabus-coach`, `at-risk-students`.

## 5. Client landscape and compatibility matrix

Sources: `docs/extensions/client-matrix.mdx` (Skills column); SEP *Reference Implementation*; client docs as cited.

| Client | Skills extension support (2026-09-15) | Notes |
| --- | --- | --- |
| Claude (web), Claude Desktop, VS Code Copilot, M365 Copilot, Goose, Postman, MCPJam, Cursor, Archestra, PostHog Code | **none** listed | Goose tracks host support in `aaif-goose/goose#12068` |
| Claude Code | not public | SEP: "prototyped internally at Anthropic; not yet public" |
| ChatGPT | **Partial** | See below |
| fast-agent | **Partial** | Requires the capability, calls `skills/list` + `skills/get`, verifies SHA-256, downloads every manifest file via `resources/read`; no `resources/directory/read` (fast-agent `docs/docs/mcp/skills-over-mcp.md`) |
| MCP Inspector CLI 2.6.0 | **Partial** | `--method skills/list --verify` runs "the SEP-2640 conformance, digest and frontmatter checks over the skills returned … exit `7` if any fails" (`clients/cli/README.md`) |

**ChatGPT, verbatim** from developers.openai.com/plugins/build/mcp-server, section "Import skills from the MCP server":

- "During plugin submission, Scan Tools imports a static snapshot of those skills into the draft." This is a **publisher-side, one-time** import, not runtime discovery.
- "Declare `io.modelcontextprotocol/skills` in the server's initialization capabilities … OpenAI does not recognize the earlier experimental declaration." That matches exactly what SDK 1.30.0 emits (§4.1).
- "The importer accepts **up to five uniquely named skills** across 10 catalog pages. Each skill can contain up to 100 files", with limits of SKILL.md 256 KiB, each supporting file 1 MiB, and 5 MiB per skill.
- "If any entry fails validation or exceeds a limit, Scan Tools still returns the server's tools but **does not update the draft's imported skills**."
- It verifies that "The fetched SKILL.md front matter exactly matches the catalog entry".

**So serving all 16 skills, or serving `canvas-admin-roster` as it is today, imports zero skills into ChatGPT.** The page still calls SEP-2640 "draft", and its example entries omit `size`, which the final SEP requires. Whether the importer tolerates `size` is **unverified** and has to be confirmed at submission time.

### 5.1 Behaviour of this server by client type (after Phase 1, flag on)

| Client kind | What it sees | Degradation |
| --- | --- | --- |
| No extension support (Claude Desktop, Cursor, VS Code, …) | Unchanged tools; `resources/list` gains 16 `skill://…/SKILL.md` `text/markdown` entries; never calls `skills/*` | None functional. Skills keep arriving through the plugin / `npx skills add` channels. This is why Phase 1 is opt-in: the extra resources are visible in resource pickers. |
| SDK v1–based host (TypeScript, 1.30.0) | `extensions` preserved by `getServerCapabilities()`; `skills/list` callable with a custom result schema (§4.1) | — |
| fast-agent-style host (list → verify → download) | Full flow. It exercises the same calls the conformance suite exercised, but has not been tested against fast-agent itself. | Rejects a skill whose frontmatter does not round-trip, hence Phase 0 |
| ChatGPT plugin submission | Only works with ≤5 valid skills | Phase 2 allowlist |
| 2026-07-28-only client | Nothing new: SDK 1.30.0 does not speak 2026-07-28 today (the conformance default run was rejected with 400) | Unchanged by this feature; owned by the SDK v2 plan |
| Claude Code with the `.claude-plugin` **and** a future SEP-2640-capable Claude Code | The same 16 skills from two origins. SEP *Names* requires hosts to disambiguate rather than dedupe, so the user sees duplicates. | Do not enable the extension in the plugin's MCP config (§8 rollout) |

## 6. Design

### 6.1 Catalog: generated at build time, embedded in the bundle

- `scripts/generate-skills-catalog.ts` (new; wired as `pnpm generate:skills`) walks `skills/<dir>/**`. It walks **every file** under each skill, not just `SKILL.md`, so a future `references/` file lands in `resources` automatically: SEP completeness is a MUST. It emits `src/skills/catalog.generated.ts`, which holds for each skill the `name`, `uri` and verbatim `frontmatter`, and for each file its `uri`, `mimeType`, `text`, `digest` and `size`.
- **The generator fails** unless all of the following hold, every one of them a SEP MUST or SHOULD (§2):
  - the frontmatter parses with `yaml`;
  - `name` equals the directory name and passes the Agent Skills naming rules (1–64 chars, `[a-z0-9-]`, no leading, trailing or doubled hyphen);
  - `description` is 1–1,024 chars;
  - `Buffer.from(text,'utf8').equals(bytes)`, i.e. no BOM and valid UTF-8, so a host hashing the UTF-8 of `content.text` gets the file digest;
  - the per-skill limits hold.
- **Why a committed generated TypeScript module** instead of a runtime read of `skills/`, or a bundler text loader:
  1. The npm tarball has no `skills/` (§1 #6), and adding it would still need path resolution from chunked ESM **and** CJS output.
  2. Digests are computed once, from exactly the bytes that are served.
  3. The freshness gate is the same one `docs/generated/tool-manifest.json` already uses.
  4. There is zero per-request filesystem I/O on the HTTP transport, which builds a server per request. Reading and hashing per request measured +3.7 ms (§4.1).
  5. The YAML parser stays a **devDependency**, so the runtime dependency list is unchanged.
- Trade-offs accepted:
  - Skill text is duplicated in the repo. Mark `src/skills/catalog.generated.ts linguist-generated` in `.gitattributes` so GitHub collapses the diff.
  - The file sits under `src/`, which `pnpm lint` (`prettier --check src/ tests/`) covers. The generator must emit Prettier-clean output, or the file must be added to `.prettierignore`.
  - Bundle size grows by the catalog, roughly 0.1 MB per format plus source maps. **The Phase 1 PR must report the measured `npm pack --dry-run` `unpackedSize` delta** rather than this estimate.

### 6.2 Capability declaration and negotiation

- The extension is declared only when the operator enables it. The declaration is `extensions: { "io.modelcontextprotocol/skills": {} }`: an empty object, with **no** `directoryRead`.
- It is declared inside `createCanvasMCPServer`, after `registerAllResources` and before return. It cannot live in the transports, because capabilities are frozen at `connect` (§4.1).
- The server **never reads client capabilities** to decide. In 2025-11-25 `initialize` a client may send no `extensions` at all (the probe sent `{}`). SEP backward compatibility makes gating unnecessary: unaware clients simply never call `skills/*`.
- The same declaration is emitted for every protocol version SDK 1.30.0 negotiates. `extensions` is outside the 2025-11-25 schema (§1 #5), but SDK v1 clients strip rather than reject unknown keys, and ChatGPT requires this exact placement. A client that validates `initialize` with a closed schema is a theoretical risk that has not been observed. Opt-in is the mitigation.

### 6.3 `skills/list`

- One page containing every skill served on this instance, sorted by `name`; `nextCursor` is never emitted.
- Any `cursor` → `-32602 Invalid cursor`. The conformance pagination check passes with this.
- No `resultType`: that is 2026-07-28 wire vocabulary owned by the v2 codec, per the TS SDK #2818 `schemas.ts` note. No `ttlMs`/`cacheScope` on 2025-11-25.
- `resources` is always an array, never `"dynamic"`. Today each array holds a single `SKILL.md` entry, because the skills have no supporting files.

### 6.4 `skills/get`

- Exact string lookup of `params.uri` against the served skills' `SKILL.md` URIs → `{ skill: <entry> }`, identical to the listing entry (verified in §4.1).
- The following return `-32602`:
  - an unknown URI;
  - a URI of a non-`SKILL.md` file inside a skill (the SEP says `params.uri` MUST be a `SKILL.md` URI);
  - a skill filtered out on this instance (§6.11), because it is not *served* there;
  - a missing or non-string `uri`.

### 6.5 Delivery: `resources/read`

- Each file is registered as a static resource via `McpServer.registerResource`. For `SKILL.md`, the registration **name is `frontmatter.name`**, which fixes the conformance warning. `description` comes from frontmatter and `mimeType` is `text/markdown`. No `_meta`.
  - Registration names must be unique in the `McpServer` resource registry. The existing names are `course-syllabus`, `assignment-description` and two `ui` names, and all skill names start with `canvas-`. The implementation asserts no collision.
- The read returns exactly one `contents` item with the requested `uri`, `mimeType` and `text` (UTF-8). If a binary file is ever added, it is served as `blob` (base64) and hashed over the decoded bytes, following ChatGPT's stated rule and the SEP's raw-bytes rule.
- URI matching is exact and case-sensitive. A differently-cased authority is `-32602` (§4.1).
- The HTTP token requirement is **not** relaxed for skills, even though their content is public MIT text. Special-casing an auth path for one method family is not worth the review surface.

### 6.6 MIME and schema summary

| Field | Value |
| --- | --- |
| Extension id | `io.modelcontextprotocol/skills` |
| Capability value | `{}` |
| Methods | `skills/list` (params `{cursor?}`), `skills/get` (params `{uri}`) |
| Entry | `{ uri: string, frontmatter: {name, description, …verbatim}, resources: [{uri, digest: "sha256:<64 hex>", size: <bytes>}] }` |
| `SKILL.md` resource | `uri skill://<name>/SKILL.md`, `name <name>`, `description <frontmatter.description>`, `mimeType text/markdown` |
| Other files (none today) | `skill://<name>/<path>`, `mimeType` by extension (`.md` → `text/markdown`) |

The server-side types mirror TS SDK #2818 `SkillSchema` (`{uri, frontmatter, resources}`), so the Phase 3 swap is mechanical (§7).

### 6.7 URI stability

- The URI is `skill://<name>/SKILL.md` with **no organizational prefix**, for four reasons:
  1. The names are already namespaced (`canvas-…`).
  2. The authority is then a valid reg-name.
  3. The URI matches the identity users already know from the plugin and `npx skills`.
  4. Hosts key identity by *(host-assigned server label, uri)* (SEP *Skill URIs*), so a prefix adds nothing against collisions.
- I considered `skill://canvas-lms-mcp/<name>/SKILL.md` and rejected it: it is longer, and it duplicates the server identity the host already assigns.
- Once shipped, a URI is effectively public. SEP-2640 has no alias mechanism, because the final segment must equal `name`. **Renaming a skill directory is a breaking change** for hosts with persisted approvals. It must use a `feat!`/`fix!` conventional commit so release-please surfaces it. The generated catalog's diff makes every added, removed or renamed URI visible in review.

### 6.8 Caching and versioning

- **The digest is the version.** Do not add `metadata.version` to skill frontmatter, and do not inject the package version into content. Either would change the bytes on every release and revoke every host's content-bound approval (SEP *Security Implications*) with no real change to the instructions. With digests over unchanged bytes, a release only revokes approvals for skills whose text actually changed.
- The catalog is static per process: no `listChanged`, no subscriptions. HTTP per-request instances share the module-level catalog, so every request sees identical entries (§4.1).
- Phase 3 (2026-07-28): `cacheScope` must be `private`, not `public`, whenever listing depends on a per-request input such as `X-Canvas-Role` (§6.11).

### 6.9 Error behaviour

| Condition | Response |
| --- | --- |
| `skills/*` called with the extension disabled | `-32601` Method not found (SDK default; measured) |
| `skills/get` unknown, filtered-out, or non-`SKILL.md` URI | `-32602` |
| `skills/get` missing or invalid `uri` | `-32602`. Validate manually; do not let the SDK's Zod parse produce `-32603` (§4.1). |
| `skills/list` with any `cursor` | `-32602` |
| `resources/read` of an unknown `skill://` URI | `-32602` (SDK default; measured) |
| `resources/directory/read` | `-32601` (not declared) |
| Invalid skill content (bad YAML, name mismatch, limits) | **Build or test failure**, never a runtime error. The catalog is validated before it can ship. |
| `CANVAS_SKILLS` (Phase 2) names an unknown skill | Startup error. A typo must not silently serve an empty or partial catalog. |

### 6.10 Fallback for clients without the extension

- Nothing breaks. Such clients see ordinary text resources (§5.1).
- The existing channels remain the primary distribution path: `/plugin install canvas-lms-mcp` and `npx skills add bruchris/canvas-lms-mcp`. The README keeps them first.
- **No pointer in `instructions` in Phase 1.** The server sends no `instructions` today. Adding a URI list would cost context on every connection in every client, and it only helps hosts that let the model read resources. This is left as an open question.
- **No duplicate content as MCP prompts.** That would be a third copy of the same text in a third format.

### 6.11 Security and trust boundaries

**Invariant: enabling the extension changes what the server *says*, never what it can *do*.**

1. **Skills cannot broaden tool permissions. This is structural, not conventional.** The extension module only registers read-only resources and two metadata handlers. It never touches tool registration, the role filter, the destructive-tools gate or the Canvas client. The Phase 1 test asserts that `tools/list` (names + annotations) is **identical** with the extension on and off, across every `role × destructiveTools` configuration in §4.3.
2. **No permission-requesting frontmatter.** A test fails if any skill's frontmatter contains a key outside an explicit allowlist (`name`, `description`; `license`, `compatibility` and `metadata` may be added deliberately). It specifically rejects `allowed-tools`: a remote server populating it "is requesting elevated access on the host" (SEP). Hosts MUST ignore it for MCP-origin skills, and we will not ask.
3. **No executable content.** A test fails on any file under `skills/` that is not `.md`. SEP: skills "can place server-authored bytes on the host filesystem and direct the model to execute them". We ship nothing a host would have to approval-gate.
4. **No Canvas data, no per-user content.** The catalog is built from repository files at build time, with no interpolation, so there is no PII or FERPA surface. `PSEUDONYMIZER_WRAPPED_TOOLS` coverage and provenance fencing do not apply. Fencing specifically **must not** wrap skill content: it labels *Canvas-authored* text as data, and these files are authored by this project.
5. **Never `"dynamic"`.** Every entry is content-bound, so hosts can bind approval to digests.
6. **The server-side gates are the enforcement; skill prose is not.**
   - Skills tell the model to confirm before writes, e.g. `canvas-grading-pass` says "explicit confirmation before each write". That is advisory text. Enforcement remains `CANVAS_DESTRUCTIVE_TOOLS` (and the future `confirm` mode from BRU-2390) plus Canvas permissions.
   - Under `block`, a skill step naming `delete_appointment_group` fails with tool-not-found. That is harmless, and Phase 2 hides the skill anyway.
7. **Role-aware listing (Phase 2) is UX, not a security boundary.** `X-Canvas-Role` is caller-supplied (see `src/http.ts`). Hiding educator skills from a student listing reduces confusion. Real protection stays where it is: tool registration and Canvas permissions.
   - Proposed rule: a skill is served on an instance only if **every** tool it names is registered on that instance. The generator records each skill's `requiredTools` in the catalog as server-side metadata, never on the wire and never in frontmatter.
   - Measured effect (§4.3): student 2, teacher 13, admin 14, all/block 15.
   - When a skill is filtered, its resources are not registered either, and `skills/get` answers `-32602` (§6.4), so the view stays consistent.
8. **Digests are not trust.** They are unsigned and come from the same server as the content (SEP). Docs must not describe the feature as "verified" or "signed".
9. **Multi-tenant HTTP.** The catalog is identical for every caller apart from the role filter. There is no per-caller state, so nothing here resembles the shared-pseudonymizer issue (BRU-2515).
10. **Host obligations we cannot enforce, documented for operators:** origin tagging, per-skill approval, ignoring `allowed-tools`, cache isolation, cross-server read binding. Our contribution is not needing any of the risky ones (items 2, 3, 5).

### 6.12 Limits

The generator asserts the SEP bounds (≤512 files, ≤16 MiB per skill). It also warns on the tighter ChatGPT bounds (SKILL.md ≤256 KiB, file ≤1 MiB, skill ≤5 MiB, ≤100 files) so the catalog stays importable. The current maximum is 11,872 bytes in a single file.

## 7. SDK 1.30.0 or SDK v2?

**Decision: land on 1.30.0. The standing SDK v2 gate is preserved; nothing here makes migration technically unavoidable.**

Evidence:

- **It works on v1 at the wire level** (§4): declaration on three transports, 16/16 digests verified, official conformance 30/30 + 5/5, and the control proves it is not vacuous.
- **The v1 hooks it needs are public and stable.** `Server.registerCapabilities` (merges before connect). `Protocol.setRequestHandler` accepts any method literal. `Server.assertRequestHandlerCapability` has no case for `skills/*`, so it does not throw.
- **v2 offers no helper yet.** #2818 is open on `main` (v2) and unreleased. `@modelcontextprotocol/server` is still `2.0.0` with **no 2.0.x patch**, so the SDK v2 Phase 1 gate in `docs/superpowers/plans/2026-07-28-mcp-sdk-v2-migration.md` ("A 2.0.x patch exists") remains **unmet** on 2026-09-15.
- **The migration cost stays contained.** Like `src/mcp-apps.ts`, `src/skills/extension.ts` is the only file that imports SDK internals for this feature. v2 changes `setRequestHandler` to `(method, {params, result}, handler)`, and #2818's `installSkills(server, {skills})` takes the same `{uri, frontmatter, resources}` entries. Phase 3 swaps our handler body for the SDK's, or keeps ours.

What v1 costs us: we write about 80 lines the SDK will eventually provide, and we must hand-validate params to get `-32602` (§6.9).

## 8. Phased implementation plan

### Phase 0: skill hygiene. Size S, 1 PR, Developer-routable

Independent of MCP; it helps plugin and `npx skills` users now.

| File | Change |
| --- | --- |
| `skills/canvas-admin-roster/SKILL.md` | Quote the `description` scalar; no wording change |
| `package.json` | Add `yaml` as a **direct** devDependency. `yaml@2.8.3` is present only transitively, and pnpm's strict layout will not let a script import it. |
| `tests/skills/frontmatter.test.ts` (new) | For every skill: parses with `yaml`; `name` == dir and valid; description 1–1,024; frontmatter keys ⊆ allowlist; no `allowed-tools`; only `.md` files; UTF-8 without BOM; LF only |
| `.gitattributes` (new) | `skills/** text eol=lf`. The repo has none; an `autocrlf=true` Windows checkout would change the bytes, and the Phase 1 digests would disagree with CI. |

Acceptance: the new test is **red on `main`**, failing only on `canvas-admin-roster`, and green after the fix, with the red run quoted in the PR.

### Phase 1: serve the extension, opt-in. Size M, 1 PR

| File | Change |
| --- | --- |
| `scripts/generate-skills-catalog.ts` (new), `package.json` script `generate:skills` | §6.1. Confirm whether `tsconfig.json` includes `scripts/`; if not, keep the builder where typecheck sees it. |
| `src/skills/catalog.generated.ts` (new, generated) | §6.1 |
| `src/skills/extension.ts` (new) | `installSkillsExtension(server, catalog)`: resources + capability + handlers (§6.2–6.5, §6.9) |
| `src/server.ts` | `CanvasMCPServerConfig.enableSkillsExtension?: boolean`; call before return |
| `src/cli.ts` | `--enable-skills-extension` / `CANVAS_ENABLE_SKILLS_EXTENSION`, parsed like `enableAssignmentSubmission`. It is a read-only content surface, so the existing `isEnvTruthy` normalization is acceptable. |
| `src/stdio.ts`, `src/http.ts` | Pass the flag through (server config only; no per-request header) |
| `.gitattributes` | `src/skills/catalog.generated.ts linguist-generated` |
| `README.md`, `docs/educator-guide.md` | Env var row; README "Agent Skills" gains a short "Served over MCP (experimental, opt-in)" note. Keep plugin / `npx` first. |

Tests (all in CI; `pnpm test` runs before `pnpm build`, so no test may depend on `dist/`):

| File | Asserts |
| --- | --- |
| `tests/skills/catalog.test.ts` | Committed catalog equals regeneration from `skills/` (freshness); per entry: URI pattern, final segment == `frontmatter.name`, `digest` == sha256(file bytes), `size` == byte length, pinned with a non-ASCII fixture so `text.length` would fail; `frontmatter` deep-equals `yaml.parse`; completeness against a temp fixture skill containing a `references/` file; limits |
| `tests/skills/extension-wire.test.ts` | Raw JSON-RPC over `InMemoryTransport`, like §4.1. **Control first**: disabled → no `extensions`, `skills/list` `-32601`, `resources/list` unchanged. Enabled → declaration; list shape; `get` known/unknown/malformed/non-`SKILL.md` → `-32602`; cursor → `-32602`; host-side replica of digest + size + frontmatter verification for every URI; `resources/list` names == frontmatter names; `resources/directory/read` → `-32601`. **Permission invariant**: `tools/list` identical on/off for every `role × destructiveTools`. |
| `tests/stdio.test.ts`, `tests/http.test.ts` | Extend the existing harnesses: the flag reaches the factory; `initialize` carries the declaration; over HTTP, two independent POSTs (two server instances) return identical `skills/list` |

Manual pre-merge evidence, recorded in the PR and not a CI gate:
- The conformance suite from source at `--spec-version 2025-11-25 --force` over `pnpm build && node dist/http.js`. Do not count a run without `--force` (§4.2).
- `mcp-inspector --cli … --method skills/list --verify` exit 0.
- The `npm pack --dry-run` size delta.

**Why conformance is not a CI gate:** the npm package predates the scenarios, running from git adds a network and build step, and the suite samples a single skill (§4.2). Our own tests are the gate. Revisit when an npm release of `@modelcontextprotocol/conformance` includes #330.

### Phase 2: deployment shaping. Size S–M, 1 PR

| File | Change |
| --- | --- |
| generator + catalog | `requiredTools` per skill (§6.11 item 7) |
| `src/skills/extension.ts` | Serve only skills whose `requiredTools` ⊆ registered tools, evaluated per instance and therefore per HTTP request and role |
| `src/cli.ts`, `src/server.ts` | `CANVAS_SKILLS=<comma-separated names>` allowlist; unknown name → startup error; empty → error |
| tests | Visibility matrix from §4.3 as a table-driven test; allowlist of 5 → `skills/list` = 5 |
| docs | "Publishing skills to a ChatGPT plugin": ≤5 via `CANVAS_SKILLS`, then run Scan Tools |

### Phase 3: folded into the SDK v2 migration. No new trigger

- On the SDK v2 Phase 1 PR, retype `src/skills/extension.ts` against `@modelcontextprotocol/server`. Adopt #2818's `installSkills` if it is released.
- When 2026-07-28 is adopted (SDK plan Phase 2): add `ttlMs` + `cacheScope` (`private` if role-filtered, §6.8); `resultType` comes from the codec.

### Explicitly deferred

- `resources/directory/read`: no skill has supporting files; conformance skips it cleanly.
- `"dynamic"` skills and archives: archives were removed from the SEP.
- An `instructions` pointer.
- Default-on.

### Rollout

1. Phase 0 ships whenever ready.
2. Phase 1 ships as **opt-in, documented as experimental**. Do **not** enable it in `.claude-plugin/plugin.json` or the MCPB manifest: those users already get the skills from the filesystem, and a future SEP-2640 Claude Code would list them twice (§5.1).
3. Revisit default-on when any client in the matrix's "none" group ships support. The CTO records that check on the Canvas pipeline sweep; this doc makes no promise.
4. The changelog comes from conventional commits via release-please; do not hand-edit `CHANGELOG.md`.

### Rollback

- **Phase 1/2 operationally:** unset `CANVAS_ENABLE_SKILLS_EXTENSION`. There is no persisted server state, no migration and no data. Hosts that stored approvals see the skills disappear; SEP semantics treat a missing listing as not proof of absence, and `skills/get` returns `-32602`.
- **In code:** revert the PR.
- **Bad skill content:** fix the file. The digests change and hosts re-prompt under content-bound approval, which is the SEP's designed recovery.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mainstream clients never ship support, so the feature sees little use | High | Medium | Opt-in; S/M cost; Phase 0 pays off regardless |
| A client rejects `capabilities.extensions` under 2025-11-25 | Low | Medium | Opt-in; SDK v1 clients strip rather than reject (probe); ChatGPT requires this placement |
| ChatGPT's draft-era importer rejects a final-SEP detail (e.g. `size`) | Medium | Medium (ChatGPT only) | Verify at submission; the field is SEP-required, so do not drop it pre-emptively |
| Frontmatter drift re-breaks a skill | Proven once (1/16) | High under SEP (skill or whole import rejected) | Phase 0 test; the conformance sampling gap (§4.2) is why it has to be ours |
| SEP-2640 evolves | Medium | Low | Changes arrive as capability flags or new ids per the Extensions overview *Evolution*; one module to update |
| Duplicate skills in hosts with plugin + MCP | Medium | Low | Not enabled in the plugin/MCPB manifests; documented |
| Generated catalog noise in diffs | High | Low | `linguist-generated`; freshness test |
| #2818 lands with a different shape | Low | Low | Only `src/skills/extension.ts` changes |

## 10. Open questions for CTO / board

1. **Default:** opt-in (recommended) or default-on for stdio?
2. **Listing rule under filters:**
   - "every named tool registered" (recommended; student sees 2 of 16, all/block hides `office-hours`);
   - no filtering;
   - "any named tool registered".
3. **ChatGPT plugin:** is a submission planned? If so, which ≤5 skills?
4. **Catalog embedding:** a committed generated TypeScript literal (recommended, §6.1) or a bundler text loader plus a committed index?
5. **Env var naming:** `CANVAS_ENABLE_SKILLS_EXTENSION` and, for Phase 2, `CANVAS_SKILLS`.
6. **Conformance-from-source:** run it as a nightly or manual workflow before an npm release includes #330?
7. **Phase 0 routing:** it is mechanical and could go to the Developer agent.

## Appendix A: Sources

| Source | Pin |
| --- | --- |
| SEP-2640 text | `modelcontextprotocol/modelcontextprotocol` `seps/2640-skills-extension.md` @ `1eb5bbe8` (PR #2640) |
| Skills overview / client matrix / extensions overview | same repo `docs/extensions/{skills/overview,client-matrix,overview}.mdx` @ `main` (PR #3353 merge `2997f33b`; overview last change `0744fd2a7b`) |
| Protocol schemas | same repo `schema/2025-11-25/schema.ts` (no `extensions` in capabilities), `schema/2026-07-28/schema.ts` (`extensions?: { [key: string]: JSONObject }`) |
| TS SDK skills PR | `modelcontextprotocol/typescript-sdk#2818` @ `b0091060` (open; also #2797, #2791 open) |
| Conformance | `modelcontextprotocol/conformance` @ `7169291` (#330): `src/scenarios/server/skills/{enumeration,manifest,directory,helpers}.ts`, `src/seps/sep-2640.yaml` |
| Reference SDK PRs | python-sdk#3485, csharp-sdk#1856, go-sdk#1238, github/github-mcp-server#3046 (all open) |
| Working group repo | `modelcontextprotocol/ext-skills` (renamed from `experimental-ext-skills`), Apache-2.0 |
| Agent Skills specification | agentskills.io/specification (name/description rules, `allowed-tools`) |
| ChatGPT | developers.openai.com/plugins/build/mcp-server, "Import skills from the MCP server" (fetched 2026-09-15) |
| fast-agent | `evalstate/fast-agent` `docs/docs/mcp/skills-over-mcp.md` |
| MCP Inspector | `modelcontextprotocol/inspector` `clients/cli/README.md` "Skill verification" (CLI 2.6.0) |
| SDK v1 internals | `@modelcontextprotocol/sdk@1.30.0` `dist/esm/{types,server/index,shared/protocol,client/index}.js` |
| This repo | `origin/main` @ `db2c5e2` |

## Appendix B: Reproducing the measurements

The probe scripts (`skills-probe.mjs`, `http-serve.mjs`, `visibility.mjs`) and raw outputs were kept in the run scratch directory and are not committed. Each step is described so it can be rebuilt in a few minutes.

1. Build this commit (`pnpm install --frozen-lockfile && pnpm build`). Put a script inside the worktree so that `@modelcontextprotocol/sdk` resolves from the lockfile. Import `createCanvasMCPServer` from `dist/server.js`, install the ~40-line handler from §4, and drive it with raw JSON-RPC over `InMemoryTransport`, a spawned stdio child, and a `node:http` server that builds one server per POST.
2. Conformance:
   `git clone https://github.com/modelcontextprotocol/conformance && npm ci && npm run build && node dist/index.js server --url http://127.0.0.1:<port>/mcp --scenario sep-2640-skills-enumeration --spec-version 2025-11-25 --force`
   Repeat for `-manifest` and `-directory`, and once serving only `canvas-admin-roster`.
3. YAML: parse each frontmatter block with `yaml`, `js-yaml` and PyYAML.
