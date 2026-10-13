import { describe, expect, it } from 'vitest'
import { escapeHtml, renderConsentPage, renderErrorPage } from '../../../src/auth/oauth/html'

describe('OAuth HTML pages (#302 §7.2)', () => {
  it('escapeHtml neutralises the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  const input = {
    clientName: 'Codex <script>alert(1)</script>',
    clientId: 'https://chatgpt.com/oauth/codex/abc/client.json',
    clientIdIsUrl: true,
    redirectUri: 'http://127.0.0.1:53117/callback?x="y"',
    redirectHost: '127.0.0.1:53117',
    isLoopbackRedirect: true,
    scopes: [{ name: 'canvas:read', description: 'read <things>' }],
    canvasHost: 'school.instructure.com',
    actionPath: '/oauth/authorize/continue',
    pendingId: 'pend"ing',
    csrf: 'cs<rf',
  }

  it('renders the consent page with every dynamic value escaped', () => {
    const html = renderConsentPage(input)
    expect(html).not.toContain('<script>')
    expect(html).toContain('Codex &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('https://chatgpt.com/oauth/codex/abc/client.json')
    expect(html).toContain('http://127.0.0.1:53117/callback?x=&quot;y&quot;')
    expect(html).toContain('value="pend&quot;ing"')
    expect(html).toContain('value="cs&lt;rf"')
    expect(html).toContain('read &lt;things&gt;')
    expect(html).toContain('school.instructure.com')
  })

  it('names the client, the redirect host, and the Canvas host, and warns about loopback delivery', () => {
    const html = renderConsentPage(input)
    expect(html).toContain('Client metadata')
    expect(html).toContain('this computer')
    expect(html).toContain('127.0.0.1:53117')
    expect(html).toContain('action="/oauth/authorize/continue"')
    expect(html).toContain('name="decision" value="allow"')
    expect(html).toContain('name="decision" value="deny"')
    expect(html).toContain('method="post"')
  })

  it('uses the plain client-id label and the remote-host warning for non-CIMD, non-loopback clients', () => {
    const html = renderConsentPage({
      ...input,
      clientIdIsUrl: false,
      clientId: 'portal',
      redirectUri: 'https://portal.example.edu/cb',
      redirectHost: 'portal.example.edu',
      isLoopbackRedirect: false,
    })
    expect(html).toContain('Client ID')
    expect(html).not.toContain('this computer')
    expect(html).toContain('<strong>portal.example.edu</strong>')
  })

  it('carries no scripts or external resources (CSP default-src none is enforceable)', () => {
    const html = renderConsentPage(input) + renderErrorPage({ title: 't', message: 'm' })
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/src=|href=/i)
  })

  it('renders an escaped error page', () => {
    const html = renderErrorPage({ title: 'Oops <b>', message: 'Bad & worse' })
    expect(html).toContain('<h1>Oops &lt;b&gt;</h1>')
    expect(html).toContain('Bad &amp; worse')
  })
})
