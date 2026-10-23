# An independent oracle for pseudonymizer coverage

- **Issue:** BRU-3146 (found by the Lead Developer Tech Debt Scan, BRU-3144)
- **Date:** 2026-10-23
- **Baseline:** `773e0f6` (release 2.9.0), 187 tools in `docs/generated/tool-manifest.json`
- **Status:** design only. No behaviour change in this document's PR.
- **Supersedes nothing.** Extends `2026-05-25-ferpa-pseudonymization.md` § "Tools that
  surface student PII", whose hand audit is the artifact this replaces.

Every number below was executed against this baseline. The reproduction recipes are in
§10 and were run as written.

---

## 1. What the measurement says, before any design

### 1.1 The existing guard is vacuous against the entire failure class — proven, not argued

I restored all three October leaks at once (reverting only the handler half of `91e57e1`,
`159f758` and `9ab1fbb`, leaving the types, the `Pseudonymizer` methods and both hand lists
in place) and ran the guard that exists to catch them:

```
4 files changed, 15 insertions(+), 32 deletions(-)
$ npx vitest run tests/pseudonym/coverage.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Three live PII leaks on the tree, guard green. This is the strongest single fact in the
document: the guard is not weak at this, it is **blind** at this. Its two assertions are
"every listed name is registered" and "the two lists agree", and a missing wrap violates
neither.

### 1.2 Starting point 2 of the brief is dead: the types did not know either

The brief proposes deriving the expected set "from Canvas type references in the handler's
return path". I checked what `src/canvas/types.ts` said *before* each fix:

| Leak | Fix | Pre-fix type declared the leaked field? | A type-walk oracle retro-detects? |
|---|---|---|---|
| group `leader` | `91e57e1` (#449) | No — `CanvasGroup` stopped at four fields; the fix **added** `leader?: CanvasUserDisplay` | No |
| `assessor_name` | `159f758` (#471) | No — the fix **added** `assessor_name` and `CanvasRelatedGroupSubmissionAssessment` | No |
| conversation `participants` | `9ab1fbb` (#473) | Yes — `participants: Array<{ id: CanvasId; name: string }>` | Yes |

**1 of 3.** All three fix commits touch `src/canvas/types.ts`, which is the mechanical tell:
a type-reachability oracle is derived from an artifact that the same author edits in the same
commit as the wrap, so it inherits the author's blind spot by construction. It is the *second*
hand list wearing a compiler.

It is still worth having as a cheap tripwire (§6.3) — it would have caught #473 — but it
cannot be the oracle.

### 1.3 Starting point 1 of the brief has the wrong population, and the right machinery

`OUTPUT_FIXTURES` has **6** entries (`get_my_course_requirements`, `list_pages`, `get_page`,
`create_page`, `update_page`, `delete_page`) out of 185 registered tools, and
**every one of them is `pseudonymization: null`** — `pages` carries no student PII.

But the registry already declares `PseudonymizationModeFixture` with exactly the three
members this design needs (`buildCanvas`, `buildPseudonymizer(enabled)`,
`readPseudonymizedField`), with a comment saying it is "required for exactly that
intersection". The intersection is currently **empty**. The dual-mode on/off runner
(`callArmedWithPseudonymizer`) is written, tested-by-type, and has zero instances. So the
shape is right, the population is wrong, and the flag-on/flag-off idea is already blessed
in the repo — it was built for the structured-output migration and never reached a PII tool.

### 1.4 Starting point 3 — fail-closed by default — measured, and it is not an oracle

I built the maximally cheap author-independent oracle first, because if it works nothing
else matters: a **universal sentinel payload**. A `Proxy`-based `CanvasClient` answers every
method with a generated node carrying a sentinel at every name-shaped key (11 "tier 1" keys
that in Canvas are only ever a person — `sortable_name`, `short_name`, `full_name`,
`login_id`, `sis_user_id`, `pronouns`, `user_name`, `assessor_name`, `author_name`,
`grader_name`, `proxy_submitter`) plus "tier 2" positional keys (`name`, `display_name`,
`email`, `avatar_url`) under person containers. Sweep all 185 tools, flag on, assert no
sentinel survives.

Result:

```
tools: 185
control fired (sweep meaningful): 156
control never fired (needs a real fixture): 29
sentinel survived with flag ON: 156
```

**156 of 156.** Every tool whose output path the sentinel reached is red. The signal is zero.

This is not a bug in the probe, it is the answer to the question. The universal payload
plants `assessor_name` on a course and `sortable_name` on a syllabus — fields Canvas never
sends there — so it measures "would this tool pass through an arbitrary name-shaped field",
and the answer for a pass-through handler is always yes. The two readings are exactly the
two halves of starting point 3:

- **As an oracle it is dead.** 100% false-positive rate, no discrimination, nothing a
  reviewer could act on.
- **As a price tag it is the answer.** A fail-closed-by-default deep scrub — "rewrite any
  PII-keyed value anywhere in any response" — changes the output of **156 tools**, and
  cannot distinguish a group's own `name` from a person's `name` (the group fixture in §4
  has both). Fail-closed-by-default is therefore not a cheap drop-in replacement for
  enumeration; it is a semantics change with a 156-tool blast radius. It is also plausibly
  a board item (B2 touches pseudonymization semantics in either direction) — §9, Q4.

The narrow, already-shipped form of fail-closed stays correct and stays recommended:
`list_sections` (BRU-3129) wraps a payload that carries no names *today*, so that widening
the include cannot leak silently. That is per-tool fail-closed, and §6.2 makes it the
default for new tools.

### 1.5 What is irreducible

The three leaks share one shape: **Canvas sends a name on an endpoint, at a key nobody in
this repo knew about.** No artifact inside this repo knows that fact. The types did not
(§1.2), the hand lists did not (§1.1), and a generic payload cannot (§1.4).

The one place it is written down is **Canvas's own serializer**, and — notably — all three
fixes cite it by file and line in their own comments: `lib/api/v1/group.rb`'s
`hash["leader"] = user_display_json(...)`, `RubricAssessment#assessor_name`,
`conversation_user_json`'s `name`/`full_name` split.

