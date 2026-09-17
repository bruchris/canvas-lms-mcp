import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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
})
