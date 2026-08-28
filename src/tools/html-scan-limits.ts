/**
 * Ceiling on how much HTML a single audit tool will run its link/image/heading
 * extraction regexes over. Canvas-authored bodies are ordinarily a few KB to
 * tens of KB; this is far above that range but bounds worst-case per-item cost
 * as defense in depth alongside the bounded quantifiers in link-audit.ts and
 * accessibility-audit.ts (BRU-2360).
 */
export const MAX_HTML_SCAN_BYTES = 500_000

export function isOversizedHtml(html: string): boolean {
  return html.length > MAX_HTML_SCAN_BYTES
}

export interface ScanWarning<Location> {
  location: Location
  reason: 'oversized_content_skipped'
  detail: string
}

export function oversizedWarning<Location>(
  html: string,
  location: Location,
): ScanWarning<Location> {
  return {
    location,
    reason: 'oversized_content_skipped',
    detail:
      `Content is ${html.length.toLocaleString()} characters, over the ` +
      `${MAX_HTML_SCAN_BYTES.toLocaleString()}-character scan limit — skipped.`,
  }
}
