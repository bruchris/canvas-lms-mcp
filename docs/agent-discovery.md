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

## MCP prompts

The 16 Agent Skills under `skills/` are also registered as MCP prompts, so a host can discover them
over the protocol instead of through a client-side skill loader. `skills/*/SKILL.md` stays the
single source of truth: `src/prompts/skills.generated.ts` is generated from it, and
`tests/prompts/generate.test.ts` fails when the two disagree.

Each skill declares its audience and its prompt arguments in `SKILL.md` frontmatter, under the
Agent Skills specification's optional `metadata` field:

```yaml
metadata:
  io.github.bruchris/canvas-lms-mcp-audience: educator
  io.github.bruchris/canvas-lms-mcp-arguments: course_id assignment_id
```

Argument names come from a closed vocabulary in `src/prompts/arguments.ts`; generation fails on a
name outside it. Every argument is optional, so a host may prefill what it knows and leave the rest
to the workflow's own questions.

The write tools a workflow reaches are derived from its body at generation time — never declared —
and published both in the prompt description and under
`_meta["io.github.bruchris/canvas-lms-mcp"]`. A body may safely name a tool that does not exist
("there is no `list_discussion_entries` tool"); identifiers that do not resolve are ignored.

Prompts follow the same role filter as tools, reading the same `ROLE_VISIBILITY` table and the same
visibility predicate, applied to each skill's own declared audience: `student` sees 2, `teacher` 13,
`admin` 14, and an unset role sees all 16. When a filter would leave none, the `prompts` capability
is not declared at all. The filter does not inspect the tools a workflow's body names, so a visible
workflow may still reach a tool the same role filter hides — `_meta` publishes the derived write
tools so a host can narrow further if it wants to.

### Adding your own prompts

The Canvas prompts are registered through `McpServer.registerPrompt`, so an in-process embedder can
add its own afterwards and both surfaces coexist:

```ts
const { server } = createCanvasMCPServer({ token, baseUrl })

server.registerPrompt(
  'my-workflow',
  { title: 'My Workflow', description: 'Something this deployment needs.' },
  () => ({ messages: [{ role: 'user', content: { type: 'text', text: '…' } }] }),
)
```

`prompts/list` then carries both, and `prompts/get` serves whichever was asked for. Two consequences
worth knowing:

- **Call `createCanvasMCPServer` first.** `registerAllPrompts` has to be the call that initialises
  the SDK's prompt handlers, so registering a prompt on a server *before* it throws, with a message
  saying so. Registering afterwards works whether or not a transport is already connected.
- **Canvas prompt names are reserved.** Reusing one is rejected by the SDK's registry rather than
  silently serving two prompts under one name.

Because the surface can change after construction, the server advertises
`prompts.listChanged: true`; the SDK emits `notifications/prompts/list_changed` when you add or
remove one.

Regenerate after changing any `SKILL.md`:

```bash
pnpm generate:prompts
```