So the design's job is not to *compute* the expected set. It is to make that citation
**executable**: move the one authored input from a judgement ("is this tool PII-bearing?",
which three authors got wrong) to a fact ("what keys does this endpoint emit?", which is
citable, reviewable, and which all three authors got right as soon as they looked).

---

## 2. The design: marked-name fixtures and a repo-wide negative sweep

### 2.1 The mechanism

One fixture per registered tool. Each fixture is a Canvas response payload, and **every
string in it that is a real person's name is written as `REAL_NAME_<n>`**. Nothing else in
the fixture may match that pattern.

The oracle is then two assertions per tool, with no per-tool configuration at all:

```
flag OFF  →  at least one REAL_NAME_<n> appears in the handler's return value   (control)
flag ON   →  no REAL_NAME_<n> appears in the handler's return value             (assertion)
```

A fixture with no marks is a tool that is not PII-bearing: its control does not fire, and the
oracle records it as *outside* the swept set rather than passing it.

Three properties follow, and they are the whole point:

1. **No judgement is asked of the author.** The author never answers "does this tool surface
   PII". They write the payload Canvas sends and mark the names in it. The *set* of
   PII-bearing tools is then computed as `{ tool | its fixture contains a mark }`.
2. **The control is automatic and per-tool.** A fixture whose marks never reach the output
   cannot pass silently (§5.1) — the standing failure mode where a guard's traversal finds
   nothing and reports clean.
3. **Both hand lists die.** `PSEUDONYMIZER_WRAPPED_TOOLS` and the test's
   `EXPECTED_PII_BEARING_TOOLS` mirror are replaced by the derived set. See §6.1 for what
   `coverage.ts` keeps (it still has one job).

### 2.2 Why `REAL_NAME_<n>` rather than a declared list of PII values

A fixture could instead carry `piiValues: ['Jamie Student', ...]` and the sweep assert those
are absent. That re-introduces an authored judgement at the value level — the author decides
which of their own strings count — and it is the judgement that has failed three times.

A syntactic mark cannot be forgotten *selectively*: either the string is marked and the
oracle tracks it, or it is an ordinary string and the fixture does not claim it is a name.
The remaining authoring error is omitting a key entirely, which §7 addresses and does not
pretend to solve.

A marked name is also a better fixture. The existing suite asserts on literals like
`'Alice Johnson'`, and a reviewer cannot tell by looking whether a given string is a person,
a group or a file. `REAL_NAME_3` says so.

