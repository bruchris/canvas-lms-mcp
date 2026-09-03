import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/generated/tool-manifest.json'), 'utf8'),
)
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
const indexHtml = readFileSync(resolve(ROOT, 'docs/index.html'), 'utf8')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const bundleManifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'))
const serverJson = JSON.parse(readFileSync(resolve(ROOT, 'server.json'), 'utf8'))
const designSpec = readFileSync(
  resolve(ROOT, 'docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md'),
  'utf8',
)

interface ManifestTool {
  name: string
  domain: string
  annotations?: { readOnlyHint?: boolean }
  primaryAudience: 'shared' | 'student' | 'educator' | 'admin'
}

const tools = manifest.tools as ManifestTool[]
const TOTAL = manifest.toolCount as number
const READ_ONLY = tools.filter((t) => t.annotations?.readOnlyHint === true).length
const WRITE = tools.filter((t) => t.annotations?.readOnlyHint !== true).length
const DOMAIN_COUNT = new Set(tools.map((t) => t.domain)).size

// Role visibility mirrors src/tools/roles.ts ROLE_VISIBILITY
const STUDENT_COUNT = tools.filter(
  (t) => t.primaryAudience === 'shared' || t.primaryAudience === 'student',
).length
const TEACHER_COUNT = tools.filter(
  (t) => t.primaryAudience === 'shared' || t.primaryAudience === 'educator',
).length
const ADMIN_COUNT = tools.filter(
  (t) =>
    t.primaryAudience === 'shared' ||
    t.primaryAudience === 'educator' ||
    t.primaryAudience === 'admin',
).length

