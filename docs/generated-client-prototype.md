# Generated Canvas client — retired prototype

## What it was

This project briefly prototyped auto-generating the Canvas REST client from an
OpenAPI spec (see [GitHub issue #78](https://github.com/bruchris/canvas-lms-mcp/issues/78)).
The prototype wired `openapi-fetch` + `openapi-typescript` into a generated `users` module
and offered an opt-in `useGeneratedClient` flag on `CanvasClientConfig`.

## Why it was retired

After evaluation the team decided the maintenance overhead of keeping a generated
client in sync with Canvas's unofficial OpenAPI spec outweighed the benefits at
current project scale. The hand-written modules are simpler, have full test
coverage, and are easier to extend. See the decision thread for full reasoning.

## How to find the code

- **PR that landed the prototype:** [PR #79](https://github.com/bruchris/canvas-lms-mcp/pull/79)
  — contains `src/canvas/generated/`, `spec/canvas/`, `scripts/canvas-spec/`, and
  all wiring in `CanvasClientConfig` / `CanvasClient`.
- **Deletion commit:** the commit that opened the PR closing this document removed
  all prototype code from `main`.

If you want to revive this approach, start from
[PR #79](https://github.com/bruchris/canvas-lms-mcp/pull/79).
