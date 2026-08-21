const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// Named, decimal (`&#NN;`), and hex (`&#xNN;`) entities are matched in a single
// pass so a decoded `&amp;` can never be re-scanned as part of another entity —
// sequential `.replace()` calls double-decode `&amp;lt;` into `<` instead of `&lt;`.
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

export function decodeHtmlEntities(s: string): string {
  return s.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const codePoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}
