import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { join, basename, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'

/**
 * BRU-2730 §8 PR 1b, the two source-level guards.
 *
 * They are source-level because nothing else can see this change. `tsc` cannot
 * (§1 correction 7: `ToolDefinition.handler` takes `Record<string, unknown>`,
 * so every cast operand is `unknown` and `unknown as number` compiles), and no
 * behavioural test can fail on the signature half either, because a string ID
 * already reached the URL byte-exact through the old casts. A partially-done
 * migration is otherwise indistinguishable from a finished one.
 *
 * Both walks take their input as `{ fileName, text }` pairs rather than reading
 * the tree themselves, so the same code that polices `src/` also runs over
 * injected fixtures below. That is what makes "the guard reports 0" mean
 * something: the fixtures prove the walk produces a non-zero on the defect it
 * exists to catch, and the floors prove it is looking at a non-empty tree.
 */

const REPO_ROOT = resolve(__dirname, '..', '..')

// §3.6's name rule, verbatim.
const NAME_RULE = /(^|_)ids?$/i
const CAMEL_RULE = /[a-z]Ids?$/
// §4.4 / Appendix A's ID-operand regex, applied to a cast operand's source text.
const OPERAND_RULE = /(^|[._])(id|ids)$|[a-z](Id|Ids)$|_id$|^id$/

const FUNCTION_PARENTS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
])

interface SourceInput {
  fileName: string
  text: string
}

function nameIsIdShaped(name: string): boolean {
  return NAME_RULE.test(name) || CAMEL_RULE.test(name)
}

/**
 * §3.6's unwrapping: parentheses, `T[]`, `Array<T>`, `ReadonlyArray<T>`,
 * `readonly T[]`; expand unions; drop `null` and `undefined`. A literal
 * constituent does not stop a site from counting — `number | 'all'` counts,
 * because the `number` keyword survives.
 */
function leaves(node: ts.TypeNode, out: ts.TypeNode[] = []): ts.TypeNode[] {
  if (ts.isParenthesizedTypeNode(node)) return leaves(node.type, out)
  if (ts.isArrayTypeNode(node)) return leaves(node.elementType, out)
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return leaves(node.type, out)
  }
  if (
    ts.isTypeReferenceNode(node) &&
    ['Array', 'ReadonlyArray'].includes(node.typeName.getText()) &&
    node.typeArguments?.length === 1
  ) {
    return leaves(node.typeArguments[0]!, out)
  }
  if (ts.isUnionTypeNode(node)) {
    for (const member of node.types) leaves(member, out)
    return out
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return out
  if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword) return out
  out.push(node)
  return out
}

interface DeclarationSite {
  file: string
  line: number
  name: string
  admitsNumber: boolean
}

