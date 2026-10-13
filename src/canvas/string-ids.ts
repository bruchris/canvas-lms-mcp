/**
 * Opt-in Canvas string-ID response negotiation.
 *
 * Phase 2, PR 2b of the 64-bit identifier design
 * (`docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md`
 * §5 / §8, BRU-2730 / BRU-2851), landing strictly after PR 2a's unconditional
 * `normalizeCanvasIds()`.
 *
 * ## What the header buys, and what it cannot
 *
 * `response.json()` is `JSON.parse`, so a Canvas ID above `Number.MAX_SAFE_INTEGER`
 * is already rounded before any code of ours runs: the shard-901 id
 * `9010000000000001` arrives as `9010000000000000`. No amount of normalization
 * recovers a digit that never arrived. Asking Canvas to render identifiers as
 * JSON **strings** is the only fix, and this header is how you ask.
 *
 * It is best-effort on purpose. `ApplicationController#render` applies
 * `json_cast` only `unless json.is_a?(String)`, so an endpoint that renders
 * pre-serialized JSON answers with numbers even when the header was sent.
 * That is exactly why §4.3's normalization runs unconditionally and this is a
 * pure precision improvement layered on top: every join in the process keeps
 * working in both modes, and the flag can be flipped without changing
 * semantics.
 *
 * ## Why the flag comparison is byte-exact
 *
 * This flag changes the wire type of every identifier in every response. Every
 * trim, lowercase or truthiness step widens the set of strings that
 * *accidentally* enable it — `TRUE` out of a YAML file, `1` out of a template,
 * a trailing space out of a paste — and each of those is a plausible accident.
 * So the comparison is `=== 'true'` and nothing else. This deliberately does
 * **not** use `isEnvTruthy()` from `src/env.ts`, which accepts
 * `true`/`1`/`yes`/`on` case-insensitively after trimming.
 */

/** The only environment variable that enables negotiation. */
export const CANVAS_STRING_IDS_ENV_VAR = 'CANVAS_STRING_IDS'

/**
 * Canvas gates on `request.headers["Accept"]&.include?("application/json+canvas-string-ids")`
 * — a substring test (`application_controller.rb:2978`, `stringify_json_ids?`).
 * The plain `application/json` fallback therefore costs nothing and keeps the
 * request acceptable to a proxy or endpoint that does not know the vendor type.
 */
export const CANVAS_STRING_IDS_ACCEPT = 'application/json+canvas-string-ids, application/json'

/**
 * New Quizzes. `json_cast` is an `ApplicationController` concern and
 * `/api/quiz/v1` is served by the separate New Quizzes service, which does not
 * implement the vendor media type — a code search for `quiz/v1` under Canvas's
 * `config/` returns no routes. Our own types already record that it answers
 * differently: `CanvasNewQuizItem.id` is a `string` while `CanvasNewQuiz.id` is
 * a `number`. Sending the header there negotiates nothing, so excluding it
 * keeps those 11 call sites byte-identical to their pre-flag requests instead
 * of betting on an unverified service (§5, open question 2).
 */
const NEW_QUIZZES_PATH_PREFIX = '/api/quiz/v1'

/** Byte-exact, deliberately un-normalized. See the module comment. */
function negotiationEnabled(): boolean {
  return process.env[CANVAS_STRING_IDS_ENV_VAR] === 'true'
}

/**
 * The `Accept` header to merge into a Canvas request, or `undefined` when this
 * request must not negotiate. Spread it into a header record: `{...undefined}`
 * is `{}`, so a disabled flag adds no key at all and the request stays
 * byte-identical to the pre-flag one.
 *
 * Decided per URL rather than per client so that a `Link` rel="next" URL is
 * judged on its own pathname, and read from the environment per call so the
 * flag has no construction-order dependency.
 *
 * Fails **closed** on a URL that does not parse: no header means numbers,
 * which is the pre-2b status quo, and §4.3 normalization still applies.
 */
export function stringIdsAcceptHeader(url: string): { Accept: string } | undefined {
  if (!negotiationEnabled()) return undefined

  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return undefined
  }
  if (pathname.startsWith(NEW_QUIZZES_PATH_PREFIX)) return undefined

  return { Accept: CANVAS_STRING_IDS_ACCEPT }
}