describe('doc tool-count consistency', () => {
  it('manifest toolCount matches tools.length', () => {
    expect(manifest.tools.length).toBe(TOTAL)
  })

  it('read-only + write equals total', () => {
    expect(
      READ_ONLY + WRITE,
      `manifest read(${READ_ONLY}) + write(${WRITE}) should equal toolCount(${TOTAL})`,
    ).toBe(TOTAL)
  })

  describe('package.json', () => {
    it('description total count', () => {
      const m = pkg.description.match(/(\d+) tools across Canvas/)
      expect(m, 'package.json description "N tools across Canvas" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `package.json description has ${m![1]} but manifest.toolCount is ${TOTAL} — update package.json`,
      ).toBe(TOTAL)
    })
  })

  describe('server.json', () => {
    it('description tool count and domain count', () => {
      const m = serverJson.description.match(/(\d+) tools across (\d+) domains/)
      expect(m, 'server.json description "N tools across N domains" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `server.json description has ${m![1]} but manifest.toolCount is ${TOTAL} — update server.json`,
      ).toBe(TOTAL)
      expect(
        Number(m![2]),
        `server.json description has ${m![2]} domains but manifest has ${DOMAIN_COUNT} distinct domains — update server.json`,
      ).toBe(DOMAIN_COUNT)
    })

    // BRU-2431: server.json drifted to a stale release version for months because
    // nothing asserted it against package.json (unlike manifest.json, see
    // tests/manifest.test.ts). release-please-config.json now carries server.json
    // in extra-files, but this assertion is the CI-enforced backstop that catches
    // it directly if that wiring ever regresses.
    it('top-level version matches package.json', () => {
      expect(
        serverJson.version,
        `server.json version is ${serverJson.version} but package.json is ${pkg.version} — update server.json`,
      ).toBe(pkg.version)
    })

    it('packages[0].version matches package.json', () => {
      expect(
        serverJson.packages[0].version,
        `server.json packages[0].version is ${serverJson.packages[0].version} but package.json is ${pkg.version} — update server.json`,
      ).toBe(pkg.version)
    })
  })

  describe('manifest.json', () => {
    it('description tool count and domain count', () => {
      const m = bundleManifest.description.match(/(\d+) tools across (\d+) domains/)
      expect(m, 'manifest.json description "N tools across N domains" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `manifest.json description has ${m![1]} but manifest.toolCount is ${TOTAL} — update manifest.json`,
      ).toBe(TOTAL)
      expect(
        Number(m![2]),
        `manifest.json description has ${m![2]} domains but manifest has ${DOMAIN_COUNT} distinct domains — update manifest.json`,
      ).toBe(DOMAIN_COUNT)
    })
  })

  describe('README.md', () => {
    it('intro line total count', () => {
      const m = readme.match(/^(\d+) tools across Canvas/m)
      expect(m, 'README.md intro line "N tools across Canvas" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `README.md intro line has ${m![1]} but manifest.toolCount is ${TOTAL} — update README.md`,
      ).toBe(TOTAL)
    })

    it('read/write split sentence', () => {
      const m = readme.match(
        /(\d+) tools are read-only and (\d+) tools perform Canvas write operations/,
      )
      expect(
        m,
        'README.md split sentence "N tools are read-only and N tools perform" not found',
      ).toBeTruthy()
      expect(
        Number(m![1]),
        `README.md read-only count is ${m![1]} but manifest says ${READ_ONLY} — update README.md`,
      ).toBe(READ_ONLY)
      expect(
        Number(m![2]),
        `README.md write count is ${m![2]} but manifest says ${WRITE} — update README.md`,
      ).toBe(WRITE)
    })

    it('role-filter unset/all count', () => {
      const m = readme.match(/\| all \(~(\d+)\)/)
      expect(m, 'README.md role-filter table "| all (~N)" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `README.md role-filter unset count is ${m![1]} but manifest.toolCount is ${TOTAL} — update README.md`,
      ).toBe(TOTAL)
    })

    it('role-filter student count', () => {
      const m = readme.match(/`student` \| ~(\d+)/)
      expect(m, 'README.md role-filter table "`student` | ~N" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `README.md role-filter student count is ${m![1]} but manifest audience sums to ${STUDENT_COUNT} — update README.md`,
      ).toBe(STUDENT_COUNT)
    })

    it('role-filter teacher count', () => {
      const m = readme.match(/`teacher` \| ~(\d+)/)
      expect(m, 'README.md role-filter table "`teacher` | ~N" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `README.md role-filter teacher count is ${m![1]} but manifest audience sums to ${TEACHER_COUNT} — update README.md`,
      ).toBe(TEACHER_COUNT)
    })

    it('role-filter admin count', () => {
      const m = readme.match(/`admin` \| ~(\d+)/)
      expect(m, 'README.md role-filter table "`admin` | ~N" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `README.md role-filter admin count is ${m![1]} but manifest audience sums to ${ADMIN_COUNT} — update README.md`,
      ).toBe(ADMIN_COUNT)
    })
  })

  describe('docs/index.html', () => {
    it('meta description total count', () => {
      const m = indexHtml.match(/content="(\d+) tools across Canvas/)
      expect(
        m,
        'docs/index.html <meta name="description"> "N tools across Canvas" not found',
      ).toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html meta description has ${m![1]} but manifest.toolCount is ${TOTAL} — update docs/index.html`,
      ).toBe(TOTAL)
    })

    it('hero lede total count', () => {
      const m = indexHtml.match(/<p class="lede">(\d+) tools/)
      expect(m, 'docs/index.html hero lede <p class="lede">N tools not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html hero lede has ${m![1]} but manifest.toolCount is ${TOTAL} — update docs/index.html`,
      ).toBe(TOTAL)
    })

    it('ledger-num total count', () => {
      const m = indexHtml.match(/class="ledger-num">(\d+)<small/)
      expect(m, 'docs/index.html .ledger-num "N<small>" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html ledger-num has ${m![1]} but manifest.toolCount is ${TOTAL} — update docs/index.html`,
      ).toBe(TOTAL)
    })

    it('ledger Read-only count', () => {
      const m = indexHtml.match(
        /<span class="k">Read-only<\/span><span class="v">(\d+) tools<\/span>/,
      )
      expect(m, 'docs/index.html ledger Read-only row not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html ledger Read-only has ${m![1]} but manifest says ${READ_ONLY} — update docs/index.html`,
      ).toBe(READ_ONLY)
    })

    it('ledger Write operations count', () => {
      const m = indexHtml.match(
        /<span class="k">Write operations<\/span><span class="v">(\d+) tools<\/span>/,
      )
      expect(m, 'docs/index.html ledger Write operations row not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html ledger Write operations has ${m![1]} but manifest says ${WRITE} — update docs/index.html`,
      ).toBe(WRITE)
    })

    it('role-filter student count', () => {
      const m = indexHtml.match(/students ~?(\d+) tools/)
      expect(m, 'docs/index.html role-filter "students ~N tools" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html role-filter student count is ${m![1]} but manifest audience sums to ${STUDENT_COUNT} — update docs/index.html`,
      ).toBe(STUDENT_COUNT)
    })

    it('role-filter teacher count', () => {
      const m = indexHtml.match(/teachers ~?(\d+)/)
      expect(m, 'docs/index.html role-filter "teachers ~N" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html role-filter teacher count is ${m![1]} but manifest audience sums to ${TEACHER_COUNT} — update docs/index.html`,
      ).toBe(TEACHER_COUNT)
    })

    it('role-filter admin count', () => {
      const m = indexHtml.match(/admins ~?(\d+)/)
      expect(m, 'docs/index.html role-filter "admins ~N" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/index.html role-filter admin count is ${m![1]} but manifest audience sums to ${ADMIN_COUNT} — update docs/index.html`,
      ).toBe(ADMIN_COUNT)
    })
  })
})

describe('design spec tool inventory enumeration', () => {
  // The Totals line in the design spec is already gated above via the manifest,
  // but the per-domain inventory tables are hand-maintained and drift silently
  // when new domains ship (BRU-1882, BRU-1900, BRU-1990). Assert that EVERY tool
  // in the generated manifest is actually enumerated in the spec, so a missing
  // table row fails the build instead of waiting for the next manual scan.
  // Tool names are written in backticks in every inventory row (`tool_name`),
  // so match that exact form — this stays precise even when one name is a prefix
  // of another (e.g. `list_appointment_groups` vs `list_appointment_group_users`).
  it.each(tools.map((t) => t.name))('design spec per-domain inventory lists `%s`', (name) => {
    expect(
      designSpec.includes(`\`${name}\``),
      `tool "${name}" is in docs/generated/tool-manifest.json but has no per-domain inventory row in ` +
        `docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md — add a "\`${name}\` | read/write | ..." ` +
        `row to the matching domain table (do NOT edit the CI-gated Totals line)`,
    ).toBe(true)
  })
})