/** §3.6's rule (a): every function/method/constructor parameter, and every PropertySignature. */
function declarationSites(inputs: SourceInput[]): DeclarationSite[] {
  const sites: DeclarationSite[] = []
  for (const input of inputs) {
    const sf = ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      let name: string | undefined
      let typeNode: ts.TypeNode | undefined
      if (
        ts.isParameter(node) &&
        node.type &&
        FUNCTION_PARENTS.has(node.parent.kind) &&
        ts.isIdentifier(node.name)
      ) {
        name = node.name.text
        typeNode = node.type
      } else if (
        ts.isPropertySignature(node) &&
        node.type &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        name = node.name.text
        typeNode = node.type
      }
      if (name !== undefined && typeNode && nameIsIdShaped(name)) {
        sites.push({
          file: input.fileName,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          name,
          admitsNumber: leaves(typeNode).some((l) => l.kind === ts.SyntaxKind.NumberKeyword),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return sites
}

interface CastSite {
  file: string
  line: number
  text: string
}

/** §4.4's rule: an `as` cast whose type is `number` or a union containing it, on an ID-named operand. */
function idNumberCasts(inputs: SourceInput[]): { all: number; offending: CastSite[] } {
  let all = 0
  const offending: CastSite[] = []
  for (const input of inputs) {
    const sf = ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node)) {
        all += 1
        const members = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type]
        const hasNumber = members.some((m) => m.kind === ts.SyntaxKind.NumberKeyword)
        if (hasNumber && OPERAND_RULE.test(node.expression.getText(sf))) {
          offending.push({
            file: input.fileName,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: node.getText(sf).replace(/\s+/g, ' '),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { all, offending }
}

function readTree(dir: string, skip: (file: string) => boolean = () => false): SourceInput[] {
  const out: SourceInput[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...readTree(full, skip))
      continue
    }
    if (!full.endsWith('.ts') || skip(full)) continue
    out.push({
      fileName: relative(REPO_ROOT, full).replace(/\\/g, '/'),
      text: readFileSync(full, 'utf8'),
    })
  }
  return out
}

/**
 * §3.6's denominator: `src/canvas/*.ts` except `types.ts` (response shapes,
 * which are PR 2a's) and `id.ts` (the definition of `CanvasId` itself).
 */
const canvasSources = readTree(join(REPO_ROOT, 'src', 'canvas'), (file) =>
  ['types.ts', 'id.ts'].includes(basename(file)),
)
const toolSources = [
  ...readTree(join(REPO_ROOT, 'src', 'tools')),
  ...readTree(join(REPO_ROOT, 'src', 'resources')),
]

describe('§3.6 count guard — no Canvas-module ID declaration still admits `number`', () => {
  const sites = declarationSites(canvasSources)

  it('finds at least 200 ID declaration sites, so the assertion below is not vacuous', () => {
    // The spec's walk finds 256 on this rule. The floor is deliberately well
    // under that, so adding or removing a Canvas method never has to touch it.
    expect(sites.length).toBeGreaterThanOrEqual(200)
    // A named control: a traversal that silently stopped resolving would lose
    // this one, and a `>= 200` floor alone would not say so.
    expect(sites.some((s) => s.file === 'src/canvas/courses.ts' && s.name === 'courseId')).toBe(
      true,
    )
  })

  it('no site admits the `number` keyword', () => {
    const offending = sites
      .filter((s) => s.admitsNumber)
      .map((s) => `${s.file}:${s.line} ${s.name}`)

    expect(offending).toEqual([])
  })

  it('the floor is load-bearing: pointed at an empty directory the FLOOR fails, not the zero-assertion', () => {
    // §8 asks for exactly this proof. Without the floor, "no site admits
    // `number`" passes trivially on an empty sweep — which is how a guard in
    // this repo went blind to 2 of 165 tools before.
    const empty = declarationSites(readTree(mkdtempSync(join(tmpdir(), 'id-guard-empty-'))))

    expect(empty.length).toBe(0)
    expect(() => expect(empty.length).toBeGreaterThanOrEqual(200)).toThrow()
    // The zero-assertion, by contrast, is perfectly happy with nothing at all.
    expect(empty.filter((s) => s.admitsNumber)).toEqual([])
  })

  it('negative injection: the walk names a reverted signature, and only that one', () => {
    // Proves the walk produces a non-zero on the defect it exists to catch,
    // without editing `src/`. The second parameter is a deliberate control:
    // `perPage` is not ID-shaped, so widening it must NOT be reported.
    const injected = declarationSites([
      {
        fileName: 'injected/courses.ts',
        text: [
          'export class Courses {',
          '  async get(courseId: number, perPage: number): Promise<void> {}',
          '  async list(accountId: CanvasId): Promise<void> {}',
          '}',
        ].join('\n'),
      },
    ])

    expect(injected.filter((s) => s.admitsNumber).map((s) => s.name)).toEqual(['courseId'])
    expect(injected.map((s) => s.name)).toEqual(['courseId', 'accountId'])
  })
})

describe('§4.4 cast guard — no `as number` cast remains on an ID-named operand in src/tools/**', () => {
  const { all, offending } = idNumberCasts(toolSources)

  it('examines a non-trivial number of `as` casts, so the assertion below is not vacuous', () => {
    // PR 1b retyped 240 ID-named casts; the files still carry several hundred
    // casts in total (`as string`, `as boolean`, the retyped `as CanvasId`).
    expect(all).toBeGreaterThanOrEqual(400)
  })

  it('reports no offending cast', () => {
    expect(offending.map((c) => `${c.file}:${c.line} ${c.text}`)).toEqual([])
  })

  it('negative injection: restoring one cast names exactly that site', () => {
    // §8: "Prove it by restoring one cast and watching exactly that one site
    // be named." The fixture carries three controls that must NOT be reported:
    // a quantity cast, an array-typed ID cast (outside §4.4's type rule), and
    // the migrated form.
    const injected = idNumberCasts([
      {
        fileName: 'injected/tool.ts',
        text: [
          'const a = params.course_id as number',
          'const b = params.per_page as number',
          'const c = params.assignment_ids as number[]',
          'const d = params.user_id as CanvasId',
          'const e = params.grading_standard_id as number | null',
        ].join('\n'),
      },
    ])

    expect(injected.offending.map((c) => c.line)).toEqual([1, 5])
    expect(injected.offending.map((c) => c.text)).toEqual([
      'params.course_id as number',
      'params.grading_standard_id as number | null',
    ])
  })
})
