/**
 * Run `fn` across `items` with at most `limit` invocations in flight at once,
 * returning the results in the SAME order as `items` regardless of the order in
 * which the individual calls settle (`results[i]` always corresponds to
 * `items[i]`).
 *
 * This is the single shared implementation of the batched fan-out first written
 * inline for `find_student_across_courses` (PR #252). Whole-course scans such as
 * {@link PagesModule.listWithBodies} would otherwise issue one Canvas request per
 * item all at once — a 300-page course means 300 simultaneous requests with no
 * backstop. Bounding the fan-out keeps a large course from hammering Canvas.
 *
 * Error semantics match a plain `Promise.all`: the first rejection propagates
 * unchanged and no further batches are started. Call sites that want to tolerate
 * per-item failures (like `find_student_across_courses`) do so by catching inside
 * `fn` and resolving with a discriminated result, never by letting `fn` throw.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) {
    throw new RangeError(`mapWithConcurrency: limit must be >= 1, got ${limit}`)
  }

  const results = new Array<R>(items.length)
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit)
    const settled = await Promise.all(batch.map((item, offset) => fn(item, start + offset)))
    settled.forEach((result, offset) => {
      results[start + offset] = result
    })
  }
  return results
}
