# Tool description standard

This standard exists because Glama's Tool Definition Quality (TDQS) scoring
flagged a consistent pattern in this repo: 80 of our 174 scored tools (v1.18.18
export) score below 3.5/5, averaging 3.08. Across all 174 scored tools,
**Purpose** averages 4.00 (never the problem) while **Usage Guidelines**
(2.11) and **Behavior** (2.38) are the gap. The strongest single predictor of
a high score is naming a registered sibling tool: the 29 descriptions that do
average 4.48, the 145 that don't average 3.44. None of the 80 low scorers
names a sibling.

The template and rules below are drawn from this repo's own top scorers
(`get_my_upcoming_assignments`, `set_student_quiz_accommodation`,
`check_course_setup`, `list_submissions_awaiting_grading`) rather than
invented from scratch — every example is grounded in a handler that actually
exists today. Do not describe behavior a handler doesn't implement; if you
can't confirm something from the code (or from the test Canvas instance at
canvas.fjordbyte.no), leave it out rather than guess.

## Template

Write the parts in this order and drop any that don't apply:

```
<Verb> <resource> <scope>[, returning <shape>].                       <- Purpose (+ return)
Use it to <job>; use <sibling_a> for <x> and <sibling_b> for <y>.      <- Usage Guidelines
<Behaviour that applies>: defaults Canvas applies, published/visibility,
idempotency, pagination, caps, fan-out/partial failure, what survives a delete.  <- Behavior
Requires <role/permission>.                                           <- Behavior/Completeness
<Only non-obvious parameter rules>: exclusive params, slug vs id, where an ID comes from.  <- Parameters
```

## Rules

S1 through S6 are the ones enforced by the CI ratchet (see below); S7-S9 are
reviewed by hand because they aren't mechanically checkable.

- **S1. Front-load the purpose.** The first sentence is verb + resource +
  scope, at most about 140 chars. Write "Create a new assignment in a
  course...", not "This tool...".
- **S2. Name at least one registered sibling tool by its exact name, with a
  routing reason.** For example, `check_course_setup` says "(see
  `list_students_needing_attention` / `get_missing_submissions` for those)",
  and `get_my_upcoming_assignments` says 'use `list_calendar_events` with
  `type="assignment"`'. Every tool-like snake_case name you write must resolve
  to a tool that is actually registered — don't invent one. (`create_new_quiz`
  once pointed at a non-existent `create_quiz`; there is no Classic-quiz
  creation tool, only `create_quiz` is absent from the registry.)
- **S3. Write tools** (`destructiveHint: true`) must state:
  - the return value, unless an `output` contract exists;
  - idempotency: whether a repeated create call makes a duplicate, or an
    update changes only the fields passed;
  - the published or visibility state left behind;
  - what is irreversible, the way `delete_module`'s description already does;
  - the required permission.
- **S4. List tools** must state pagination and what is *not* inlined. Use a
  sentence that matches `src/canvas/client.ts`'s `paginate()`: "Fetches every
  page (100 per request) and fails with a 'Results are incomplete' error
  instead of silently truncating."
- **S5. Get tools** must say where the ID comes from (name the list tool) and
  what `include` adds, if the endpoint accepts one.
- **S6. Length.** At least 150 chars for every tool, at least 200 for write
  tools, at most about 1,600 unless the tool fans out across many entities
  (e.g. `set_student_assignment_dates`, `project_grade`).
- **S7. Parameters.** Don't repeat schema `.describe()` text — it's already at
  100% coverage. Add only cross-field rules, slug-vs-ID distinctions, and
  where an ID comes from.
- **S8. Never guess Canvas behavior.** Verify anything the handler doesn't
  determine on the test Canvas instance before putting it in a description;
  if you can't verify it, leave it out.
- **S9. Keep annotations consistent with the prose.** If the description
  claims an update is idempotent, the tool should declare `idempotentHint:
  true` to match.
- **Process.** `docs/generated/tool-manifest.json` embeds every description.
  After editing a description, run `pnpm generate:manifests` — the committed
  JSON is checked against the live registry
  (`tests/discovery/manifests.test.ts`).

## CI ratchet

`tests/tools/description-quality.test.ts` mechanically checks S1, S2, S3's
permission/return clauses, S4 and S6 (rules R1-R5 in that file) against every
registered tool, across every role, feature flag and pseudonymizer
combination the server can register.

This repo shipped with the vast majority of its tools failing at least one of
these rules — rewriting all of them is a separate, larger effort (tracked
under the parent Glama-scoring issue), not this guardrail. So the check is a
**ratchet**, not a blanket gate:

- `tests/tools/description-quality.baseline.json` lists every tool that
  violates a rule **today**, with the specific rule codes it breaks, as of
  this baseline's creation.
- Any tool **not** in the baseline must pass every rule. A new tool, or an
  existing tool whose description regresses, fails CI immediately.
- Any tool **in** the baseline must still violate at least one rule. Once you
  rewrite a baselined tool's description so all rules pass, **remove its
  entry from the baseline in the same PR** — the baseline can only shrink,
  never grow back to cover a tool that's already fixed.

### Updating the baseline

- **Fixing a tool:** rewrite its description per the standard above, run
  `pnpm generate:manifests`, then delete that tool's entry from
  `tests/tools/description-quality.baseline.json`. If you don't, the "baseline
  entry now passes" test fails and tells you which entry to remove.
- **Adding a new tool:** write a description that passes every rule the first
  time — do not add the new tool to the baseline. The baseline documents
  pre-existing debt; it is not a way to ship new debt.
- **Adding a new rule:** regenerate the baseline by running the rule
  functions in `tests/tools/description-quality.test.ts` against
  `getAllTools()` for the full registered tool set (every feature flag on,
  pseudonymizer on with reverse lookup) and recording every tool that now
  violates something it didn't before. Do this in the same PR that adds the
  rule, since otherwise the new rule would retroactively fail every
  non-compliant existing tool at once.
