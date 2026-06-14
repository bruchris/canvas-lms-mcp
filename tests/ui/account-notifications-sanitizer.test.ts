import { describe, it, expect } from 'vitest'
import {
  ALLOWED_TAGS,
  DROP_TAGS,
  SAFE_URL_PATTERNS,
  classifyTag,
  sanitizeUrl,
} from '../../src/ui/account-notifications-sanitizer'
import { ACCOUNT_NOTIFICATIONS_HTML } from '../../src/ui/account-notifications.html'

// These guard the XSS trust boundary for institution-authored announcement HTML.
// The widget cannot execute under vitest's node environment, so the policy that
// drives it is defined as pure data/functions here and interpolated into the
// widget — exercising it directly is what makes a sanitizer regression fail CI.
describe('account-notifications sanitizer policy', () => {
  describe('sanitizeUrl', () => {
    it('keeps http(s) and mailto links', () => {
      expect(sanitizeUrl('https://example.edu/notice')).toBe('https://example.edu/notice')
      expect(sanitizeUrl('http://example.edu')).toBe('http://example.edu')
      expect(sanitizeUrl('HTTPS://EXAMPLE.EDU')).toBe('HTTPS://EXAMPLE.EDU')
      expect(sanitizeUrl('mailto:help@example.edu')).toBe('mailto:help@example.edu')
    })

    it('trims surrounding whitespace before matching', () => {
      expect(sanitizeUrl('  https://example.edu  ')).toBe('https://example.edu')
    })

    it('drops javascript: URLs regardless of casing or leading whitespace', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
      expect(sanitizeUrl('JavaScript:alert(1)')).toBeNull()
      expect(sanitizeUrl('  javascript:alert(1)')).toBeNull()
      expect(sanitizeUrl('\tjavascript:alert(1)')).toBeNull()
    })

    it('drops data:, vbscript:, file: and other dangerous schemes', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBeNull()
      expect(sanitizeUrl('file:///etc/passwd')).toBeNull()
    })

    it('drops relative and protocol-relative URLs', () => {
      expect(sanitizeUrl('/local/path')).toBeNull()
      expect(sanitizeUrl('//evil.example')).toBeNull()
      expect(sanitizeUrl('not-a-url')).toBeNull()
    })

    it('drops empty/nullish values', () => {
      expect(sanitizeUrl('')).toBeNull()
      expect(sanitizeUrl(null)).toBeNull()
      expect(sanitizeUrl(undefined)).toBeNull()
    })
  })

  describe('classifyTag', () => {
    it('allows inline/structural tags', () => {
      expect(classifyTag('A')).toBe('allow')
      expect(classifyTag('p')).toBe('allow')
      expect(classifyTag('Strong')).toBe('allow')
      expect(classifyTag('UL')).toBe('allow')
    })

    it('drops script/style/embed/form tags entirely', () => {
      expect(classifyTag('SCRIPT')).toBe('drop')
      expect(classifyTag('script')).toBe('drop')
      expect(classifyTag('STYLE')).toBe('drop')
      expect(classifyTag('IFRAME')).toBe('drop')
      expect(classifyTag('IMG')).toBe('drop')
      expect(classifyTag('SVG')).toBe('drop')
    })

    it('unwraps unknown but non-dangerous containers (keeps their text)', () => {
      expect(classifyTag('TABLE')).toBe('unwrap')
      expect(classifyTag('TD')).toBe('unwrap')
      expect(classifyTag('MARQUEE')).toBe('unwrap')
    })

    it('never both allows and drops the same tag', () => {
      for (const tag of ALLOWED_TAGS) {
        expect(DROP_TAGS).not.toContain(tag)
      }
    })

    it('drops the highest-risk script/style/embed tags', () => {
      for (const tag of ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG']) {
        expect(DROP_TAGS).toContain(tag)
      }
    })
  })

  describe('widget wiring', () => {
    it('interpolates the shared policy into the shipped widget', () => {
      // A regression to the policy module changes these strings, so the widget the
      // user runs and the policy these tests verify cannot silently diverge.
      expect(ACCOUNT_NOTIFICATIONS_HTML).toContain(JSON.stringify(DROP_TAGS))
      expect(ACCOUNT_NOTIFICATIONS_HTML).toContain(JSON.stringify(ALLOWED_TAGS))
      expect(ACCOUNT_NOTIFICATIONS_HTML).toContain(JSON.stringify(SAFE_URL_PATTERNS))
      // The widget must build its guard from the shared patterns, not a stray literal.
      expect(ACCOUNT_NOTIFICATIONS_HTML).toContain('SAFE_URL_RES')
    })
  })
})