### 2.3 Where the sweep taps the response

`tool.handler(params)` directly. `src/tools/index.ts` wraps each handler as
`JSON.stringify(await tool.handler(params), null, 2)` into the text content, and the
structured-output envelope is derived from the same value, so the handler's return value *is*
what a client receives. Tapping the handler keeps the sweep at ~4 ms per call (§8) and
avoids 185 MCP server registrations.

This deviates from the standing rule that a wire-level claim needs a real `Client` with
`listTools()` called first. That rule is about *input* validation and *output schema*
arming, neither of which this oracle asserts. §9 Q3 asks whether the CTO wants a thinner
wire-level spot-check alongside it anyway.

---

## 3. The population the sweep must enumerate

`getAllTools` returns a different set per configuration, and a sweep built from the default
is blind to three tools:

```
getAllTools(canvas)                                      → 185
getAllTools(canvas, pseudonymizer)                       → 186   extra: resolve_pseudonym
getAllTools(canvas, pseudonymizer, undefined,
            { assignmentSubmission: true })              → 188   extra: upload_submission_file, submit_assignment
```

Reconciling against the manifest's 187: `187 = 185 + upload_submission_file +
submit_assignment`; `resolve_pseudonym` is env-gated and is not in the manifest.

The two `assignmentSubmission` tools are the ones that matter here — they carry student
submission payloads — and they are **absent from the default registry**, so the completeness
gate must iterate the configuration matrix, not one factory call. A count floor on the
default config alone would read as 185/185 complete while two submission tools were
unswept. This is the same hole that let a prior schema guard miss 2 of 165 tools.

---

## 4. Evidence: the oracle goes red on the leaks we shipped

Four faithful fixtures, keys placed from the Canvas serializers cited in §1.5, names marked.
The group fixture deliberately carries the group's **own** `name: 'Fjord Study Group'`
*unmarked* alongside a marked `leader.display_name`, so a scrub that cannot tell a group from
a person fails the fixture rather than passing it.

**Post-fix tree (`773e0f6`), expected green:**

```
list_groups                     control=2   CLEAN
list_appointment_group_groups   control=2   CLEAN
submit_rubric_assessment        control=2   CLEAN
send_conversation               control=5   CLEAN
```

Non-zero controls on all four: the oracle is armed, not merely silent.

**Each leak restored in turn (handler half only), one injection per run:**

| Injection | `list_groups` | `list_appointment_group_groups` | `submit_rubric_assessment` | `send_conversation` |
|---|---|---|---|---|
| revert `91e57e1` handlers | **LEAK** `1,2` | **LEAK** `1,2` | CLEAN | CLEAN |
| revert `159f758` handler | CLEAN | CLEAN | **LEAK** `3,4` | CLEAN |
| revert `9ab1fbb` handler | CLEAN | CLEAN | CLEAN | **LEAK** `5,6,7,8,9` |

**3 of 3 retro-detected** (the brief asked for 2), with **one-to-one attribution**: each
injection reddens exactly its own tools and leaves every other case clean and still armed.
The disjointness is the load-bearing part, not the red — it shows each tool's assertion is
independently guarded rather than one broad check shadowing the rest.

Two details worth reading off the table:

- `91e57e1` reddens **two** tools from one fixture. The leak was one Canvas payload reached
  by two read paths, and the oracle finds both because the fixture is per-payload, not
  per-reviewer-attention.
- `send_conversation` surfaces **5** marks, including `full_name` and `pronouns` — fields the
  pre-fix type did not admit at all. A test written against the pre-fix type could not have
  asserted on them; a fixture written from `conversation_user_json` can.

Contrast with §1.1: the shipped guard is green on all three of these injections *combined*.

---

## 5. Anti-vacuity: what makes each check non-vacuous, and how a reviewer checks

Each item is a *mechanism* plus the *injection* that proves it is load-bearing.

### 5.1 The per-tool control (the sweep itself)

- **Mechanism:** the flag-off run must surface ≥1 mark before the flag-on assertion is
  allowed to pass. A fixture whose marks never reach the output is reported as
  `VACUOUS (control never fired)` and fails the completeness gate, not the sweep.
- **Verify by injection:** replace a fixture's `buildCanvas` with one returning `[]`. The
  tool must move from `CLEAN` to `VACUOUS`, not to `CLEAN`. The probe already distinguishes
  these three verdicts (`CLEAN` / `VACUOUS` / `LEAK`) and reported `control=N` on every row
  in §4.

### 5.2 Two count floors, asserted separately

A single floor over the union is not attributable — re-narrowing the sweep fails the total
and the new coverage is never shown to be load-bearing. So:

- `sweptTools >= 185` (every tool in the configuration matrix of §3 has a fixture), and
- `markedTools >= 35` (at least as many PII-bearing tools as the hand list knows today).

**Verify by injection:** delete one fixture → the first floor names the missing tool. Strip
the marks from one PII fixture → the second floor fires while the first stays green. Both
must give one failure each, in different tests.

### 5.3 The configuration matrix

- **Mechanism:** the completeness gate iterates the §3 matrix and unions the names.
- **Verify by injection:** drop the `assignmentSubmission: true` row → the gate must report
  `upload_submission_file` and `submit_assignment` as unswept. If it stays green, the gate
  is reading one factory call and §3 has already shown that is 185 of 188.

### 5.4 The no-stray-marks rule

- **Mechanism:** a lint test asserts that `REAL_NAME_` appears in fixtures **only** as a
  value, never in a key, a comment or a non-person field, and that every mark index is
  unique within a fixture.
- **Why:** without it the pattern can be smuggled into a field that is *not* a name, which
  would make the flag-on assertion fail for a correct implementation — a false positive is
  how a guard gets relaxed.

### 5.5 The derived-set regression

- **Mechanism:** during migration only (§6.1 phase 2), assert
  `derivedPiiBearingSet ⊇ PSEUDONYMIZER_WRAPPED_TOOLS`.
- **Why:** it catches "the new fixture for a known-PII tool forgot to mark anything", which
  would silently shrink the swept set. It is deleted with the hand list at the end of
  migration, and §9 Q2 asks whether the CTO wants it kept permanently instead.

---

## 6. What changes in the repo

### 6.1 Three phases, each independently shippable

**Phase 1 — the sweep, over the tools that already have marks (no contributor contract
change).** Add `tests/pseudonym/fixtures/` with the registry type, the sweep, the three
verdicts, and fixtures for the 35 tools currently in `PSEUDONYMIZER_WRAPPED_TOOLS`. Keep
both hand lists. At the end of this phase every known-PII tool is swept, the §5.5 regression
holds, and the three October leaks are caught. This is the phase that pays for itself.

**Phase 2 — completeness.** Fixtures for the remaining 150. Turn on the §5.2 floors and the
§5.3 matrix. Derive the PII-bearing set from the marks. Delete
`EXPECTED_PII_BEARING_TOOLS` from the test and reduce `coverage.ts` to its one remaining
job: nothing. (It has no remaining job — the "every listed name is registered" assertion is
subsumed by the completeness gate, which iterates the registry itself. Phase 2 deletes the
file.)

**Phase 3 — the citation requirement.** Each PII-bearing fixture carries a
`canvasSource: 'lib/api/v1/group.rb#group_json → user_display_json'` string, and a test
asserts it is non-empty for every fixture with marks. This is §7's partial answer and the
only part that asks anything new of a reviewer.

### 6.2 What a tool author has to do differently

Today, CLAUDE.md step 6 asks the author to recognise "a `CanvasUser`, a participants array,
or a `user_name` field" — three patterns that, measured, missed `display_name`,
`assessor_name`, `full_name` and a naked `proxy_submitter` string. After Phase 2 the ask
becomes:

1. Add a fixture with the payload the endpoint returns. **Read the serializer**, not our
   types — `src/canvas/types.ts` was wrong about this three times in four days.
2. Mark every person name in it `REAL_NAME_<n>`.
3. Run the suite. If a mark survives, wrap the tool.

Step 3 replaces the judgement with a failing test, which is the entire delta. The author can
still omit a key (§7), but they can no longer *reason wrongly* about a key they did write
down, and they no longer have to decide whether their tool is "PII-bearing".

Fail-closed becomes the default for the write paths too: a new tool wraps unless its fixture
demonstrably carries no names, following `list_sections` (BRU-3129).

### 6.3 Keep the type-walk as a tripwire, labelled as one

§1.2 showed a type-reachability check retro-detects 1 of 3, which is not an oracle but is not
zero either, and it is cheap: walk `src/canvas/types.ts` for a declared person-name key
reachable from a type a tool returns, and require that tool to be in the derived set. It
would have caught #473 at no fixture cost. It must be labelled in its own test as a
tripwire that the sweep does not depend on — otherwise a future reader treats it as the
coverage guarantee, which is how we got here.

---

## 7. The residual hole, stated plainly

**The fixture is still authored.** An author who does not know Canvas emits `display_name`
on a group leader can write a fixture without it, and the sweep will pass. The design does
not close this. What it changes:

| | Before | After |
|---|---|---|
| The authored input | "Is this tool PII-bearing?" | "What keys does this endpoint emit?" |
| Kind of claim | A judgement about a category | A fact about an HTTP response |
| Reviewable against | Nothing (it *is* the oracle) | Canvas's serializer source |
| Observed error rate | 3 misses in 4 days | — |

Everyone who looked at the serializer got the answer right immediately; all three fixes
quote the exact line. The hole is "did you look", not "did you judge correctly", and §6.3's
`canvasSource` citation makes "did you look" visible to a reviewer for the first time.

Two things that would close it further and are **not** proposed here, with reasons:

- **Generate fixtures from `instructure/canvas-lms`.** Parsing `lib/api/v1/*.rb` for the keys
  each serializer emits is buildable and would make the fixture derived rather than authored.
  It is also a new subsystem pinned to an upstream SHA, and it should be judged on its own
  once Phase 1 has demonstrated the sweep's value. Filed as a follow-up candidate, not a
  dependency.
- **Record real Canvas responses.** The only source that cannot be wrong. The repo's rule is
  that tests never hit a real Canvas instance, and recorded payloads of real students are a
  FERPA artifact in the repository. Declined.

---

## 8. Cost

**Suite wall time.** Measured: 740 handler invocations (185 tools × 2 payload shapes × 2 flag
states) completed in **3.13 s** of vitest test time — ~4.2 ms per call. The real oracle is
185 × 2 = 370 calls, so **~1.6 s**, against a current full suite of ~30 s. Negligible. The
`Pseudonymizer` writes its map to a temp `rootDir` per run; no real state is touched.

**Fixture count.** 185 (Phase 1: 35; Phase 2: the remaining 150).

**Fixture cost, measured rather than estimated.** Every one of the 187 manifest tools is
already named in a non-registry-sweep test file — all 187, with 0 named only in sweep files.
So a Canvas response mock exists for every tool somewhere in 197 test files / 57,484 lines.
Phase 2 is **re-pointing existing mocks at a shared registry and marking the name values**,
not inventing 150 payloads from nothing. The four fixtures in §4 took about 15 lines each
including their serializer citations.

That is the honest upper bound and it is still real work: 150 fixtures at ~15 lines is a
~2,300-line mechanical PR, and it is the kind of change that should be split by domain.
The brief asks whether the answer is "every new tool needs a fixture". **It is**, and after
Phase 2 that is enforced by a count floor rather than by a reviewer noticing.

**What it buys.** The three October leaks, the five earlier ones of the same class
(BRU-2863, BRU-2864, BRU-2865, BRU-3123, BRU-3126), and — the part no hand list can offer —
the next one, at a key nobody has thought of yet, provided the fixture carries it.

---

## 9. Open questions (CTO's call, not the design's)

1. **Phase 2 scope and sequencing.** 150 fixtures is a large mechanical diff over files that
   open PRs touch. Split by tool domain (~14 PRs), by audience, or one batch? My
   recommendation: by domain, in the order of §6.1 phase 1's leftovers, so each PR is
   reviewable against one serializer.
2. **Keep the §5.5 derived-set regression after migration?** Deleting it removes the only
   check that a *known*-PII tool's fixture still marks something. Keeping it keeps a
   35-name hand list alive forever. My recommendation: keep it, renamed to make clear it is
   a historical floor rather than an oracle, and never extend it.
3. **Wire-level spot-check alongside the handler-level sweep?** §2.3 taps the handler. A
   thin additional case per PII domain through a real armed `Client` would cover the
   structured-output envelope path. My recommendation: one per domain, not per tool.
4. **Fail-closed-by-default as behaviour** (as opposed to as an oracle, which §1.4 kills).
   A generic deep scrub changes 156 tools' output and cannot distinguish a group's name
   from a person's. This touches pseudonymization semantics, so it is plausibly board item
   B2 and is explicitly out of this document's scope. My recommendation: do not pursue;
   keep per-tool fail-closed (§6.2).
5. **The CLAUDE.md step-6 contract.** §6.2 rewrites a contributor-facing rule, which this
   design should not land unilaterally. The specific change: delete the three trigger
   patterns (which are the measured blind spot) and replace them with "add a fixture, mark
   the names, run the suite".
6. **Does `coverage.ts` get deleted or emptied?** §6.1 phase 2 concludes it has no remaining
   job. Deleting a file named in the FERPA spec and in CLAUDE.md is a docs change in three
   places; confirm that is wanted rather than keeping a one-line re-export.

---

## 10. Reproduction

Every command below was run as written at `773e0f6`. The two probe files live in the
BRU-3146 run scratch directory and are not committed; §4's fixtures are reproduced inline
in the probe.

**§1.1 — the shipped guard is vacuous.**

```bash
git show 91e57e1 -- src/tools/groups.ts src/tools/appointment-groups.ts | git apply -R
git show 159f758 -- src/tools/rubrics.ts     | git apply -R
git show 9ab1fbb -- src/tools/conversations.ts | git apply -R
git diff --stat | tail -1          # => 4 files changed, 15 insertions(+), 32 deletions(-)
npx vitest run tests/pseudonym/coverage.test.ts   # => Tests 3 passed (3)
git checkout -- src/tools/
```

**§1.2 — what the types knew.** The discriminating evidence is a **removed** line, not an
added one: a pre-fix type that already declared the name shows the field on a `-` line.

```bash
for s in 91e57e1 159f758 9ab1fbb; do
  echo "## $s"; git show $s -- src/canvas/types.ts | grep -E '^-[^-]'
done
```

Only `9ab1fbb` emits anything — `-  participants: Array<{ id: CanvasId; name: string }>`. The
other two produce no output at all, which is the 2-of-3 "the type did not know" result.
Control: run the same loop with `grep -E '^\+[^+]'` and all three emit lines, so an empty
result above is a fact about the commit and not a broken pattern.

**§1.3 — fixture population.**

```bash
grep -n 'pseudonymization:' tests/tools/fixtures/output-fixtures.ts
```

Seven matches: one is the `PseudonymizationModeFixture | null` member of the `OutputFixture`
interface, and the other six are `pseudonymization: null` on each registry entry
(`get_my_course_requirements`, `list_pages`, `get_page`, `create_page`, `update_page`,
`delete_page`). Zero non-null values. Do **not**
shorten this to `grep -c 'pseudonymization: [^n]'` — that returns **1**, matching the type
declaration, which reads as "one fixture has pseudonymization coverage" when none does.

**§3 — the configuration matrix.** `getAllTools(c)` / `(c, p)` / `(c, p, undefined, {
assignmentSubmission: true })` → 185 / 186 / 188. Note `console.error` is swallowed by
vitest here even on pass; write results to a file and read the file.

**§4 — the retro-detection table.** For each of the three fixes: `git show <sha> -- <tool
files> | git apply -R`, run the marked-name probe, record the verdict per case,
`git checkout -- <tool files>`. The control is the post-fix run: all four `CLEAN` with
`control > 0`. A run in which any control is 0 is a measurement of the probe, not of the
tree.

**§1.4 — the universal-sentinel sweep.** 185 tools × {array, object} payload shapes ×
{flag on, flag off} → `control fired 156`, `survived 156`, `not reached 29`.

Two traps that cost real time and would mislead anyone repeating this:

- The first run of the universal sweep **exited 0 while the vitest worker had died of memory
  exhaustion** (`Worker exited unexpectedly`, `Tests (1)` with no pass/fail). An exit code is
  a claim about the process, never about the work — read the summary block. The cause was a
  depth-3 recursive payload with ~46 keys per node; depth 2 with trimmed key lists, a cached
  `Proxy` fallback, and a cycle-safe graph walk instead of `JSON.stringify` + regex brought
  the same sweep to 6.1 s.
- `Pseudonymizer` takes `rootDir`, not `stateRoot`. A wrong option name is silently ignored
  and the probe writes to the real user state directory, which both pollutes live state and
  makes pseudonym numbering jump in a way that looks like a bug in the code under test.
