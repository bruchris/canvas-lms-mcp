// BRU-2730 spec §3.6, §4.4 and §17: the declaration-site walk and the four
// compile variants, implemented as one TypeScript-API transform.
//
// Usage (from a clean worktree with `pnpm install --frozen-lockfile` done):
//   node <this file> <repoRoot> walk        -> §3.6 site census, no edits
//   LIST=1 node <this file> <repoRoot> walk -> every site and cast as file:line
//   node <this file> <repoRoot> baseline    -> tsc with no edits (must be 0)
//   node <this file> <repoRoot> A|B|C|D     -> one §17 variant, then restored
//
// Variants (§17): A = `number` -> `string` at every §3.6 site.
// B = `number` -> `string | number` at every §3.6 site.
// C = A plus `as number` / `as number | null` casts on ID-named operands in
//     src/tools/**, `number` -> `string`.
// D = B plus the same cast rewrite, `number` -> `string | number`.
//
// The script restores every file it edits from an in-memory copy, then
// prints one JSON line. Nothing is written outside the edited files.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [, , rootArg, mode = 'walk'] = process.argv
if (!rootArg) {
  console.error('usage: declaration-variants.mjs <repoRoot> [walk|baseline|A|B|C|D]')
  process.exit(2)
}
const root = path.resolve(rootArg)
const ts = createRequire(path.join(root, 'package.json'))('typescript')

// §3.6 name rule.
const NAME_RULE = /(^|_)ids?$/i
const CAMEL_RULE = /[a-z]Ids?$/
// §4.4 / Appendix A ID-operand regex, applied to the cast operand's source text.
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

function nameIsIdShaped(name) {
  return NAME_RULE.test(name) || CAMEL_RULE.test(name)
}

// Unwrap parentheses, T[], Array<T>, ReadonlyArray<T>, readonly T[]; expand
// unions; drop null and undefined. Returns the leaf type nodes.
function leaves(node, out = []) {
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
    return leaves(node.typeArguments[0], out)
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

function listSourceFiles(dir, filter) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listSourceFiles(full, filter)
      return filter(full) ? [full] : []
    })
    .sort()
}

function parse(file) {
  const text = fs.readFileSync(file, 'utf8')
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) }
}

