import { describe, it, expect } from 'vitest'
import { decodeHtmlEntities } from '../../src/tools/html-entities'

describe('decodeHtmlEntities', () => {
  it('decodes a numeric decimal entity (apostrophe)', () => {
    expect(decodeHtmlEntities('Instructor&#39;s notes')).toBe("Instructor's notes")
  })

  it('decodes the &nbsp; named entity', () => {
    expect(decodeHtmlEntities('Week&nbsp;1 overview')).toBe('Week 1 overview')
  })

  it('decodes a numeric decimal entity for an ampersand inside a URL', () => {
    expect(decodeHtmlEntities('https://x.test/a?b=1&#38;c=2')).toBe('https://x.test/a?b=1&c=2')
  })

  it('decodes the &apos; named entity', () => {
    expect(decodeHtmlEntities('Student&apos;s work')).toBe("Student's work")
  })

  it('does not double-decode a doubly-escaped entity', () => {
    expect(decodeHtmlEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
  })

  it('decodes a hex numeric entity', () => {
    expect(decodeHtmlEntities('&#x6a;avascript')).toBe('javascript')
  })

  it('decodes &lt;, &gt;, and &quot;', () => {
    expect(decodeHtmlEntities('&lt;div&gt; says &quot;hi&quot;')).toBe('<div> says "hi"')
  })

  it('leaves an unrecognized named entity unchanged', () => {
    expect(decodeHtmlEntities('Q&foo; bar')).toBe('Q&foo; bar')
  })

  it('returns the input unchanged when there are no entities', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text')
  })
})
