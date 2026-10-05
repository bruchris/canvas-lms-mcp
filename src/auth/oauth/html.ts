// Consent and error pages for the OAuth profile (design §7.2). Static markup,
// inline styles, no scripts, no external resources; every dynamic value goes
// through `escapeHtml`. The consent page is the confused-deputy control: the
// user sees which client is asking, and exactly where the code will go,
// before this server forwards them to Canvas.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem 1rem; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #f4f5f7; color: #1b1f24; }
  @media (prefers-color-scheme: dark) { body { background: #111417; color: #e6e8eb; } .card { background: #1b1f24 !important; border-color: #2c333b !important; } dd, code { background: #111417 !important; } }
  main { max-width: 32rem; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #d8dde3; border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: .5rem 0; }
  dl { margin: 1rem 0; display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; }
  dt { font-weight: 600; }
  dd { margin: 0; word-break: break-all; }
  code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f0f2f4; padding: .1rem .3rem; border-radius: 4px; }
  ul { margin: .25rem 0 0; padding-left: 1.25rem; }
  .warn { border-left: 4px solid #d97706; padding: .5rem .75rem; background: rgba(217,119,6,.08); border-radius: 6px; }
  .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  button { font: inherit; padding: .6rem 1.1rem; border-radius: 8px; border: 1px solid #c5ccd4; background: #fff; color: inherit; cursor: pointer; }
  button.primary { background: #0f62fe; border-color: #0f62fe; color: #fff; }
  .muted { opacity: .75; font-size: .9rem; }
`

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="card">
${body}
</div>
</main>
</body>
</html>
`
}

export interface ConsentScope {
  name: string
  description: string
}

export interface ConsentPageInput {
  clientName: string
  clientId: string
  /** True when `clientId` is a Client ID Metadata Document URL. */
  clientIdIsUrl: boolean
  redirectUri: string
  redirectHost: string
  isLoopbackRedirect: boolean
  scopes: ConsentScope[]
  canvasHost: string
  /** Form action, relative to the issuer. */
  actionPath: string
  pendingId: string
  csrf: string
}

export function renderConsentPage(input: ConsentPageInput): string {
  const scopeItems = input.scopes
    .map((s) => `<li><code>${escapeHtml(s.name)}</code> — ${escapeHtml(s.description)}</li>`)
    .join('\n')
  const clientIdRow = input.clientIdIsUrl
    ? `<dt>Client metadata</dt><dd><code>${escapeHtml(input.clientId)}</code></dd>`
    : `<dt>Client ID</dt><dd><code>${escapeHtml(input.clientId)}</code></dd>`
  const loopbackNote = input.isLoopbackRedirect
    ? `<p class="warn">The code will be delivered to a program on <strong>this computer</strong> (<code>${escapeHtml(input.redirectHost)}</code>). Only continue if you started this login yourself, just now.</p>`
    : `<p class="warn">The code will be sent to <strong>${escapeHtml(input.redirectHost)}</strong>. Only continue if you recognise that address.</p>`
  const body = `
<h1>Connect ${escapeHtml(input.clientName)} to Canvas?</h1>
<p><strong>${escapeHtml(input.clientName)}</strong> is asking to use your Canvas account at <code>${escapeHtml(input.canvasHost)}</code> through this MCP server.</p>
<dl>
${clientIdRow}
<dt>Redirect URI</dt><dd><code>${escapeHtml(input.redirectUri)}</code></dd>
<dt>Access requested</dt><dd><ul>${scopeItems}</ul></dd>
</dl>
${loopbackNote}
<p class="muted">Next, Canvas will ask you to sign in and confirm. Canvas never shares your password with this server, and this server never shares your Canvas token with ${escapeHtml(input.clientName)}.</p>
<form method="post" action="${escapeHtml(input.actionPath)}">
<input type="hidden" name="pending" value="${escapeHtml(input.pendingId)}">
<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
<div class="actions">
<button class="primary" type="submit" name="decision" value="allow">Continue to Canvas</button>
<button type="submit" name="decision" value="deny">Cancel</button>
</div>
</form>
`
  return page('Connect to Canvas', body)
}

export interface ErrorPageInput {
  title: string
  message: string
}

export function renderErrorPage(input: ErrorPageInput): string {
  return page(
    input.title,
    `<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(input.message)}</p>
<p class="muted">You can close this window and start the login again from your MCP client.</p>`,
  )
}
