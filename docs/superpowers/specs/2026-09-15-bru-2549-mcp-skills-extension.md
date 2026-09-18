# MCP Skills Extension (SEP-2640): serving Canvas workflow skills over MCP

- **Date:** 2026-09-15
- **Issue:** BRU-2549 (parent BRU-2547, Product Research 2026-09-14)
- **Status:** Proposed — design only. No source change, dependency bump, or public compatibility promise is made by this document.
- **Base:** `origin/main` @ `db2c5e2` (canvas-lms-mcp 1.29.3), `@modelcontextprotocol/sdk` 1.30.0
- **Amended:** 2026-09-18 (BRU-2587) to reconcile with issue #355, which proposes serving the same skills as MCP prompts. Changed: §0 item 5, §3.2, §4.4 (new), §5.1, §6.1, §6.10, §6.11, §6.13 (new), §8, §9, §10 and the appendices. Everything else is as written on 2026-09-15.

## 0. Recommendation

**Adopt, in phases, on SDK 1.30.0. Do not wait for SDK v2, and do not move the SDK v2 gate.**

1. **SDK v2 is not needed.** I built a prototype on the real built server factory. On SDK 1.30.0 it passes the official SEP-2640 server conformance scenarios: enumeration **30/30**, manifest **5/5** with one warning that the design below removes. The extension declaration reaches the wire over InMemory, stdio and stateless Streamable HTTP (§4). No released SDK in either line has a skills helper. The TypeScript one is an unmerged PR against the v2 branch (§7).
2. **Fix what is broken today first (Phase 0).** `skills/canvas-admin-roster/SKILL.md` has had invalid YAML frontmatter since #102 (2026-05-01). Three independent parsers reject it (§3.2). This matters beyond MCP: any Agent Skills consumer that parses frontmatter with a real YAML parser cannot read that skill. Under SEP-2640 it is worse, because hosts **MUST** reject the skill. ChatGPT's importer rejects *every* skill if any one fails. *Update 2026-09-18:* this fix was split out as BRU-2586. PR #357 is open and not merged (§8).
3. **Ship the extension opt-in, not default-on (Phase 1).** None of the mainstream clients support it: Claude Desktop, Claude web, Cursor, VS Code and Goose all show no Skills support. The only production consumer, ChatGPT, imports skills once at plugin-submission time and caps an import at **five** skills; we ship sixteen (§5). Default-on would add 16 entries to every existing user's `resources/list` for no client-side benefit yet.
4. **Shape the catalog per deployment afterwards (Phase 2).** This means a role- and registry-aware listing plus an allowlist, so a ChatGPT submission can serve ≤5 skills.
5. **Share one catalog with the prompt surface that #355 proposes instead of ruling it out (§6.13, added 2026-09-18).** Both surfaces share:
   - one generator;
   - one YAML parser (`yaml`);
   - one catalog;
   - one frontmatter contract;
   - one visibility rule.

   #355's per-skill `metadata` keys pass SEP-2640's field-by-field frontmatter comparison for 16/16 skills, and official conformance agrees. This holds only while the catalog carries the parsed frontmatter verbatim. Whether prompts ship, and in which phase, is open question 8.

Estimated size: Phase 0 **S** (1 PR), Phase 1 **M** (1 PR), Phase 2 **S–M** (1 PR). Phase 3 is folded into the existing SDK v2 migration and does not add a new trigger. #355 sizes the prompt surface. After §6.13 it adds no generator of its own. Details in §8.

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

