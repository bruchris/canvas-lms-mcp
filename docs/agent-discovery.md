# Agent Discovery Manifests

`canvas-lms-mcp` ships generated discovery artifacts for agent tooling under `docs/generated/`:

- `tool-manifest.json` describes the registered MCP tool surface.
- `workflow-manifest.json` describes workflow catalog entries that link back to related tools.

Workflow packs live under `docs/workflows/` and are referenced from the workflow manifest via each
entry's `documentationPath`.

Current workflow packs:

- `educator-assignment-review` → [Educator Assignment Review](workflows/educator-assignment-review.md)
- `student-weekly-planning` → [Student Weekly Planning](workflows/student-weekly-planning.md)

These files are generated from the live tool registry and the in-repo workflow catalog source.

## Regenerating

Run:

```bash
pnpm generate:manifests
```

Regenerate whenever you add, remove, rename, or reclassify a tool, or when you change the
workflow catalog.
