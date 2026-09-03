// Reusable output schemas for Canvas entities, plus the compile-time bridge
// that keeps them honest against `src/canvas/types.ts`.
//
// Design: BRU-2418 §2 (placement), §3 (boundary parsing policy).
//
// Rules these schemas follow, each of which is a measured failure mode:
//   - `z.looseObject`, never `z.object` — Canvas ships fields continuously and
//     a strict client rejects the whole call on the first undeclared one.
//   - `.nullish()` on everything not guaranteed present *and* non-null on every
//     Canvas version. Canvas sends explicit `null` constantly, and `.optional()`
//     alone rejects it.
//   - No `format`, `pattern`, `min`, `max` or enum on a Canvas-sourced value.
//     `z.iso.datetime()` emits a pattern requiring a `Z` suffix, which Canvas
//     instances emitting `+02:00` offsets would fail. Dates are `z.string()`.
//   - `z.number()`, not `z.int()` — `z.int()` emits safe-integer bounds, which
//     is a constraint on data we do not produce.
//   - Never a bare `z.unknown()`: in output mode Zod marks it *required*, so an
//     absent key fails. Use `z.unknown().nullish()`.

import { z } from 'zod'
import type { CanvasPage } from '../../canvas/types'

/**
 * Every field name an entity schema declares must exist on the hand-written
 * Canvas TypeScript interface, and the interface's type for it must be
 * something the schema accepts.
 *
 * The assertion is deliberately one-directional. The Canvas type having *more*
 * fields than the schema is the design (the schema is loose). What it catches
 * is a schema that invented a field, or typed one incompatibly — e.g. declaring
 * `page_id: z.string()` against `page_id: number`. A failure names the offending
 * key in the compile error.
 *
 * It cannot catch "the schema requires a field the handler may omit" — that is
 * a runtime property, and the fixture round-trip tests cover it.
 */
type DeclaredKeys<S extends z.ZodObject> = keyof S['shape'] & string

type SchemaAcceptsCanvasType<S extends z.ZodObject, T> = {
  [K in DeclaredKeys<S> & keyof T]: T[K] extends z.infer<S['shape'][K]> ? true : K
}[DeclaredKeys<S> & keyof T]

type Expect<T extends true> = T

/** `CanvasPage` — `src/canvas/types.ts`. Canvas also returns `front_page`, */
/** `hide_from_students`, `last_edited_by` and more; the looseness is the point. */
export const canvasPageSchema = z.looseObject({
  page_id: z.number(),
  url: z.string(),
  title: z.string(),
  // Absent on the paginated list endpoint, which returns stubs without a body.
  body: z.string().nullish(),
  published: z.boolean().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  editing_roles: z.string().nullish(),
})

export type _PageKeysExistOnCanvasType = Expect<
  DeclaredKeys<typeof canvasPageSchema> extends keyof CanvasPage ? true : false
>
export type _PageTypesAreAccepted = Expect<
  SchemaAcceptsCanvasType<typeof canvasPageSchema, CanvasPage>
>

/**
 * `delete_page`'s acknowledgement. Authored by the tool handler, not by Canvas,
 * so it is strict — and `deleted` is a literal because we are the ones setting
 * it. This is the shape the ban on constraints in §3.3 explicitly permits.
 */
export const pageDeletionSchema = z.strictObject({
  deleted: z.literal(true),
  page_url: z.string(),
})
