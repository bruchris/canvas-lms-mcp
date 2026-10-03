import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OAUTH_ENV_VARS } from '../../src/auth/oauth/config'
import { AUTH_PROFILES } from '../../src/auth/profile'

// Drift guard (#302) — mirrors tests/docs/destructive-tools-doc-consistency.test.ts.
//
// The OAuth profile is configured entirely through environment variables and
// three flags. A variable the code reads but the docs do not name is a
// deployment that fails at startup with no page to turn to, so every one of
// them must appear in both the README reference tables and the OAuth guide.

const ROOT = resolve(__dirname, '../..')
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
const guide = readFileSync(resolve(ROOT, 'docs/oauth-profile.md'), 'utf8')
const manualSetup = readFileSync(resolve(ROOT, 'docs/manual-setup.md'), 'utf8')
const designSpec = readFileSync(
  resolve(ROOT, 'docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md'),
  'utf8',
)

// Reconstructs every path in the design spec's directory-layout block from the
// tree drawing, so the block cannot name a file that does not exist. This is a
// one-directional check: it catches a *false* entry, never a missing one.
function layoutBlockPaths(spec: string): string[] {
  const lines = spec.split('\n')
  const open = lines.findIndex((l, n) => l.startsWith('```') && lines[n + 1] === 'canvas-lms-mcp/')
  if (open < 0) throw new Error('design spec: directory-layout block not found')
  const close = lines.findIndex((l, n) => n > open && l.startsWith('```'))
  const stack: string[] = []
  const paths: string[] = []
  for (const line of lines.slice(open + 1, close)) {
    const m = /^([\s│├└─]*)(\S.*?)(\s{2,}#.*)?$/.exec(line)
    if (!m) continue
    const name = m[2].trim()
    if (!name) continue
    const depth = Math.floor(m[1].replace(/[├└─]/g, ' ').length / 4)
    stack.length = depth
    stack.push(name.replace(/\/$/, ''))
    paths.push(stack.join('/'))
  }
  return paths
}

describe('OAuth profile documentation', () => {
  it('README documents every OAuth environment variable in its reference table', () => {
    const undocumented = OAUTH_ENV_VARS.filter((name) => !readme.includes(`\`${name}\``))
    expect(undocumented).toEqual([])
  })

  it('the OAuth guide documents every OAuth environment variable', () => {
    const undocumented = OAUTH_ENV_VARS.filter((name) => !guide.includes(`\`${name}\``))
    expect(undocumented).toEqual([])
  })

  it('README documents the profile flags and the doctor command', () => {
    for (const flag of ['`--auth-profile`', '`--host`', '`--issuer`', '`doctor`']) {
      expect(readme, `README is missing ${flag}`).toContain(flag)
    }
  })

  it('names all three profiles and links the guide from the README', () => {
    for (const profile of AUTH_PROFILES) {
      expect(readme).toContain(`\`${profile}\``)
      expect(guide).toContain(`\`${profile}\``)
    }
    expect(readme).toContain('docs/oauth-profile.md')
  })

  it('covers the acceptance-criteria surfaces: Codex login, stdio limitation, Developer Key, verification matrix', () => {
    expect(guide).toContain('codex mcp login')
    expect(guide).toContain('config.toml')
    expect(guide).toContain('Auth Unsupported')
    expect(guide).toContain('Developer Key')
    expect(guide).toContain('/oauth/canvas/callback')
    expect(guide).toContain('## Manual verification matrix')
    expect(guide).toContain('X-Canvas-Token')
    expect(manualSetup).toContain('codex mcp login')
  })

  // BRU-2673: this guard shipped with #356 and covered the README, the OAuth
  // guide and manual-setup — but not the top-level architecture spec. That
  // omission is why the design spec's auth section sat four months stale,
  // naming two files (`src/auth/token.ts`, `src/auth/oauth.ts`) that never
  // existed. The design spec is now a guarded surface too.
  describe('design spec', () => {
    it('names every auth profile', () => {
      for (const profile of AUTH_PROFILES) {
        expect(designSpec, `design spec is missing ${profile}`).toContain(`\`${profile}\``)
      }
    })

    it('reaches the auth-modes spec and the OAuth guide in one hop', () => {
      expect(designSpec).toContain('2026-04-22-canvas-authentication-modes.md')
      expect(designSpec).toContain('oauth-profile.md')
    })

    // Scoped to src/ deliberately. That is the architecture surface this spec
    // exists to describe, and it is what BRU-2673's acceptance criteria name.
    // The block's non-src/ entries are NOT yet gated because two of them
    // (`.claude/skills/`, `.agents/`) describe dev-team skills that were
    // planned and never built — a separate drift with its own call to make,
    // tracked rather than quietly rewritten here.
    it('lists no src/ file or directory that is absent from the repo', () => {
      const paths = layoutBlockPaths(designSpec).filter((p) => p.startsWith('canvas-lms-mcp/src/'))
      // Anti-vacuity: a parser that silently stopped resolving, or a filter
      // that matched nothing, would satisfy the existence check with an
      // empty list.
      expect(paths.length).toBeGreaterThan(40)
      for (const known of ['canvas-lms-mcp/src/server.ts', 'canvas-lms-mcp/src/auth/oauth']) {
        expect(paths, `parser did not reach ${known}`).toContain(known)
      }
      const missing = paths.filter(
        (p) => !existsSync(resolve(ROOT, p.replace(/^canvas-lms-mcp\//, ''))),
      )
      expect(missing).toEqual([])
    })
  })
})
