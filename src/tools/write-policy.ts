// Read-only startup control (GH #442 Phase 1, BRU-3128).
//
// `CANVAS_READ_ONLY` / `--read-only` exposes the write-tool policy that already
// existed for the OAuth profile (`writeTools: 'block'`, issue #302 §7.4) as a
// startup control an operator can set directly. It adds no new filtering
// mechanism: it only decides the value of an existing one.

import type { WriteToolsMode } from './types'

export interface WriteToolsSources {
  /**
   * The operator's read-only declaration (`CANVAS_READ_ONLY` / `--read-only`).
   * A floor, not a preference.
   */
  readOnly?: boolean
  /**
   * Whether the *caller's* credential carries write authority — the
   * `canvas:write` scope on the OAuth profile. `undefined` means the question
   * does not apply (static-token profiles, where the token's own Canvas
   * permissions are the only limit).
   */
  scopeAllowsWrite?: boolean
}

/**
 * Resolve the write-tool policy from the operator's read-only setting and the
 * caller's scopes.
 *
 * `block` wins from **either** source, and that asymmetry is the point: an
 * operator who started the server read-only must not have that widened by a
 * caller presenting a token that happens to carry `canvas:write`. This is
 * therefore additive to OAuth scope handling rather than a change to it — a
 * scope-blocked token still blocks exactly as before, and the only new way to
 * reach `block` is the operator asking for it.
 *
 * Returns `undefined` when neither source narrows anything, so the server
 * config key stays absent and the default (`allow`) is reached the same way it
 * is today rather than by passing an explicit value.
 */
export function resolveWriteToolsMode(sources: WriteToolsSources): WriteToolsMode | undefined {
  if (sources.readOnly === true) return 'block'
  if (sources.scopeAllowsWrite === false) return 'block'
  if (sources.scopeAllowsWrite === true) return 'allow'
  return undefined
}
