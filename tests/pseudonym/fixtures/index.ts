/**
 * The Phase 1 marked-name fixture registry (BRU-3146 §6.1).
 *
 * One entry per tool in `PSEUDONYMIZER_WRAPPED_TOOLS`. Phase 2 adds the
 * remaining tools and turns the derived set into the oracle; until then this
 * registry is checked *against* the hand list rather than replacing it, so a
 * fixture that forgets to mark anything cannot silently shrink the swept set
 * (§5.5).
 *
 * Keeping the fixtures here rather than as a list of names is what makes the
 * gate real: a name cannot be added to satisfy the completeness check without
 * also supplying the payload the sweep runs against.
 */
import type { MarkedNameFixture } from './sweep'
import { userFixtures } from './users'

export const MARKED_NAME_FIXTURES: Record<string, MarkedNameFixture> = {
  ...userFixtures,
}
