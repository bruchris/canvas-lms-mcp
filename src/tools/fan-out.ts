import { CanvasApiError } from '../canvas/client'

/**
 * Terminal classification of a single fan-out item that did NOT throw.
 * A thrown error is classified as `failed` by {@link fanOut} itself, so callers
 * never construct a `failed` outcome — they simply let the action throw.
 */
export type FanOutOutcome<TResult> =
  | { status: 'applied'; result: TResult }
  | { status: 'skipped'; result: TResult }

/**
 * Canonical result envelope shared by every "apply X across a course" write
 * tool (e.g. `set_student_quiz_accommodation`, `set_student_assignment_dates`).
 * Items are pre-separated into applied/skipped/failed buckets so an MCP client
 * never has to filter a flat array by status flags.
 */
export interface FanOutResult<TResult> {
  applied: TResult[]
  skipped: TResult[]
  failed: TResult[]
  /**
   * IDs requested via a subset filter that were absent from the course.
   * Omitted entirely when the tool exposes no id-subset filter.
   */
  not_found?: number[]
  summary: {
    total: number
    applied: number
    skipped: number
    failed: number
    not_found?: number
  }
}

export interface FanOutConfig<TItem, TResult> {
  /** The items actually iterated (already filtered to the requested subset). */
  items: TItem[]
  /**
   * Perform the per-item action. Resolve with an `applied` or `skipped`
   * outcome; THROW to mark the item failed — the throw is caught by
   * {@link fanOut}, never by the caller.
   */
  perform: (item: TItem) => Promise<FanOutOutcome<TResult>>
  /** Build the per-item `failed[]` entry from the item and the reduced error message. */
  onError: (item: TItem, message: string) => TResult
  /**
   * Descriptive context for the log line emitted when a NON-`CanvasApiError`
   * escapes `perform` — interpolated as `Unexpected error <context>:`.
   */
  errorContext: (item: TItem) => string
  /**
   * IDs requested via a subset filter but absent from the course. Supply
   * (even as `[]`) to include `not_found` in the envelope; omit to leave it out.
   */
  notFound?: number[]
}

/**
 * Run `perform` across every item, tolerating per-item failures, and collect
 * the outcomes into the canonical {@link FanOutResult} envelope.
 *
 * This is the single place the partial-failure try/catch lives. A
 * `CanvasApiError` (an expected Canvas-side rejection such as a 422 duplicate)
 * is reduced to its raw `.message` on the failed entry. Any OTHER error is
 * additionally `console.error`-logged here, mirroring `buildHandler`'s
 * boundary: a non-Canvas error caught mid-fan-out would otherwise never reach
 * that logging, silently reducing a programming bug to an opaque per-item
 * string.
 */
export async function fanOut<TItem, TResult>(
  config: FanOutConfig<TItem, TResult>,
): Promise<FanOutResult<TResult>> {
  const applied: TResult[] = []
  const skipped: TResult[] = []
  const failed: TResult[] = []

  for (const item of config.items) {
    try {
      const outcome = await config.perform(item)
      if (outcome.status === 'applied') {
        applied.push(outcome.result)
      } else {
        skipped.push(outcome.result)
      }
    } catch (err) {
      if (!(err instanceof CanvasApiError)) {
        console.error(`Unexpected error ${config.errorContext(item)}:`, err)
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      failed.push(config.onError(item, message))
    }
  }

  const result: FanOutResult<TResult> = {
    applied,
    skipped,
    failed,
    summary: {
      total: config.items.length,
      applied: applied.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  }
  if (config.notFound !== undefined) {
    result.not_found = config.notFound
    result.summary.not_found = config.notFound.length
  }
  return result
}
