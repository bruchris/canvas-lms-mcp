// The shared structured-output contract. One module owns what a migrated tool
// advertises as its `outputSchema`, what it puts in `structuredContent`, and
// how a mismatch is reported.
//
// Design: BRU-2418 §1 (contract), §3 (boundary parsing), §4 (errors).
//
// Deviation from the design, measured on @modelcontextprotocol/sdk@1.30.0
// (BRU-2419): §1.3 specified "object -> that object's schema, strict at top
// level". That is wrong for the pass-through tools whose top-level value *is* a
// Canvas entity (`get_page` returns a raw `CanvasPage`). Registering those
// strict re-creates the exact drift break the contract exists to prevent — the
// first Canvas field addition makes a strict client throw. The rule that
// survives is the design's own principle, applied to the top level too:
// **strict where we author the shape, loose where Canvas does.**
//
// `registerTool` accepts `ZodRawShapeCompat | AnySchema`, so passing a whole
// `z.looseObject` (rather than a raw shape, which the SDK always wraps in a
// strict object) is a typed, first-class option and needs no cast.

import { z } from 'zod'

/** §1.3 — the acknowledgement text for handlers that resolve to `undefined`. */
export const ACK_MESSAGE = 'Operation completed successfully.'

/**
 * What a migrated tool promises. Build these with {@link objectOutput},
 * {@link listOutput} and {@link ackOutput} — the constructors are the only
 * supported way to make one, so the envelope and the schema it is validated
 * against cannot drift apart.
 */
export type ToolOutputContract =
  /** The handler's value is already an object; it *is* the structured content. */
  | { readonly kind: 'object'; readonly schema: z.ZodType }
  /** The handler's value is an array; it is wrapped under a single authored key. */
  | { readonly kind: 'list'; readonly key: string; readonly schema: z.ZodType }
  /** The handler resolves to `undefined`; a fixed acknowledgement is emitted. */
  | { readonly kind: 'ack'; readonly schema: z.ZodType }

/**
 * A tool whose handler returns a single object.
 *
 * Pass a `z.looseObject` when the object is a Canvas entity (Canvas adds fields
 * without warning and every one of them would otherwise break the tool), and a
 * `z.strictObject` when we author the shape ourselves in the handler.
 */
export function objectOutput(schema: z.ZodType): ToolOutputContract {
  return { kind: 'object', schema }
}

/**
 * A tool whose handler returns an array. MCP requires `outputSchema` to be an
 * object, so the array is wrapped under `key` (the plural entity name, chosen
 * mechanically). The envelope is ours, so it is strict; the entities inside it
 * are as loose as the caller made them.
 */
export function listOutput(key: string, entity: z.ZodType): ToolOutputContract {
  return { kind: 'list', key, schema: z.strictObject({ [key]: z.array(entity) }) }
}

/** A tool whose handler resolves to `undefined`. Entirely server-authored. */
export function ackOutput(): ToolOutputContract {
  return {
    kind: 'ack',
    schema: z.strictObject({ ok: z.literal(true), message: z.string() }),
  }
}

/**
 * Turn a handler's (already fenced) value into the `structuredContent` payload.
 * Never mutates or re-keys the value — the text surface and this one must carry
 * the same data (§1.2).
 */
export function buildEnvelope(contract: ToolOutputContract, value: unknown): unknown {
  switch (contract.kind) {
    case 'list':
      return { [contract.key]: value }
    case 'ack':
      return { ok: true, message: ACK_MESSAGE }
    case 'object':
      return value
  }
}

export type EnvelopeValidation =
  | { readonly ok: true }
  /** Type-and-path only. Never carries a value from the payload (§4.3). */
  | { readonly ok: false; readonly issues: string[] }

/**
 * Check the envelope against the very schema the client was given, so a payload
 * that would make a strict client throw is caught here first (§4.2).
 *
 * A caveat this cannot fix on its own: a plain `z.object` *strips* unknown keys
 * on parse while still emitting `additionalProperties: false`, so it would pass
 * here and be rejected by the client. That is why every migrated tool must have
 * a fixture carrying an undeclared field (gate §7.2.3) — a real client verdict
 * is the only thing that proves the two agree.
 */
export function validateEnvelope(
  contract: ToolOutputContract,
  envelope: unknown,
): EnvelopeValidation {
  const parsed = contract.schema.safeParse(envelope)
  if (parsed.success) return { ok: true }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.join('.')
      return path === '' ? issue.message : `${path}: ${issue.message}`
    }),
  }
}

/**
 * The only thing the model is told when a contract is violated. Deliberately
 * fixed and free of paths, field names and values (§4.3): the detail goes to
 * the operator via stderr, and a model reading this must not mistake our bug
 * for a Canvas permission problem.
 */
export function outputContractError(toolName: string): string {
  return (
    `Canvas returned data this tool could not describe (${toolName}). ` +
    'This is a canvas-lms-mcp bug, not a Canvas permission problem — please report it. ' +
    'Re-run with CANVAS_LOG_LEVEL=debug for detail.'
  )
}
