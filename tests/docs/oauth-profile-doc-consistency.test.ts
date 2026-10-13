import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
// tree drawing. Both directions are checked below, each by its own assertion:
// spec -> repo (the block cannot name a path that does not exist) for every row,
// and repo -> spec (a path cannot exist without a row) for the top level of
// `src/`.
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

    // BRU-2681: widened from src/-only to the whole block. The two non-src/
    // entries this gate used to exempt (`.claude/skills/`, `.agents/`)
    // described dev-team skills that were planned on 2026-04-12 and never
    // built; they are gone from the block, and `skills/` + `.claude-plugin/`
    // -- which do exist and are load-bearing, since the plugin manifest is
    // what gates the shipped skill count -- are now in it. Nothing in the
    // block is exempt any more.
    it('lists no file or directory that is absent from the repo', () => {
      const paths = layoutBlockPaths(designSpec)
      // Anti-vacuity: a parser that silently stopped resolving, or a filter
      // that matched nothing, would satisfy the existence check with an
      // empty list. The two halves get separate floors so that a re-narrowing
      // of either one fails on its own assertion. The src/ floor dropped from
      // 40 to 20 with BRU-2822, which trimmed `src/canvas/`, `src/tools/` and
      // `src/resources/` from near-exhaustive enumerations down to a handful
      // of representative rows each (see the "representative, not exhaustive"
      // describe block below) -- >20 still fails on a parser that resolved
      // only the top level. >30 outside src/ is unchanged from BRU-2673.
      const src = paths.filter((p) => p.startsWith('canvas-lms-mcp/src/'))
      const nonSrc = paths.filter((p) => !p.startsWith('canvas-lms-mcp/src/'))
      expect(src.length).toBeGreaterThan(20)
      expect(nonSrc.length).toBeGreaterThan(30)
      for (const known of [
        'canvas-lms-mcp/src/server.ts',
        'canvas-lms-mcp/src/auth/oauth',
        'canvas-lms-mcp/skills',
        'canvas-lms-mcp/.claude-plugin/plugin.json',
        'canvas-lms-mcp/README.md',
      ]) {
        expect(paths, `parser did not reach ${known}`).toContain(known)
      }
      // The trailing slash is optional so that the root line of the block
      // (`canvas-lms-mcp/`) resolves to the repo root itself.
      const missing = paths.filter(
        (p) => !existsSync(resolve(ROOT, p.replace(/^canvas-lms-mcp\/?/, ''))),
      )
      expect(missing).toEqual([])
    })

    // BRU-2818: the inverse direction. Everything above walks spec -> repo, so a
    // directory that shipped *without* being added to the block passed silently
    // for as long as it existed -- `src/pseudonym/` went unlisted from 1.17.0
    // until this gate, and ten more entries had accumulated behind it. Same
    // drift class as BRU-2673, same root cause: a surface the gate could not see.
    //
    // Scoped to the top level of `src/`. BRU-2820 judged the block's deeper
    // enumerations (`src/canvas/`, `src/tools/`, `src/resources/`, `src/auth/`)
    // to be an architectural map rather than a file inventory; BRU-2822 made
    // that explicit by trimming them to representative rows (see below) instead
    // of widening this assertion to match them.
    it('names every top-level entry under src/ as a row of the layout block', () => {
      const paths = new Set(layoutBlockPaths(designSpec))
      const entries = readdirSync(resolve(ROOT, 'src')).sort()
      // Anti-vacuity for *this* direction. The two floors above constrain the
      // spec side; neither can catch a `readdir` that resolved nothing, which
      // would satisfy the set difference below with an empty subject.
      expect(entries.length).toBeGreaterThan(15)
      const unlisted = entries.filter((name) => !paths.has(`canvas-lms-mcp/src/${name}`))
      expect(unlisted).toEqual([])
    })

    // BRU-2822: makes the top-level -> spec check itself falsifiable, since the
    // real repo currently happening to have a row for every top-level entry
    // would otherwise let the assertion above go quietly vacuous forever. A
    // synthetic repo listing with one injected top-level name absent from the
    // spec's path set must still be caught by the same set-difference the test
    // above runs against the real repo.
    it('the top-level set-difference catches an entry the block does not list', () => {
      const paths = new Set(layoutBlockPaths(designSpec))
      const entries = [...readdirSync(resolve(ROOT, 'src')).sort(), 'not-a-real-top-level-dir']
      const unlisted = entries.filter((name) => !paths.has(`canvas-lms-mcp/src/${name}`))
      expect(unlisted).toEqual(['not-a-real-top-level-dir'])
    })
  })

  // BRU-2822: Option B from BRU-2820. `src/canvas/`, `src/tools/` and
  // `src/resources/` keep a handful of child rows, same as `src/auth/oauth/`
  // and the newer top-level directories above them -- but the block no longer
  // claims those rows are the complete contents of each domain.
  describe('depth-2 enumerations are representative, not exhaustive (BRU-2822)', () => {
    it('says so in the prose next to the layout block', () => {
      expect(designSpec).toContain('src/tools/')
      expect(designSpec).toContain('src/canvas/')
      expect(designSpec).toContain('src/resources/')
      expect(designSpec).toContain('representative sample')
      expect(designSpec).toContain('not an exhaustive listing')
    })

    // Criterion 2: a new domain file under a representative directory is not a
    // doc-gate failure. Proven against the real repo rather than a fixture, so
    // it stays true as `src/tools/` and `src/canvas/` grow: each already holds
    // a file the block's representative rows do not name, and the gate above
    // only walks spec -> repo, never the reverse at this depth.
    it('src/tools/ and src/canvas/ each already contain a file the block does not list', () => {
      const listed = new Set(layoutBlockPaths(designSpec))
      for (const dir of ['tools', 'canvas']) {
        const realFiles = readdirSync(resolve(ROOT, 'src', dir))
        const unlistedReal = realFiles.filter(
          (name) => !listed.has(`canvas-lms-mcp/src/${dir}/${name}`),
        )
        expect(
          unlistedReal.length,
          `expected src/${dir}/ to outgrow its sample rows`,
        ).toBeGreaterThan(0)
      }
    })

    // Criterion 3: the spec -> repo assertion still walks every depth, so a
    // representative row naming a path that does not exist is still a failure
    // -- trimming the enumeration did not also narrow the direction that is
    // still checked. Run against a synthetic fence block, independent of
    // whatever the real spec happens to contain, so this cannot pass by luck.
    it('a representative child row naming a nonexistent path still fails spec -> repo', () => {
      const fixture = [
        '```',
        'canvas-lms-mcp/',
        '├── src/',
        '│   ├── tools/                     # representative sample, not exhaustive',
        '│   │   ├── courses.ts',
        '│   │   └── not-a-real-tool-file.ts',
        '```',
        '',
      ].join('\n')
      const paths = layoutBlockPaths(fixture)
      const missing = paths.filter(
        (p) => !existsSync(resolve(ROOT, p.replace(/^canvas-lms-mcp\/?/, ''))),
      )
      expect(missing).toEqual(['canvas-lms-mcp/src/tools/not-a-real-tool-file.ts'])
    })
  })
})
