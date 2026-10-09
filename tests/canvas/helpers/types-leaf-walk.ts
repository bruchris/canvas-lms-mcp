/**
 * The §3.0 strict-leaf walk over `src/canvas/types.ts`, as a test helper.
 *
 * `docs/superpowers/specs/2026-10-05-bru-2730-canvas-64bit-identifiers.md` §3.0.
 * The walk exists here rather than as a hand-maintained list of field names
 * because the list it produces is the subject of two assertions that must not
 * go stale: that every identifier field is either converted by Canvas's own
 * key regexes or named in `ID_FIELD_EXCEPTIONS`, and that the remaining
 * numeric fields — the quantities — are left alone.
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

/** Every numeric leaf in `src/canvas/types.ts`, per §3.0's strict leaf rule. */
export function numericLeaves(): NumericLeaf[] {
  const text = readFileSync(TYPES_FILE, 'utf8')
  const sf = ts.createSourceFile(TYPES_FILE, text, ts.ScriptTarget.Latest, true)
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
    if (!state.constituents.some((c) => c.kind === ts.SyntaxKind.NumberKeyword)) return
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
