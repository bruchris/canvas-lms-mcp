import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Drift guard (BRU-1985) — mirrors tests/docs/tool-count-consistency.test.ts.
//
// `CANVAS_BASE_URL` must be the Canvas instance ORIGIN only (e.g.
// `https://school.instructure.com`). The Canvas client embeds `/api/v1` in every
// endpoint path (see src/canvas/*.ts) and only strips trailing slashes from the
// base URL (src/canvas/client.ts) — it does NOT de-duplicate `/api/v1`. So a
// documented example ending in `/api/v1` makes every request hit
// `/api/v1/api/v1/...`, which 404s and surfaces as the misleading
// "…not found — check the ID" error. This test fails if any user-facing config
// surface documents a base-URL example with an `/api/v1` suffix.

const ROOT = resolve(__dirname, '../..')

// Matches a documented Canvas base-URL example that wrongly ends in `/api/v1`,
// e.g. `school.instructure.com/api/v1` or `your-school.instructure.com/api/v1`.
// Deliberately host-adjacent so clarifying prose like "do not append `/api/v1`"
// does not trip the guard.
const BAD_BASE_URL = /[a-z0-9-]*\.instructure\.com\/api\/v1/i

const serverJson = JSON.parse(readFileSync(resolve(ROOT, 'server.json'), 'utf8'))
const bundleManifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'))

/** Recursively find the first object with `name === 'CANVAS_BASE_URL'`. */
function findEnvVar(node: unknown): { description?: string } | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findEnvVar(item)
      if (found) return found
    }
    return undefined
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj.name === 'CANVAS_BASE_URL') return obj as { description?: string }
    for (const value of Object.values(obj)) {
      const found = findEnvVar(value)
      if (found) return found
    }
  }
  return undefined
}

describe('CANVAS_BASE_URL is documented origin-only', () => {
  it('server.json CANVAS_BASE_URL description has no /api/v1 suffix', () => {
    const envVar = findEnvVar(serverJson)
    expect(envVar, 'server.json has no CANVAS_BASE_URL environment variable entry').toBeTruthy()
    expect(
      envVar!.description ?? '',
      'server.json CANVAS_BASE_URL description documents an /api/v1 suffix — it must be origin-only',
    ).not.toMatch(BAD_BASE_URL)
  })

  it('manifest.json canvas_base_url description has no /api/v1 suffix', () => {
    const description = bundleManifest.user_config?.canvas_base_url?.description ?? ''
    expect(
      description,
      'manifest.json canvas_base_url description documents an /api/v1 suffix — it must be origin-only',
    ).not.toMatch(BAD_BASE_URL)
  })

  it.each(['README.md', 'AGENTS.md', '.claude/CLAUDE.md'])(
    '%s documents no /api/v1 base-URL example',
    (file) => {
      const contents = readFileSync(resolve(ROOT, file), 'utf8')
      expect(
        contents,
        `${file} documents a Canvas base-URL example ending in /api/v1 — CANVAS_BASE_URL must be origin-only`,
      ).not.toMatch(BAD_BASE_URL)
    },
  )
})
