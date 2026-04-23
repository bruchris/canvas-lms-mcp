# Canvas OpenAPI spec pipeline (prototype)

This directory contains the scoped prototype for the generated-client pipeline
proposed in GitHub issue [#78](https://github.com/bruchris/canvas-lms-mcp/issues/78).

## What this is

A license-clean, end-to-end demonstration of:

1. A source OpenAPI 3.1 spec fragment
2. An overlay layer that patches known issues (tightens response shapes,
   adds enum values, fixes field types) without editing the source
3. A merge step that composes source + overlays into a single bundled spec
4. Type generation with `openapi-typescript`
5. A runtime client layer built on `openapi-fetch`

Right now the pipeline covers **one domain only (`users`)**. The goal is to
prove the plumbing works and surface the real costs and constraints before
the licensing decision and before fanning out to every Canvas domain.

## What this is NOT

- NOT the Canvas-derived OpenAPI output from `rake doc:openapi`. Canvas LMS
  is AGPL-3.0 licensed. Vendoring AGPL-derived specs or generated output
  into this MIT repo needs an explicit licensing decision (see issue #78,
  "License — this needs a decision, not a default"). The prototype spec
  here is **hand-authored from public Canvas API docs**, so the pipeline
  itself doesn't depend on any licensing outcome — it will work equally
  well once a license-clean full spec source is chosen.
- NOT the final spec source. When the license path is decided, the source
  file is expected to be replaced with whatever the chosen upstream
  produces (Canvas rake output, community spec, etc.), and the overlays
  remain in place on top of it.

## Files

```
spec/canvas/
  README.md              -- this file
  prototype.yaml         -- hand-authored OpenAPI 3.1 for users endpoints
  overrides/
    users.yaml           -- overlay patches demonstrating the pattern
```

## Pipeline scripts

From the repo root:

```
pnpm canvas:spec:generate
```

runs `scripts/canvas-spec/generate.ts`, which:

1. Reads `spec/canvas/prototype.yaml`
2. Applies overlays from `spec/canvas/overrides/*.yaml`
3. Runs `openapi-typescript` against the merged spec
4. Writes the result to `src/canvas/generated/types.ts`

The generated file is checked in with a `// GENERATED` banner. It stays
license-clean because it's derived from the hand-authored prototype spec.

## Overlay pattern

`overrides/users.yaml` demonstrates the two kinds of patches the full
migration will need (see issue #78, "Patch strategy — overlays beat
post-gen codemods"):

- **Narrow an enum.** `CourseUserInclude` in the source spec might be a
  subset of what Canvas actually accepts; the overlay adds the missing
  values without touching the source.
- **Tighten a response shape.** Works around
  [instructure/canvas-lms#2583](https://github.com/instructure/canvas-lms/issues/2583)
  where the Canvas-emitted spec returns `unknown`/`object` instead of
  typed shapes for many endpoints.

The merge is a simple deep-merge in the generation script — no Redocly
dependency needed at this scale. When the migration fans out to more
domains, switching to `@redocly/cli bundle` is a one-script change.

## What's not in the spec (stays hand-written)

Per issue #78:

- **Link-header pagination.** OpenAPI can't express it. The generated
  users client uses the same Link-header loop as the hand-written client.
- **`include[]`-conditional response shapes.** OpenAPI can't express "if
  `include[]` contains X, field Y appears." The generated client exposes
  everything the overlay types; narrowing happens at the tool layer if
  needed.
- **Bearer auth injection.** One line of middleware, not a spec concern.
