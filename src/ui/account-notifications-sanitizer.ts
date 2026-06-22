// Pure, DOM-free definition of the announcement-HTML sanitizer trust boundary.
//
// Announcement `message` bodies are institution-authored HTML. The widget
// (`account-notifications.html.ts`) renders them through an allowlist DOM rebuild.
// The *security-critical decisions* — which tags survive and which URL schemes are
// permitted — are defined HERE and interpolated into the widget, so there is a
// single source of truth that is unit-tested directly (the widget's runtime JS
// cannot execute under the node test environment, but these decisions can).

// Inline/structural tags that are cloned into the output as-is.
export const ALLOWED_TAGS: readonly string[] = [
  'A',
  'ABBR',
  'B',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'EM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'I',
  'LI',
  'OL',
  'P',
  'PRE',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'U',
  'UL',
]

// Tags whose entire subtree is discarded — scripts, styles, embeds, form controls,
// and anything that can load a remote resource or execute code.
export const DROP_TAGS: readonly string[] = [
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'TEMPLATE',
  'NOSCRIPT',
  'FORM',
  'INPUT',
  'BUTTON',
  'IMG',
  'SVG',
]

// Anchor `href` values are kept only if they match one of these (case-insensitive)
// schemes. Everything else (javascript:, data:, vbscript:, relative, protocol-
// relative, …) is dropped. Stored as pattern source strings so the same definition
// drives both the runtime guard below and the interpolated widget copy.
export const SAFE_URL_PATTERNS: readonly string[] = ['^https?://', '^mailto:']

export type TagDisposition = 'allow' | 'drop' | 'unwrap'

/**
 * Decide what the sanitizer does with an element: clone it (`allow`), discard it
 * and its contents (`drop`), or remove the wrapper but keep its children (`unwrap`).
 */
export function classifyTag(tagName: unknown): TagDisposition {
  const tag = (tagName == null ? '' : String(tagName)).toUpperCase()
  if (ALLOWED_TAGS.includes(tag)) return 'allow'
  if (DROP_TAGS.includes(tag)) return 'drop'
  return 'unwrap'
}

const SAFE_URL_RES = SAFE_URL_PATTERNS.map((p) => new RegExp(p, 'i'))

/**
 * Return the trimmed URL if it uses an allowed scheme, else null.
 * This is the only guard that blocks javascript:/data:/vbscript: hrefs.
 */
export function sanitizeUrl(value: unknown): string | null {
  const v = (value == null ? '' : String(value)).trim()
  for (const re of SAFE_URL_RES) {
    if (re.test(v)) return v
  }
  return null
}
