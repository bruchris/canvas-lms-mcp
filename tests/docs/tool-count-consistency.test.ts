import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GATED_DESTRUCTIVE_TOOLS } from '../../src/tools/destructive-policy'

const ROOT = resolve(__dirname, '../..')
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/generated/tool-manifest.json'), 'utf8'),
)
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
const indexHtml = readFileSync(resolve(ROOT, 'docs/index.html'), 'utf8')
const educatorGuide = readFileSync(resolve(ROOT, 'docs/educator-guide.md'), 'utf8')
const integrationGuide = readFileSync(resolve(ROOT, 'docs/integration-guide.md'), 'utf8')
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
const WRITE_TOOLS = tools.filter((t) => t.annotations?.readOnlyHint !== true)
const READ_ONLY = tools.filter((t) => t.annotations?.readOnlyHint === true).length
const WRITE = WRITE_TOOLS.length
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

  describe('docs/educator-guide.md', () => {
    it('write-operations reference total count', () => {
      const m = educatorGuide.match(/The server includes (\d+) write tools/)
      expect(m, 'docs/educator-guide.md "The server includes N write tools" not found').toBeTruthy()
      expect(
        Number(m![1]),
        `docs/educator-guide.md write tool count is ${m![1]} but manifest says ${WRITE} — update docs/educator-guide.md`,
      ).toBe(WRITE)
    })

    it.each(WRITE_TOOLS.map((t) => t.name))(
      'write-operations reference table lists `%s`',
      (name) => {
        // Anchor to the table's own "Tool" column (2nd `|`-delimited cell) so a
        // tool can't pass merely by being cross-referenced from a sibling row's
        // "Reversible?" column (e.g. "Yes (call `delete_x`)") — it must have its
        // own dedicated row (BRU-2464).
        const ownRow = new RegExp(`^\\|[^|]*\\|\\s*\`${name}\`\\s*\\|`, 'm')
        expect(
          ownRow.test(educatorGuide),
          `write tool "${name}" is in docs/generated/tool-manifest.json but has no row in the ` +
            'docs/educator-guide.md "Write Operations Reference" section — add an ' +
            `"Operation | \`${name}\` | ... | Reversible?" row to the matching domain table`,
        ).toBe(true)
      },
    )
  })

  describe('docs/integration-guide.md', () => {
    it('registered tool and resource count', () => {
      const m = integrationGuide.match(/all (\d+) tools and (\d+) resources registered/)
      expect(
        m,
        'docs/integration-guide.md "all N tools and N resources registered" not found',
      ).toBeTruthy()
      expect(
        Number(m![1]),
        `docs/integration-guide.md tool count is ${m![1]} but manifest.toolCount is ${TOTAL} — update docs/integration-guide.md`,
      ).toBe(TOTAL)
    })
  })

  describe('docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md', () => {
    it('Totals line matches manifest counts', () => {
      const m = designSpec.match(/\*\*Totals: (\d+) tools \((\d+) read, (\d+) write\)\.\*\*/)
      expect(m, 'design spec "**Totals: N tools (N read, N write).**" line not found').toBeTruthy()
      expect(
        Number(m![1]),
        `design spec Totals line total is ${m![1]} but manifest.toolCount is ${TOTAL} — update the design spec`,
      ).toBe(TOTAL)
      expect(
        Number(m![2]),
        `design spec Totals line read count is ${m![2]} but manifest says ${READ_ONLY} — update the design spec`,
      ).toBe(READ_ONLY)
      expect(
        Number(m![3]),
        `design spec Totals line write count is ${m![3]} but manifest says ${WRITE} — update the design spec`,
      ).toBe(WRITE)
    })

    // BRU-2695: the "Deliberate constraints" bullet read "48 write tools ship,
    // including seven `delete_*` tools" while the CI-gated **Totals:** line in
    // this same file said 50 write — one document disagreeing with itself,
    // because only the Totals line was gated. All three numbers are derived
    // (manifest write count, manifest `delete_*` count, GATED_DESTRUCTIVE_TOOLS
    // size), so this needs no hand-maintained mapping. One `it` per number, so a
    // single wrong number attributes to a single failing test.
    it('Deliberate constraints write-tool count matches the manifest', () => {
      const m = designSpec.match(/(\d+) write tools ship/)
      expect(m, 'design spec "N write tools ship" sentence not found').toBeTruthy()
      expect(
        Number(m![1]),
        `design spec "Deliberate constraints" says ${m![1]} write tools ship but the ` +
          `manifest has ${WRITE} — update the bullet in the design spec`,
      ).toBe(WRITE)
    })

    it('Deliberate constraints `delete_*` count matches the manifest', () => {
      const deleteTools = WRITE_TOOLS.filter((t) => t.name.startsWith('delete_')).length
      const m = designSpec.match(/including (\d+) `delete_\*` tools/)
      expect(m, 'design spec "including N `delete_*` tools" sentence not found').toBeTruthy()
      expect(
        Number(m![1]),
        `design spec says ${m![1]} \`delete_*\` tools but the manifest has ${deleteTools} ` +
          `— update the bullet in the design spec`,
      ).toBe(deleteTools)
    })

    it('Deliberate constraints gated-delete count matches the destructive policy', () => {
      // A safety claim: a reader decides whether `block` covers their risk from
      // this number, so it is gated against the policy itself rather than
      // against another document.
      const m = designSpec.match(/refuse to register (\d+) of those deletes/)
      expect(
        m,
        'design spec "refuse to register N of those deletes" sentence not found',
      ).toBeTruthy()
      expect(
        Number(m![1]),
        `design spec says ${m![1]} deletes are gated but GATED_DESTRUCTIVE_TOOLS has ` +
          `${GATED_DESTRUCTIVE_TOOLS.size} — this is a safety claim; update the design spec`,
      ).toBe(GATED_DESTRUCTIVE_TOOLS.size)
    })

    it('runtime dependency claim matches package.json dependencies', () => {
      const m = designSpec.match(/Runtime dependencies: ([^.]+)\./)
      expect(m, 'design spec "Runtime dependencies: ..." sentence not found').toBeTruthy()
      const specDeps = new Set([...m![1].matchAll(/`([^`]+)`/g)].map((match) => match[1]))
      const pkgDeps = new Set(Object.keys(pkg.dependencies))
      const missing = [...pkgDeps].filter((d) => !specDeps.has(d))
      const extra = [...specDeps].filter((d) => !pkgDeps.has(d))
      expect(
        missing.length === 0 && extra.length === 0,
        `design spec runtime-dependency sentence lists {${[...specDeps].join(', ')}} but ` +
          `package.json dependencies are {${[...pkgDeps].join(', ')}} — missing: [${missing.join(', ')}], ` +
          `extra: [${extra.join(', ')}] — update the design spec`,
      ).toBe(true)
    })
  })
})

describe('design spec tool inventory enumeration', () => {
  // The Totals line and the runtime-dependency sentence are gated above, in the
  // "docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md" describe block.
  // The per-domain inventory tables below are hand-maintained and drift silently
  // when new domains ship (BRU-1882, BRU-1900, BRU-1990). Assert that EVERY tool
  // in the generated manifest is actually enumerated in the spec, so a missing
  // table row fails the build instead of waiting for the next manual scan.
  //
  // BRU-2695: this asserted `designSpec.includes('`name`')` — i.e. anywhere in
  // the file. That was never vacuous (no tool name appeared in prose), but the
  // "v1.0 exclusions" pass now names shipped tools in prose, and under the old
  // form each of those tools' inventory rows could be deleted with CI green
  // purely because the name occurs somewhere else. Every one of the manifest's
  // tools is the FIRST cell of its inventory row, so match that structural form
  // instead; a prose mention cannot satisfy it. This also stays precise when one
  // name is a prefix of another (`list_appointment_groups` vs
  // `list_appointment_group_users`).
  const inventoryFirstCells = new Set(
    designSpec
      .split('\n')
      .filter((line) => line.trimStart().startsWith('|'))
      .map((line) => line.trim().replace(/^\|/, '').split('|')[0].trim()),
  )

  it('anti-vacuity: the spec still has per-domain inventory rows to check against', () => {
    // `it.each([])` registers zero tests and reports green, so the per-tool
    // assertions below are only meaningful while the manifest is populated.
    expect(
      tools.length,
      `only ${tools.length} tools in docs/generated/tool-manifest.json — the per-tool ` +
        `assertions below would register zero cases and pass vacuously`,
    ).toBeGreaterThan(150)

    const toolShaped = [...inventoryFirstCells].filter((cell) => /^`[a-z][a-z0-9_]*`$/.test(cell))
    expect(
      toolShaped.length,
      `only ${toolShaped.length} tool-shaped first cells found in the design spec — the ` +
        `inventory tables or their layout changed, so the per-tool assertions below would ` +
        `be checking an empty or truncated set`,
    ).toBeGreaterThan(150)
  })

  it.each(tools.map((t) => t.name))('design spec per-domain inventory lists `%s`', (name) => {
    expect(
      inventoryFirstCells.has(`\`${name}\``),
      `tool "${name}" is in docs/generated/tool-manifest.json but has no per-domain inventory row in ` +
        `docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md — add a "\`${name}\` | read/write | ..." ` +
        `row to the matching domain table (do NOT edit the CI-gated Totals line). A mention of ` +
        `\`${name}\` in prose does not satisfy this: the name must be the first cell of a table row`,
    ).toBe(true)
  })
})