// §3.6 declaration sites in src/canvas/*.ts except types.ts.
function canvasSites() {
  const files = listSourceFiles(
    path.join(root, 'src/canvas'),
    (f) => f.endsWith('.ts') && path.basename(f) !== 'types.ts',
  )
  const sites = []
  for (const file of files) {
    const { sf } = parse(file)
    const visit = (node) => {
      let name
      let typeNode
      let inline = false
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
        inline = !ts.isInterfaceDeclaration(node.parent) && !ts.isTypeAliasDeclaration(node.parent)
      }
      if (name !== undefined && nameIsIdShaped(name)) {
        const ls = leaves(typeNode)
        const numberLeaves = ls.filter((l) => l.kind === ts.SyntaxKind.NumberKeyword)
        if (numberLeaves.length > 0) {
          sites.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            name,
            kind: ts.isParameter(node) ? 'param' : 'prop',
            inline,
            widened: ls.length > 1,
            numberLeaves,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return sites
}

// §4.4 casts: `as number` / `as number | null` (or any union containing the
// number keyword, not arrays) on an ID-named operand, in src/tools/**.
function toolCasts() {
  const files = listSourceFiles(path.join(root, 'src/tools'), (f) => f.endsWith('.ts'))
  const casts = []
  for (const file of files) {
    const { sf } = parse(file)
    const visit = (node) => {
      if (ts.isAsExpression(node)) {
        const t = node.type
        const members = ts.isUnionTypeNode(t) ? t.types : [t]
        const hasNumber = members.some((m) => m.kind === ts.SyntaxKind.NumberKeyword)
        if (hasNumber && OPERAND_RULE.test(node.expression.getText(sf))) {
          const keyword = members.find((m) => m.kind === ts.SyntaxKind.NumberKeyword)
          casts.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            keyword,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return casts
}

function runTsc() {
  const tscBin = path.join(root, 'node_modules/typescript/bin/tsc')
  let out = ''
  try {
    out = execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  const errors = out.split('\n').filter((l) => /error TS\d+/.test(l))
  // ERRORS_FILE=<path> keeps the full tsc error list for a diff, not just the first three.
  if (process.env.ERRORS_FILE) fs.writeFileSync(process.env.ERRORS_FILE, errors.join('\n'))
  const files = new Set(errors.map((l) => l.split('(')[0].replace(/\\/g, '/')))
  const inCanvas = errors.filter((l) => /^src\/canvas\//.test(l.replace(/\\/g, '/'))).length
  // Errors grouped by the first two path segments, e.g. src/tools.
  const byDir = {}
  for (const l of errors) {
    const dir = l.split('(')[0].replace(/\\/g, '/').split('/').slice(0, 2).join('/')
    byDir[dir] = (byDir[dir] ?? 0) + 1
  }
  return { errors: errors.length, files: files.size, inCanvas, byDir, sample: errors.slice(0, 3) }
}

function applyEdits(edits) {
  // edits: { file, start, end, text }[]; back-to-front per file so offsets stay valid.
  const byFile = new Map()
  for (const e of edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, [])
    byFile.get(e.file).push(e)
  }
  const originals = new Map()
  for (const [file, list] of byFile) {
    const original = fs.readFileSync(file, 'utf8')
    originals.set(file, original)
    let text = original
    for (const e of list.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, e.start) + e.text + text.slice(e.end)
    }
    fs.writeFileSync(file, text)
  }
  return originals
}

function restore(originals) {
  for (const [file, original] of originals) fs.writeFileSync(file, original)
}

const sites = canvasSites()
const walk = {
  sites: sites.length,
  numberOnly: sites.filter((s) => !s.widened).length,
  widened: sites.filter((s) => s.widened).length,
  inline: sites.filter((s) => s.inline).length,
  inlineAdmittingNumber: sites.filter((s) => s.inline && !s.widened).length,
  files: new Set(sites.map((s) => s.file)).size,
}

if (mode === 'walk') {
  const casts = toolCasts()
  const rel = (file) => path.relative(root, file).replace(/\\/g, '/')
  // LIST=1 prints every declaration site and cast as file:line, for diffing against another probe's list.
  if (process.env.LIST === '1') {
    for (const s of sites)
      console.log(`site ${rel(s.file)}:${s.line} ${s.name}${s.widened ? ' widened' : ''}`)
    for (const c of casts) console.log(`cast ${rel(c.file)}:${c.line}`)
    process.exit(0)
  }
  console.log(
    JSON.stringify(
      {
        mode,
        ...walk,
        toolCasts: casts.length,
        widenedSites: sites
          .filter((s) => s.widened)
          .map((s) => `${rel(s.file)}:${s.line} ${s.name}`),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (mode === 'baseline') {
  console.log(JSON.stringify({ mode, tsc: runTsc() }))
  process.exit(0)
}

const variantSpec = {
  A: { castRewrite: false, replacement: 'string' },
  B: { castRewrite: false, replacement: 'string | number' },
  C: { castRewrite: true, replacement: 'string' },
  D: { castRewrite: true, replacement: 'string | number' },
}[mode]
if (!variantSpec) {
  console.error(`unknown mode: ${mode}`)
  process.exit(2)
}

const edits = []
// SKIP_WIDENED=1 leaves the 9 already-widened sites untouched (QA r5 variant).
const targets = process.env.SKIP_WIDENED === '1' ? sites.filter((s) => !s.widened) : sites
for (const site of targets) {
  for (const kw of site.numberLeaves) {
    const { sf } = parse(site.file)
    edits.push(keywordEdit(site.file, sf, kw, variantSpec.replacement))
  }
}
let castCount = 0
if (variantSpec.castRewrite) {
  for (const cast of toolCasts()) {
    const { sf } = parse(cast.file)
    // §17: casts become `as string` in both C and D, whatever the signature target is.
    edits.push(keywordEdit(cast.file, sf, cast.keyword, 'string'))
    castCount++
  }
}

function keywordEdit(file, sf, node, replacement) {
  // A bare `number` that is a direct T[] element needs parentheses around a union.
  const needsParens = replacement.includes('|') && node.parent && ts.isArrayTypeNode(node.parent)
  return {
    file,
    start: node.getStart(sf),
    end: node.getEnd(),
    text: needsParens ? `(${replacement})` : replacement,
  }
}

const originals = applyEdits(edits)
let result
try {
  result = runTsc()
} finally {
  restore(originals)
}
const status = execFileSync('git', ['status', '--short', '--', 'src'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
console.log(
  JSON.stringify({
    mode,
    declarationSites: sites.length,
    declarationEdits: edits.length - castCount,
    castEdits: castCount,
    tsc: result,
    restoredCleanly: status === '',
  }),
)
