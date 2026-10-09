/**
 * The §3.0 strict-leaf walk over `src/canvas/types.ts`, as a test helper.
 *
 * `docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md` §3.0.
 * The walk exists here rather than as a hand-maintained list of field names
 * because the list it produces is the subject of assertions that must not go
 * stale: that no numeric leaf is one Canvas's own key regexes would convert
 * (the `converts` field below), and that the remaining numeric fields — the
 * quantities — are left alone. `converts` encodes only Canvas's two key
 * regexes; it says nothing about `ID_FIELD_EXCEPTIONS` membership, which is a
 * declared-type property (`CanvasId` vs `number`) rather than a name-pattern
 * one, and is checked separately via `canvasIdLeaves()` below and the
 * `tests/canvas/normalize-ids.test.ts` suite that cross-references it against
 * `ID_FIELD_EXCEPTIONS`.
 *
 * A hand list would rot the moment a new Canvas field lands. Deriving the
 * subject from the artifact is what makes the gate self-policing.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

/** Canvas's scalar key rule, from `gems/stringify_ids`. */
export const CANVAS_SCALAR_ID_KEY = /(^|_)id$/i
/** Canvas's array key rule, from `gems/stringify_ids`. */
export const CANVAS_ARRAY_ID_KEY = /(^|_)ids$/i

export interface NumericLeaf {
  /** `Interface.container.property`, e.g. `CanvasAssignmentGroup.rules.never_drop`. */
  readonly path: string
  readonly name: string
  /** The nearest enclosing property name, or `null` at an interface body. */
  readonly parent: string | null
  /** True when an array wrapper was unwrapped on the way to the `number`. */
  readonly arrayed: boolean
  readonly declared: string
  readonly line: number
  /** True when Canvas's own key regexes convert it. */
  readonly converts: boolean
}

const TYPES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/canvas/types.ts',
)

interface StripState {
  constituents: ts.TypeNode[]
  arrayed: boolean
}

/**
 * §3.0's type-stripping rule: unwrap `Array<T>` / `T[]` / parentheses, drop
 * `null` and `undefined`, and descend into the type arguments of any other
 * generic reference so that a `TypeLiteral` nested inside one is reached.
 *
 * `Record<string, number>` is deliberately *not* a numeric leaf: the `number`
 * is a map value type rather than a declared field, and Canvas's stringifier
 * keys on field names. `Record<string, { points?: number }>` is still
 * descended into, which is the case revision 2's walk missed.
 */
function strip(node: ts.TypeNode, sf: ts.SourceFile, state: StripState): StripState {
  if (ts.isParenthesizedTypeNode(node)) return strip(node.type, sf, state)
  if (ts.isArrayTypeNode(node)) {
    state.arrayed = true
    return strip(node.elementType, sf, state)
  }
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return strip(node.type, sf, state)
  }
  if (ts.isUnionTypeNode(node)) {
    for (const member of node.types) strip(member, sf, state)
    return state
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return state
  if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword) return state
  if (ts.isTypeReferenceNode(node)) {
    const referenced = node.typeName.getText(sf)
    if (
      (referenced === 'Array' || referenced === 'ReadonlyArray') &&
      node.typeArguments?.length === 1
    ) {
      state.arrayed = true
      return strip(node.typeArguments[0]!, sf, state)
    }
    if (referenced === 'Record') {
      for (const argument of node.typeArguments ?? []) {
        const nested = strip(argument, sf, { constituents: [], arrayed: false })
        for (const constituent of nested.constituents) {
          if (ts.isTypeLiteralNode(constituent)) state.constituents.push(constituent)
        }
      }
      return state
    }
    if (node.typeArguments?.length) {
      for (const argument of node.typeArguments) strip(argument, sf, state)
      return state
    }
  }
  state.constituents.push(node)
  return state
}

/**
 * Shared recursive walk behind both `numericLeaves()` and `canvasIdLeaves()`.
 * `isTarget` decides which stripped constituents count as a match for the
 * leaf kind being collected — `NumberKeyword` for the numeric walk, a
 * `CanvasId` type reference for the ID walk. Everything else (container
 * descent, array/parent tracking, the `converts` computation) is identical
 * between the two, which is what makes the two leaf sets comparable by
 * `name` + `arrayed` in the cross-check assertions.
 */
function walkLeaves(
  sf: ts.SourceFile,
  isTarget: (constituents: ts.TypeNode[]) => boolean,
): NumericLeaf[] {
  const leaves: NumericLeaf[] = []

  const visitProperty = (
    property: ts.PropertySignature,
    ownerPath: string,
    parent: string | null,
  ): void => {
    if (!property.type) return
    const name = property.name.getText(sf)
    const full = `${ownerPath}.${name}`
    const state = strip(property.type, sf, { constituents: [], arrayed: false })
    const literals = state.constituents.filter(ts.isTypeLiteralNode)
    if (literals.length > 0) {
      // A container is not counted; its own members are visited instead.
      for (const literal of literals) {
        for (const member of literal.members) {
          if (ts.isPropertySignature(member)) visitProperty(member, full, name)
        }
      }
      return
    }
    if (!isTarget(state.constituents)) return
    leaves.push({
      path: full,
      name,
      parent,
      arrayed: state.arrayed,
      declared: property.type.getText(sf),
      line: sf.getLineAndCharacterOfPosition(property.getStart(sf)).line + 1,
      converts: state.arrayed ? CANVAS_ARRAY_ID_KEY.test(name) : CANVAS_SCALAR_ID_KEY.test(name),
    })
  }

  for (const statement of sf.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    for (const member of statement.members) {
      if (ts.isPropertySignature(member)) visitProperty(member, statement.name.getText(sf), null)
    }
  }
  return leaves
}

/**
 * Parses `src/canvas/types.ts`, or — for the negative control in
 * `normalize-ids.test.ts` — a synthetic snippet standing in for it.
 * `sourceOverride` only ever carries a hand-written fixture string in tests;
 * production callers always take the default and read the real file.
 */
function parseTypesSource(sourceOverride?: string): ts.SourceFile {
  const text = sourceOverride ?? readFileSync(TYPES_FILE, 'utf8')
  return ts.createSourceFile(TYPES_FILE, text, ts.ScriptTarget.Latest, true)
}

/** Every numeric leaf in `src/canvas/types.ts`, per §3.0's strict leaf rule. */
export function numericLeaves(sourceOverride?: string): NumericLeaf[] {
  const sf = parseTypesSource(sourceOverride)
  return walkLeaves(sf, (constituents) =>
    constituents.some((c) => c.kind === ts.SyntaxKind.NumberKeyword),
  )
}

/**
 * Every leaf in `src/canvas/types.ts` declared as the `CanvasId` type
 * (scalar) or `CanvasId[]` (array) — the declared-type half of the
 * `ID_FIELD_EXCEPTIONS` cross-check: each exception entry names a field this
 * module normalizes at the wire, and `src/canvas/types.ts` is expected to
 * declare that same field as `CanvasId`/`CanvasId[]`, never `number`/`number[]`.
 */
export function canvasIdLeaves(sourceOverride?: string): NumericLeaf[] {
  const sf = parseTypesSource(sourceOverride)
  return walkLeaves(sf, (constituents) =>
    constituents.some((c) => ts.isTypeReferenceNode(c) && c.typeName.getText(sf) === 'CanvasId'),
  )
}
