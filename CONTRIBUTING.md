# Contributing to canvas-lms-mcp

Thanks for contributing to `canvas-lms-mcp`.

This project ships a Canvas LMS MCP server, a standalone Canvas API client, and the transport layers that expose both to AI clients. Keep changes narrow, tested, and aligned with the existing three-layer architecture.

## Before You Start

- Use Node.js 22 or newer.
- Use `pnpm`.
- Read [AGENTS.md](./AGENTS.md) if you are contributing with an AI agent or making larger changes to the repo.
- Check open pull requests before starting work so you do not overlap an active change.

## Local Setup

```bash
pnpm install
pnpm dev
```

## Development Workflow

1. Fork the repository and create a topic branch from `main`.
2. Keep changes scoped to one concern.
3. Follow the existing module boundaries:
   - `src/canvas/` for the standalone Canvas REST client
   - `src/tools/` for MCP tool definitions
   - transport and server entry points in `src/server.ts`, `src/stdio.ts`, and `src/http.ts`
4. Add or update tests for behavior changes.
5. Run validation before opening a pull request.

## Validation

Run the full validation set locally before opening or updating a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests must use mocked Canvas API responses. Do not point tests at a live Canvas instance.

## Coding Guidelines

- Use TypeScript and native `fetch`; do not add a separate HTTP client library.
- Preserve the separation between the Canvas client and MCP tool layers.
- Prefer small, typed helpers over unstructured objects.
- Keep error messages user-facing and consistent with existing tool behavior.
- Add new tools with plain-verb names and Zod input schemas.

## Adding or Changing Tools

When adding a new Canvas capability:

1. Implement or extend the Canvas client module in `src/canvas/`.
2. Register the module on the `CanvasClient` facade.
3. Add MCP tool definitions in `src/tools/`.
4. Register the tools in `src/tools/index.ts`.
5. Add tests covering success cases, errors, and pagination when relevant.

If you add, remove, rename, or reclassify tools or workflow catalog entries, regenerate the
agent-discovery artifacts before opening the PR:

```bash
pnpm generate:manifests
```

The committed files in `docs/generated/` are expected to stay in sync with the live registry.

## Pull Requests

- Use a clear title and explain the user-facing impact.
- Link the related issue when one exists.
- Mention any follow-up work or known limitations.
- Keep release/versioning changes out of unrelated PRs.

## Commit Format

Use conventional commits:

- `feat: add analytics enrollment filters`
- `fix: handle empty pagination links`
- `docs: document HTTP deployment`
- `test: cover assignment error formatting`

## Security and Secrets

- Never commit Canvas API tokens or other secrets.
- Use environment variables for local credentials.
- Avoid including private Canvas data in tests, fixtures, screenshots, or PR descriptions.
