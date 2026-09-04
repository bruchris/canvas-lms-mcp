// Deployer policy gate for irreversible Canvas deletes.
//
// BRU-2444 — Phase 1 of the BRU-2390 design
// (`docs/superpowers/specs/2026-08-31-bru-2390-destructive-confirmation.md`).
//
// This is the only control in that design that offers a *hard* guarantee. Under
// `block` the seven irreversible delete tools are never registered, so the MCP
// dispatch table refuses the call before any handler exists to run. Everything
// else the design proposes — preview/confirm tokens, elicitation — is a nudge a
// confused or prompt-injected model can satisfy on its own within a single turn
// (design §1.1). The gate does not depend on model behaviour at all.

/**
 * Shipped modes. `confirm` is named by the design (§7) but its token machinery
 * is Phase 2+; it is deliberately absent from this union and rejected by the
 * parser rather than aliased onto a neighbour.
 */
export type DestructiveToolsMode = 'allow' | 'block'

/**
 * `allow` — today's behaviour, byte-for-byte — is the v1 default. Defaulting to
 * anything stricter would make a previously-working `delete_assignment` call
 * start failing, which is a breaking change and therefore 2.0.0 material
 * (design §7).
 */
export const DEFAULT_DESTRUCTIVE_TOOLS_MODE: DestructiveToolsMode = 'allow'

/**
 * The seven irreversible deletes gated by `block` (design §3).
 *
 * The boundary is *irreversible destruction of existing state*, not the
 * `destructiveHint` annotation (48 tools carry it) and not the `delete_` name
 * prefix on its own — `delete_peer_review` carries the prefix and is
 * deliberately excluded below.
 */
export const GATED_DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  // Removes the assignment *and* its submissions and gradebook column.
  'delete_assignment',
  // Quizzes.Next: destroys all items and student results.
  'delete_new_quiz',
  // One question plus its responses; re-authoring is manual.
  'delete_new_quiz_item',
  // Destroys the whole reply thread — student-authored content.
  'delete_discussion',
  // Page body and revision history; keyed by URL slug, not a numeric ID.
  'delete_page',
  // Global file ID with no course scoping in the call.
  'delete_file',
  // Cancels every reservation and emails every signed-up student.
  'delete_appointment_group',
])

/**
 * Delete tools deliberately left ungated, with the reason recorded here rather
 * than in a commit message.
 *
 * `delete_peer_review` is the only delete in the set whose effect this server
 * can itself undo — `create_peer_review` recreates the row and no authored
 * content is destroyed — and gating it would cost a round-trip on peer-review
 * reshuffling, which is inherently many-call work (design §3).
 *
 * The coverage guard in `tests/tools/destructive-gate.test.ts` fails if a
 * future `delete_*` tool lands in neither this set nor
 * `GATED_DESTRUCTIVE_TOOLS`, so tool #9 cannot arrive silently ungated.
 */
export const UNGATED_DELETE_TOOLS: ReadonlySet<string> = new Set(['delete_peer_review'])

/**
 * Modes the design names but this phase does not implement. Accepting one of
 * these as an alias for `allow` would silently permit exactly the deletes the
 * deployer asked to be confirmed, so they get their own loud error.
 */
const RESERVED_MODES: Readonly<Record<string, string>> = {
  confirm:
    'the preview/confirmation-token flow is not implemented yet (BRU-2390 Phase 2). Use `block` for a hard guarantee, or `allow` for the current behaviour.',
}

const SHIPPED_MODES: readonly DestructiveToolsMode[] = ['allow', 'block']

/**
 * Parse a raw mode string byte-exactly.
 *
 * No trimming, no case-folding, no truthiness — this is a kill switch, and
 * every normalisation step widens the set of strings that *accidentally* land
 * on a mode the deployer did not choose. The accident that matters is a
 * near-miss (`Block`, `block `, `blocked`) silently registering the deletes, so
 * anything unrecognised throws at startup instead of falling back to `allow`.
 * The offending value is echoed so a typo is self-diagnosing.
 *
 * @param raw    The configured value; `undefined` means unset, which is the
 *               documented default. An empty string is *not* unset — it is an
 *               explicit, unrecognised value and is rejected.
 * @param source Human-readable origin (`CANVAS_DESTRUCTIVE_TOOLS`,
 *               `--destructive-tools`, `destructiveTools`) so an env failure
 *               and a CLI failure are distinguishable in the error text.
 */
export function parseDestructiveToolsMode(
  raw: string | undefined,
  source: string,
): DestructiveToolsMode {
  if (raw === undefined) return DEFAULT_DESTRUCTIVE_TOOLS_MODE
  if (raw === 'allow' || raw === 'block') return raw

  const reserved = Object.prototype.hasOwnProperty.call(RESERVED_MODES, raw)
    ? RESERVED_MODES[raw]
    : undefined
  if (reserved !== undefined) {
    throw new Error(`${source}=${raw} is reserved but not implemented: ${reserved}`)
  }

  throw new Error(
    `Invalid ${source} value ${JSON.stringify(raw)}. ` +
      `Expected exactly one of: ${SHIPPED_MODES.join(', ')} (lowercase, no surrounding whitespace). ` +
      `Refusing to start rather than fall back to "${DEFAULT_DESTRUCTIVE_TOOLS_MODE}".`,
  )
}

/**
 * Resolve the effective mode from an explicitly configured value and the
 * environment, validating whichever one wins.
 *
 * The configured value is validated too. TypeScript stops `'Block'` at a
 * typed call site, but a plain-JS embedder is the real risk: an unvalidated
 * passthrough would be treated as "not `allow`"… or, worse, as "not `block`" by
 * a future comparison, and fail open.
 */
export function resolveDestructiveToolsMode(
  configured: string | undefined,
  envValue: string | undefined,
): DestructiveToolsMode {
  if (configured !== undefined) return parseDestructiveToolsMode(configured, 'destructiveTools')
  return parseDestructiveToolsMode(envValue, 'CANVAS_DESTRUCTIVE_TOOLS')
}

/**
 * Remove the gated tools unless the mode is exactly `allow`.
 *
 * Written as an allow-list check rather than `mode === 'block'` so that any
 * value reaching here without passing the parser — a cast, a corrupted config
 * object, a future mode added to the union but not to this filter — blocks
 * rather than permits. Failing closed is the only safe direction for a control
 * whose failure mode is an unrecoverable delete.
 */
export function applyDestructiveToolsPolicy<T extends { name: string }>(
  tools: readonly T[],
  mode: DestructiveToolsMode,
): T[] {
  if (mode === 'allow') return [...tools]
  return tools.filter((tool) => !GATED_DESTRUCTIVE_TOOLS.has(tool.name))
}