The other 15 parse cleanly with all three parsers, and on those 15 a naive `key: value` split agrees with the real parser. The defect was introduced in `88ed233` (#102, 2026-05-01). I have not tested which Agent Skills *hosts* choke on it today, so I make no claim about Claude Code or `skills.sh` behaviour. Under SEP-2640, however, the outcome is determined: hosts "MUST parse its YAML frontmatter and compare it field-by-field … Any discrepancy MUST be treated as a verification failure". An unparseable block cannot compare equal. BRU-2586 fixes the file by single-quoting the scalar (PR #357, open on 2026-09-18).

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

### 4.4 Reconciliation with #355 (added 2026-09-18, BRU-2587)

**Setup.** This is the §4 approach, rebuilt because the 09-15 scratch files are gone:
- built `dist/server.js` at `db2c5e2`;
- SDK 1.30.0 and `yaml` 2.8.3 from the lockfile;
- Node 24.18.1 on Windows.

#355's frontmatter parser (`parseSkillFile`) and its per-skill metadata table were **extracted from its draft plan by anchor text at runtime** and transpiled. Neither was retyped. The probes use three skill variants:
- *base* (`db2c5e2`);
- *fixed*: BRU-2586's single-quoted `description`;
- *+metadata*: #355's two `metadata` keys, inserted exactly as its plan specifies.

**(a) Parser agreement: `yaml` vs #355's line-split parser**

| Input | Agree | Disagree |
| --- | --- | --- |
| base + metadata (`canvas-admin-roster` unfixed) | 15/16 | `canvas-admin-roster`: `yaml` rejects it, the line-split parser accepts it |
| fixed + metadata | **16/16** | none |
| 7 single-line edits to one skill (below) | 0/7 | 7/7; 5 of the 7 silently return a different value |

| Edit to `canvas-grading-pass` | `yaml` (what every host sees) | Line-split parser |
| --- | --- | --- |
| `description: 'Don''t skip the rubric.'` | `Don't skip the rubric.` | `Don''t skip the rubric.` (silent) |
| `description: "Say \"grade\" to start."` | `Say "grade" to start.` | `Say \"grade\" to start.` (silent) |
| `description: Grade submissions in order #1 first.` | `Grade submissions in order`, because ` #` starts a comment | the full line (silent) |
| `description: Grade submissions. # internal note` | `Grade submissions.` | the full line (silent) |
| a second `description:` key | rejected (`uniqueKeys`) | the last value wins (silent) |
| a folded block scalar (`>-`) | parsed | rejected |
| a `# comment` line in the frontmatter | ignored | rejected |

The divergence is **latent, not live**. Once BRU-2586 lands, both parsers read today's 16 files identically. It goes live with the first edit of one of the kinds above, and a test catches none of the silent kinds.

**(b) SEP-2640 with #355's metadata in the frontmatter**

| Catalog | Host-side replica (§4.1): digest + size / frontmatter | Official conformance, `7169291`, `--spec-version 2025-11-25 --force` |
| --- | --- | --- |
| fixed + metadata; `frontmatter` = `yaml.parse` of the file, verbatim | 16/16 / **16/16** | enumeration: 29 SUCCESS, 2 SKIPPED (the cache attributes), **0 FAILURE**. This includes `sep-2640-entry-frontmatter-identical` and `sep-2640-metadata-reserved-prefix`. Manifest: **5/5**, 0 WARNING. |
| Control: same files; `frontmatter` = #355's projected fields (`name`, `description`), without `metadata` | 16/16 / **0/16**; the `metadata` key differs on every entry | enumeration: **FAILURE `sep-2640-entry-frontmatter-identical`** |
| Control: `canvas-admin-roster` unfixed; frontmatter from the line-split parser | 16/16 / 15/16; the file is unparseable | served alone: enumeration **FAILURE `sep-2640-skillmd-frontmatter`**, manifest **FAILURE `sep-2640-final-segment-equals-name`** |
| Control: the 7 edits above; frontmatter from the line-split parser | 4 FAIL on `description`, 1 unparseable file, 2 generator errors | not run |

Conformance reads back only the first entry (§4.2). Under +metadata that entry is `canvas-accessibility-sweep`, and it carries both metadata keys. So the identical-frontmatter check really compared a block with `metadata` in it, and the second row shows the check fires when `metadata` is missing. §4.2 records the 09-15 enumeration run as 30 successes. Today's run at the same conformance SHA emits 31 checks: 29 successes and 2 skipped. I did not keep the 09-15 log, so I cannot attribute the one-check difference.

**(c) Both surfaces on one server**

The probe used a stand-in for #355's handler shape: its own `prompts/list` and `prompts/get` on the underlying `Server`, as its §1.1 prescribes. It was fed from the same catalog entries as the extension and installed on one `createCanvasMCPServer` instance, in both orders:

| | skills, then prompts | prompts, then skills |
| --- | --- | --- |
| `initialize` capability keys | `extensions, prompts, resources, tools` | same |
| `tools` / `resources` `listChanged` | `true` / `true` | same |
| `tools/list`, `resources/list`, `prompts/list`, `skills/list` | 163, 18, 16, 16 | same |
| host-side verification | 16/16 | 16/16 |
| prompt description equals `frontmatter.description` | yes | yes |

Control: the extension alone, with no prompts installed, advertises no `prompts` key, and `prompts/list` returns `-32601`.

If two generated modules each embedded the text, the skill text would ship twice. The bodies #355 stores are 95,849 of the 105,154 skill bytes (91%), so about 96 KB would be duplicated in each bundle format (ESM and CJS). From one catalog, the prompt body is a slice of the text the extension already serves, so it costs 0 extra bytes.

**(d) Which hosts each surface reaches**

| Surface | Source | Clients with support |
| --- | --- | --- |
| MCP prompts | `docs/clients.mdx` at `0dfb7b6`. This community-maintained, self-reported list was the last version before the page was deleted on 2026-05-27. | **43 of 114**, including Claude Desktop, Claude.ai, Claude Code, Cursor, VS Code GitHub Copilot, Goose, Continue, Zed, Gemini CLI and fast-agent. It does **not** include ChatGPT, Windsurf or Cline. |
| SEP-2640 Skills | `docs/extensions/client-matrix.mdx` at `af68e21` (2026-09-08) | **0** with full support; 3 Partial (ChatGPT, fast-agent, MCP Inspector) out of 14 rows |

Only fast-agent appears in both lists, so the two surfaces reach almost entirely different hosts:
- **Prompts** reach the desktop and IDE hosts that users run today.
- **The extension** reaches the one production importer (ChatGPT), which lists no prompt support.

**(e) Visibility: the derived rule vs #355's declared audience**

Tools registered by the real factory were measured for every combination of `role` × `destructiveTools` × `enableAssignmentSubmission`: 16 configurations. The two rules:
- **Derived:** every tool named in the skill body is registered (§6.11 item 7, 09-15).
- **Declared:** `ROLE_VISIBILITY[role]` contains the skill's `…-audience` value from #355's table. An unset role sees all skills.

Each row below covers both values of the assignment-submission flag, which changes neither rule.

| Configurations | Derived (unset / student / teacher / admin) | Declared | Difference |
| --- | --- | --- | --- |
| `allow`, all 4 roles (8) | 16 / 2 / 13 / 14 | identical | none |
| `block`, student (2) | 2 | 2 | none |
| `block`, unset / teacher / admin (6) | 15 / 12 / 13 | 16 / 13 / 14 | `canvas-office-hours`, whose `delete_appointment_group` is not registered under `block` |

The derived rule never shows a skill that the declared audience hides.

Both proposals also derive tool references the same way. The write tools #355 derives (tool names in the body, filtered to `destructiveHint`) are exactly the destructive subset of §4.3's per-skill tool list: the same 8 skills, with the same counts as #355's §3.1.

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
| No extension support (Claude Desktop, Cursor, VS Code, …) | Unchanged tools; `resources/list` gains 16 `skill://…/SKILL.md` `text/markdown` entries; never calls `skills/*` | None functional. Skills keep arriving through the plugin / `npx skills add` channels, and as prompts if #355 ships (§6.13). This is why Phase 1 is opt-in: the extra resources are visible in resource pickers. |
| SDK v1–based host (TypeScript, 1.30.0) | `extensions` preserved by `getServerCapabilities()`; `skills/list` callable with a custom result schema (§4.1) | — |
| fast-agent-style host (list → verify → download) | Full flow. It exercises the same calls the conformance suite exercised, but has not been tested against fast-agent itself. | Rejects a skill whose frontmatter does not round-trip, hence Phase 0 |
| ChatGPT plugin submission | Only works with ≤5 valid skills | Phase 2 allowlist |
| 2026-07-28-only client | Nothing new: SDK 1.30.0 does not speak 2026-07-28 today (the conformance default run was rejected with 400) | Unchanged by this feature; owned by the SDK v2 plan |
| Claude Code with the `.claude-plugin` **and** a future SEP-2640-capable Claude Code | The same 16 skills from two origins. SEP *Names* requires hosts to disambiguate rather than dedupe, so the user sees duplicates. | Do not enable the extension in the plugin's MCP config (§8 rollout) |

## 6. Design

### 6.1 Catalog: generated at build time, embedded in the bundle

- `scripts/generate-skills-catalog.ts` (new; wired as `pnpm generate:skills`) walks `skills/<dir>/**`. It walks **every file** under each skill, not just `SKILL.md`, so a future `references/` file lands in `resources` automatically: SEP completeness is a MUST. It emits `src/skills/catalog.generated.ts`, which holds for each skill the `name`, `uri` and verbatim `frontmatter`, and for each file its `uri`, `mimeType`, `text`, `digest` and `size`.
- **It is the only generator over `skills/` for every surface (amended 2026-09-18, §6.13).** Besides the fields above, it emits:
  - each skill's `referencedTools`: backticked identifiers matched against the complete tool registry;
  - the byte offset of the `SKILL.md` body.

  The prompt surface proposed in #355 reads these fields and does not generate its own module.
- **The generator fails** unless all of the following hold, every one of them a SEP MUST or SHOULD (§2) or part of the §6.13.2 contract:
  - the frontmatter parses with `yaml` at defaults and satisfies the §6.13.2 contract (no comments, allowlisted keys, `metadata` shape);
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
- **MCP prompts are composed with this design, not rejected (amended 2026-09-18).** The 09-15 text read: "No duplicate content as MCP prompts. That would be a third copy of the same text in a third format." That objection assumed a hand-maintained copy. A prompt surface generated from this catalog adds no copy of the text. It also reaches hosts this extension cannot reach (§4.4c–d). §6.13 specifies what the two surfaces share. Whether prompts ship is open question 8.

### 6.11 Security and trust boundaries

**Invariant: enabling the extension changes what the server *says*, never what it can *do*.**

1. **Skills cannot broaden tool permissions. This is structural, not conventional.** The extension module only registers read-only resources and two metadata handlers. It never touches tool registration, the role filter, the destructive-tools gate or the Canvas client. The Phase 1 test asserts that `tools/list` (names + annotations) is **identical** with the extension on and off, across every `role × destructiveTools` configuration in §4.3.
2. **No permission-requesting frontmatter.** A test fails if any skill's frontmatter contains a key outside an explicit allowlist: `name`, `description`, and `metadata` under the §6.13.2 contract (amended 2026-09-18). `license` and `compatibility` may be added deliberately. It specifically rejects `allowed-tools`: a remote server populating it "is requesting elevated access on the host" (SEP). Hosts MUST ignore it for MCP-origin skills, and we will not ask.
3. **No executable content.** A test fails on any file under `skills/` that is not `.md`. SEP: skills "can place server-authored bytes on the host filesystem and direct the model to execute them". We ship nothing a host would have to approval-gate.
4. **No Canvas data, no per-user content.** The catalog is built from repository files at build time, with no interpolation, so there is no PII or FERPA surface. `PSEUDONYMIZER_WRAPPED_TOOLS` coverage and provenance fencing do not apply. Fencing specifically **must not** wrap skill content: it labels *Canvas-authored* text as data, and these files are authored by this project.
5. **Never `"dynamic"`.** Every entry is content-bound, so hosts can bind approval to digests.
6. **The server-side gates are the enforcement; skill prose is not.**
   - Skills tell the model to confirm before writes, e.g. `canvas-grading-pass` says "explicit confirmation before each write". That is advisory text. Enforcement remains `CANVAS_DESTRUCTIVE_TOOLS` (and the future `confirm` mode from BRU-2390) plus Canvas permissions.
   - Under `block`, a skill step naming `delete_appointment_group` fails with tool-not-found. That is harmless. Under the 09-15 Phase 2 rule the skill was hidden. Under the §6.13.3 recommendation it stays listed.
7. **Role-aware listing (Phase 2) is UX, not a security boundary.** `X-Canvas-Role` is caller-supplied (see `src/http.ts`). Hiding educator skills from a student listing reduces confusion. Real protection stays where it is: tool registration and Canvas permissions.
   - 09-15 rule: a skill is served on an instance only if **every** tool it names is registered on that instance. The generator records each skill's tool list in the catalog as server-side metadata, never on the wire. (The list was named `requiredTools` on 09-15 and `referencedTools` from §6.13.1.)
   - Measured effect (§4.3): student 2, teacher 13, admin 14, all/block 15.
   - **Superseded as the recommendation on 2026-09-18 by §6.13.3.** The declared audience decides visibility at runtime, and the tool list becomes a CI consistency check. The rule above remains the alternative in open question 2.
   - When a skill is filtered, its resources are not registered either, and `skills/get` answers `-32602` (§6.4), so the view stays consistent.
8. **Digests are not trust.** They are unsigned and come from the same server as the content (SEP). Docs must not describe the feature as "verified" or "signed".
9. **Multi-tenant HTTP.** The catalog is identical for every caller apart from the role filter. There is no per-caller state, so nothing here resembles the shared-pseudonymizer issue (BRU-2515).
10. **Host obligations we cannot enforce, documented for operators:** origin tagging, per-skill approval, ignoring `allowed-tools`, cache isolation, cross-server read binding. Our contribution is not needing any of the risky ones (items 2, 3, 5).

### 6.12 Limits

The generator asserts the SEP bounds (≤512 files, ≤16 MiB per skill). It also warns on the tighter ChatGPT bounds (SKILL.md ≤256 KiB, file ≤1 MiB, skill ≤5 MiB, ≤100 files) so the catalog stays importable. The current maximum is 11,872 bytes in a single file.

### 6.13 One catalog for every surface: reconciliation with #355 (added 2026-09-18)

Issue #355 asks for the same 16 skills to be registered as MCP prompts. A draft spec and plan exist for it on a branch that had not been pushed as of 2026-09-18. The draft never mentions this design, and on 09-15 this design ruled its surface out (§6.10). The two proposals have to share everything below the wire. This section is written so that #355 can adopt it unchanged. It does not decide whether prompts ship; that is open question 8.

#### 6.13.1 What is shared and what is per-surface

| Concern | This design (09-15) | #355 draft | Reconciled |
| --- | --- | --- | --- |
| Generator | `scripts/generate-skills-catalog.ts` | `scripts/generate-prompts.ts` + `src/prompts/generate.ts` | **One**: `scripts/generate-skills-catalog.ts` → `src/skills/catalog.generated.ts`. The prompt module imports it and generates nothing of its own. |
| Parser | `yaml` | a line-split parser for "the narrow slice of YAML these files actually use" | **One**: `yaml` `parse` at its defaults (`strict`, `uniqueKeys`). BRU-2586's guard makes the same call, and conformance hosts use the same library. It stays a devDependency. |
| What the catalog stores | the file text plus the verbatim frontmatter object | projected fields: `name`, `title`, `description`, `audience`, `argumentNames`, `writeTools`, `body` | **Both.** The catalog holds the text and the whole parsed frontmatter object, plus the derived fields. Projections are computed *from* the frontmatter, never stored *instead of* it. Projecting drops `metadata`, and then verification fails for all 16 skills (§4.4b). |
| Prompt body | none | the markdown after the closing `---` | A slice of the stored text, found by an offset, so the body adds no bytes (§4.4c). |
| Per-skill metadata | none; the §6.11 allowlist permitted `metadata` if it was added deliberately | two namespaced `metadata` keys | **Adopt #355's two keys** under the contract in §6.13.2. |
| Tool references | `requiredTools` (Phase 2) | `writeTools` | **One derivation**, `referencedTools`: backticked identifiers matched against the complete 165-tool registry. `writeTools` is the `destructiveHint` subset. Unresolvable identifiers are ignored, as #355 §1.2 requires. The two derivations already agree (§4.4e). |
| Visibility | every named tool registered | declared audience via `ROLE_VISIBILITY` | **One rule for both surfaces** (§6.13.3). |
| Wire | `skills/*` plus `skill://` resources, opt-in | `prompts/*`, on by default | Stays per surface. Whether and when prompts ship is open question 8. |
| Packaging | embedded; `files` unchanged | embedded, plus `skills/` in `files` | Compatible. Shipping `skills/` does not depend on either surface. |

Some parts stay per-surface, and this design does not touch them:
- #355's own handlers, including its §1.1 finding that a declared `argsSchema` breaks a spec-legal `prompts/get`;
- the argument vocabulary;
- the prompt title;
- the `_meta` marking of write tools;
- the sentence appended to the prompt description.

None of these changes the catalog's shape or the bytes of any file.

#### 6.13.2 Frontmatter contract for both surfaces

The generator enforces every item below and fails the build on any violation. BRU-2586's guard (PR #357) already enforces items 1 and 3.

1. Exactly one leading `---` block, parsed with `yaml` `parse` at its defaults. Never loosen `strict` or `uniqueKeys`.
2. **No YAML comments** in the block.
   - An unquoted value containing ` #` starts a comment. The parser, and therefore every host, silently truncates the value at that point (§4.4a).
   - Detection: `parseDocument`, then a visit that checks every node's `comment` and `commentBefore`.
   - Measured: it catches all six placements I tried: inline ` #1`, a trailing ` # note`, a line of its own, inside `metadata`, after a metadata value, and before the first key.
   - It raises no false positive on a quoted `#` or on `issue#1`, and all 16 real skills pass.
3. `name` is a string equal to the directory name and follows the Agent Skills naming rules. `description` is a string of 1–1,024 characters.
4. The top-level keys are a subset of {`name`, `description`, `metadata`}. Adding `license` or `compatibility` requires a deliberate change to the allowlist. `allowed-tools` is never allowed (§6.11 item 2).
5. If `metadata` is present:
   - It is a map from string keys to **string** values, as the Agent Skills specification defines it.
   - Its keys are a subset of {`io.github.bruchris/canvas-lms-mcp-audience`, `io.github.bruchris/canvas-lms-mcp-arguments`}. The prefix matches `package.json#mcpName`.
   - No key starts with `io.modelcontextprotocol/`. SEP-2640 reserves that prefix, and conformance checks it as `sep-2640-metadata-reserved-prefix`.
   - The `-audience` value is a `ToolAudience`.
   - The `-arguments` value is a space-separated list of names from #355's closed argument vocabulary.
6. The catalog stores the parsed object verbatim, `metadata` included. The SEP-2640 entry *is* that object, and the prompt surface reads its projections from it.

Measured in §4.4b: with #355's keys exactly as its plan writes them, all 16 skills pass the SEP-2640 host comparison and the official conformance checks. The keys therefore survive the field-by-field comparison, **provided item 6 holds**.

Adding the keys changes each skill's bytes once, so each digest changes once. §6.8 already expects that for a real content change, and the keys are not version stamps.

Two open questions decide whether `-audience` must appear on every skill, as #355 drafts it, or only once something reads it: question 2 (the visibility rule) and question 8 (prompts). The contract holds either way.

#### 6.13.3 One visibility rule

With two rules over one catalog, the two surfaces of the same server would list different skills. §4.4e measures the gap: the rules agree in 10 of 16 configurations. In the other 6 they differ only on `canvas-office-hours` under `block`.

**Recommendation** (open question 2 keeps the choice):
- The **declared** audience decides visibility at runtime on both surfaces. It goes through `ROLE_VISIBILITY`, the same predicate tools use.
- The derived tool list becomes a **CI consistency check**, not a runtime filter. The check: with `destructiveTools: allow` and every opt-in flag on, each skill visible to a role must have all of its `referencedTools` registered for that role. It holds today in all 8 `allow` configurations.
- A skill tagged with the wrong audience therefore fails CI instead of silently changing the listing.
- Under `block`, `canvas-office-hours` stays listed. Its `delete_appointment_group` step fails with tool-not-found, which §6.11 item 6 already accepts as harmless.
- This supersedes the 09-15 Phase 2 runtime rule. Phase 2's `CANVAS_SKILLS` allowlist is unaffected.

Why declared rather than derived: a derived rule makes visibility depend on prose. Suppose a skill mentions a real tool in a warning, such as "do not call `delete_page` here". It would silently disappear for every role that lacks that tool. #355 §1.2 found 10 such warnings. All 10 name tools that do not exist, so none of them affects the rule today. Nothing stops the next one from naming a tool that does exist.

#### 6.13.4 Why compose instead of reject

This replaces the 09-15 §6.10 bullet. The 09-15 objection was that prompts would be "a third copy of the same text in a third format". That assumed a hand-maintained copy. Measured against a generated surface, the objection does not hold:

- **No new copy.** From one catalog, the prompt body is a slice of the text already embedded for the extension. It adds 0 bytes, where a second generated module would add about 96 KB per bundle format (§4.4c).
- **Different hosts.** Prompts reach 43 of 114 listed clients, including Claude Desktop, Cursor and VS Code, none of which support the extension. The extension reaches ChatGPT's importer, which lists no prompt support (§4.4d).
- **No interference.** Both surfaces install on one server in either order. `tools` stays at 163 and all 16 skills still verify (§4.4c).
- **Different invocation.** A prompt is chosen by the user. A SEP-2640 skill is discovered and activated by the host or the model. In a host that supports both (only fast-agent today) the workflow appears once in each place. That is not the duplicate-name problem in §5.1, where two origins serve the same *skill*.

The real cost that remains is review and wire surface, not content: a second set of handlers and a second capability to keep honest. That belongs in the product decision (open question 8), not in a structural objection.

#### 6.13.5 Sequencing

Whichever surface is scheduled first lands the shared generator, the catalog and the §6.13.2 contract. The other surface only consumes them. If the prompt surface goes first, those rows move out of Phase 1 into its PR, and Phase 1 shrinks to the extension itself.

In #355's draft plan, this replaces Tasks 1–2 (its parser and generator) with a consumer of `src/skills/catalog.generated.ts`. Tasks 3–5 are unaffected. That plan is not this document's to edit. The note on PR #353 and the cross-reference on #355 point here.

## 7. SDK 1.30.0 or SDK v2?

**Decision: land on 1.30.0. The standing SDK v2 gate is preserved; nothing here makes migration technically unavoidable.**

Evidence:

- **It works on v1 at the wire level** (§4): declaration on three transports, 16/16 digests verified, official conformance 30/30 + 5/5, and the control proves it is not vacuous.
- **The v1 hooks it needs are public and stable.** `Server.registerCapabilities` (merges before connect). `Protocol.setRequestHandler` accepts any method literal. `Server.assertRequestHandlerCapability` has no case for `skills/*`, so it does not throw.
- **v2 offers no helper yet.** #2818 is open on `main` (v2) and unreleased. `@modelcontextprotocol/server` is still `2.0.0` with **no 2.0.x patch**, so the SDK v2 Phase 1 gate in `docs/superpowers/plans/2026-07-28-mcp-sdk-v2-migration.md` ("A 2.0.x patch exists") remains **unmet** on 2026-09-15.
- **The migration cost stays contained.** Like `src/mcp-apps.ts`, `src/skills/extension.ts` is the only file that imports SDK internals for this feature. v2 changes `setRequestHandler` to `(method, {params, result}, handler)`, and #2818's `installSkills(server, {skills})` takes the same `{uri, frontmatter, resources}` entries. Phase 3 swaps our handler body for the SDK's, or keeps ours.

What v1 costs us: we write about 80 lines the SDK will eventually provide, and we must hand-validate params to get `-32602` (§6.9).

## 8. Phased implementation plan

### Phase 0: skill hygiene → BRU-2586, PR #357 (amended 2026-09-18)

Phase 0 was split out as BRU-2586 so that neither design review blocks it. On 2026-09-18, PR #357 (`fix/issue-2586-skill-yaml-frontmatter`) is **open and not merged**. It does three things:
- single-quotes the `canvas-admin-roster` description;
- adds `yaml` as a direct devDependency;
- adds `tests/skills/frontmatter.test.ts`, which checks for every skill that the frontmatter parses at `yaml` defaults, that `name` equals the directory name, and that `description` has 1–1,024 characters, plus an anti-vacuity count.

**Drop this phase once #357 merges.** The rest of the 09-15 Phase 0 is **not** in #357. It now belongs to the catalog generator, which validates all of it anyway. That generator ships in Phase 1, or in the prompt PR if that lands first (§6.13.5). The remainder:
- the key allowlist and the `metadata` contract (§6.13.2 items 4–5);
- no YAML comments (§6.13.2 item 2);
- `.md`-only files;
- UTF-8 without a BOM, LF line endings only;
- `.gitattributes` with `skills/** text eol=lf`. The repo has no `.gitattributes`, and an `autocrlf=true` Windows checkout would change the bytes, so the digests would disagree with CI.

### Phase 1: serve the extension, opt-in. Size M, 1 PR

| File | Change |
| --- | --- |
| `scripts/generate-skills-catalog.ts` (new), `package.json` script `generate:skills` | §6.1 and §6.13. This is the only generator over `skills/`. It enforces the §6.13.2 contract and the Phase 0 remainder. Confirm whether `tsconfig.json` includes `scripts/`; if not, keep the builder where typecheck sees it. If the prompt surface lands first, this row, the catalog row, `.gitattributes` and `tests/skills/catalog.test.ts` move to that PR (§6.13.5). |
| `src/skills/catalog.generated.ts` (new, generated) | §6.1 |
| `src/skills/extension.ts` (new) | `installSkillsExtension(server, catalog)`: resources + capability + handlers (§6.2–6.5, §6.9) |
| `src/server.ts` | `CanvasMCPServerConfig.enableSkillsExtension?: boolean`; call before return |
| `src/cli.ts` | `--enable-skills-extension` / `CANVAS_ENABLE_SKILLS_EXTENSION`, parsed like `enableAssignmentSubmission`. It is a read-only content surface, so the existing `isEnvTruthy` normalization is acceptable. |
| `src/stdio.ts`, `src/http.ts` | Pass the flag through (server config only; no per-request header) |
| `.gitattributes` (new) | `skills/** text eol=lf` (the Phase 0 remainder) and `src/skills/catalog.generated.ts linguist-generated` |
| `README.md`, `docs/educator-guide.md` | Env var row; README "Agent Skills" gains a short "Served over MCP (experimental, opt-in)" note. Keep plugin / `npx` first. |

Tests (all in CI; `pnpm test` runs before `pnpm build`, so no test may depend on `dist/`):

| File | Asserts |
| --- | --- |
| `tests/skills/catalog.test.ts` | Committed catalog equals regeneration from `skills/` (freshness); per entry: URI pattern, final segment == `frontmatter.name`, `digest` == sha256(file bytes), `size` == byte length, pinned with a non-ASCII fixture so `text.length` would fail; `frontmatter` deep-equals `yaml.parse`, **including `metadata`**; completeness against a temp fixture skill containing a `references/` file; limits. Contract (§6.13.2): each item has a fixture that must fail, including the comment placements and a quoted apostrophe that must decode to `'`. Consistency check (§6.13.3): with `allow` and every flag on, each skill visible to a role has all of its `referencedTools` registered for that role. |
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
| generator + catalog | Nothing new: `referencedTools` is already in the catalog from Phase 1 (§6.13.1) |
| `src/skills/extension.ts` | Serve by the one visibility rule (§6.13.3, open question 2). It is the same function the prompt surface uses, evaluated per instance and therefore per HTTP request and role. |
| `src/cli.ts`, `src/server.ts` | `CANVAS_SKILLS=<comma-separated names>` allowlist; unknown name → startup error; empty → error |
| tests | Visibility matrix from §4.4e as a table-driven test. If prompts have shipped, assert that both surfaces list the same set in every configuration. An allowlist of 5 → `skills/list` returns 5. |
| docs | "Publishing skills to a ChatGPT plugin": ≤5 via `CANVAS_SKILLS`, then run Scan Tools |

### Prompt surface (#355): phase not decided (added 2026-09-18)

This surface consumes the Phase 1 catalog (§6.13). Its design, handlers and tests belong to #355. Its order relative to Phases 1–2, and whether it is on by default, are open question 8. If it is scheduled before Phase 1, it carries the shared generator and the contract (§6.13.5).

### Phase 3: folded into the SDK v2 migration. No new trigger

- On the SDK v2 Phase 1 PR, retype `src/skills/extension.ts` against `@modelcontextprotocol/server`. Adopt #2818's `installSkills` if it is released.
- When 2026-07-28 is adopted (SDK plan Phase 2): add `ttlMs` + `cacheScope` (`private` if role-filtered, §6.8); `resultType` comes from the codec.

### Explicitly deferred

- `resources/directory/read`: no skill has supporting files; conformance skips it cleanly.
- `"dynamic"` skills and archives: archives were removed from the SEP.
- An `instructions` pointer.
- Default-on.

### Rollout

1. Phase 0 ships whenever ready. It is BRU-2586 / PR #357.
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
| Frontmatter drift re-breaks a skill | Proven once (1/16) | High under SEP (skill or whole import rejected) | BRU-2586's guard (#357) plus the §6.13.2 contract in the generator. The conformance sampling gap (§4.2) is why the guard has to be ours. |
| Two generators and two parsers ship, as #355's draft plan is written | Medium: a 1,519-line plan ready to execute exists | High under SEP: one silent parser disagreement is a verification failure (§4.4a–b) | §6.13; this amendment is linked from #355 and from PR #353 |
| One workflow appears as a prompt and as a skill in a host that supports both | Low: only fast-agent today | Low | The invocation modes differ (§6.13.4) |
| SEP-2640 evolves | Medium | Low | Changes arrive as capability flags or new ids per the Extensions overview *Evolution*; one module to update |
| Duplicate skills in hosts with plugin + MCP | Medium | Low | Not enabled in the plugin/MCPB manifests; documented |
| Generated catalog noise in diffs | High | Low | `linguist-generated`; freshness test |
| #2818 lands with a different shape | Low | Low | Only `src/skills/extension.ts` changes |

## 10. Open questions for CTO / board

1. **Default:** opt-in (recommended) or default-on for stdio?
2. **One listing rule under filters, shared by both surfaces** (amended 2026-09-18; §6.13.3, measured in §4.4e). The rules agree in 10 of 16 configurations and differ only on `canvas-office-hours` under `block`. Options:
   - the declared audience at runtime, with the derived tool list as a CI check. This is recommended, and `office-hours` stays listed under `block`.
   - "every named tool registered" at runtime. This was the 09-15 recommendation, and it hides `office-hours` under `block`.
   - no filtering.
   - "any named tool registered".
3. **ChatGPT plugin:** is a submission planned? If so, which ≤5 skills?
4. **Catalog embedding:** a committed generated TypeScript literal (recommended, §6.1) or a bundler text loader plus a committed index?
5. **Env var naming:** `CANVAS_ENABLE_SKILLS_EXTENSION` and, for Phase 2, `CANVAS_SKILLS`.
6. **Conformance-from-source:** run it as a nightly or manual workflow before an npm release includes #330?
7. **Phase 0 routing:** resolved. It went to the Developer agent as BRU-2586 / PR #357.
8. **Do MCP prompts (#355) ship, and in which phase?** (Added 2026-09-18.) This is a product call. The facts that bear on it:
   - **Reach:** 43 of 114 listed clients support prompts. The extension has 0 clients with full support and 3 with partial support (§4.4d).
   - **Cost after §6.13:** the handlers and their tests only. There is no new copy of the content and no second generator.
   - **Interaction with this design:** the order relative to Phase 1 decides who lands the generator (§6.13.5). Turning prompts on by default would add 16 prompts to every existing user's picker. That is the objection that made the extension opt-in (§0 item 3), and it applies to prompts as well.

   This design takes no position on the answer. It only requires that prompts, if they ship, consume the §6.13 catalog.

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
| Issue #355 and its draft spec and plan | `bruchris/canvas-lms-mcp#355`. The draft `docs/superpowers/specs/2026-09-18-issue-355-skills-as-mcp-prompts.md` and `docs/superpowers/plans/2026-09-18-skills-as-mcp-prompts.md` are on the unpushed branch `feat/issue-355-skills-as-mcp-prompts` @ `bf12c5c`. I read them with `git show` only. |
| Phase 0 split-out | BRU-2586, PR #357 (open on 2026-09-18) |
| MCP clients feature list (prompts) | `modelcontextprotocol/modelcontextprotocol` `docs/clients.mdx` @ `0dfb7b6`, the parent of `2075a21d03`, which deleted the page on 2026-05-27 |
| Extension client matrix, re-read | same repo `docs/extensions/client-matrix.mdx` @ `af68e21` (2026-09-08) |

## Appendix B: Reproducing the measurements

The probe scripts (`skills-probe.mjs`, `http-serve.mjs`, `visibility.mjs`) and raw outputs were kept in the run scratch directory and are not committed. Each step is described so it can be rebuilt in a few minutes.

1. Build this commit (`pnpm install --frozen-lockfile && pnpm build`). Put a script inside the worktree so that `@modelcontextprotocol/sdk` resolves from the lockfile. Import `createCanvasMCPServer` from `dist/server.js`, install the ~40-line handler from §4, and drive it with raw JSON-RPC over `InMemoryTransport`, a spawned stdio child, and a `node:http` server that builds one server per POST.
2. Conformance:
   `git clone https://github.com/modelcontextprotocol/conformance && npm ci && npm run build && node dist/index.js server --url http://127.0.0.1:<port>/mcp --scenario sep-2640-skills-enumeration --spec-version 2025-11-25 --force`
   Repeat for `-manifest` and `-directory`, and once serving only `canvas-admin-roster`.
3. YAML: parse each frontmatter block with `yaml`, `js-yaml` and PyYAML.
4. Reconciliation (§4.4, 2026-09-18). Extract `parseSkillFile`, the argument vocabulary and the metadata table from #355's draft plan by anchor text at runtime, transpile them with the repo's `typescript`, and apply the table to the 16 files. Then:
   - **(a) Parser agreement.** Compare the extracted parser field by field against `yaml` on the fixed + metadata variant, the unfixed + metadata variant, and seven single-line edits.
   - **(b) SEP-2640 round trip.** Serve the variants through the §4 prototype. Run the host replica and conformance exactly as in step 2, including both controls.
   - **(c) Composition.** Install a minimal `prompts/list` and `prompts/get` pair next to the extension, in both orders.
   - **(d) Client reach.** Count `supports="…Prompts…"` in `docs/clients.mdx` @ `0dfb7b6`.
   - **(e) Visibility.** Read `_registeredTools` from the factory across `role × destructiveTools × enableAssignmentSubmission`.
   - **Comment detection.** Run `parseDocument` plus `visit` over the frontmatter to check the §6.13.2 no-comments rule.
