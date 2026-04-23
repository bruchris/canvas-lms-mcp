#!/usr/bin/env tsx
/**
 * Canvas OpenAPI → TypeScript types generation pipeline (prototype).
 *
 * Pulls spec/canvas/prototype.yaml, merges every overlay in
 * spec/canvas/overrides/*.yaml on top of it, and runs openapi-typescript
 * to emit src/canvas/generated/types.ts.
 *
 * Keep this script small. When the migration fans out beyond `users`,
 * switch the merge step to `@redocly/cli bundle` (it's already a
 * transitive dep of openapi-typescript). For one domain it's overkill.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import openapiTS, { astToString } from 'openapi-typescript'
import prettier from 'prettier'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(__filename), '..', '..')

const SPEC_PATH = join(repoRoot, 'spec', 'canvas', 'prototype.yaml')
const OVERRIDES_DIR = join(repoRoot, 'spec', 'canvas', 'overrides')
const OUTPUT_PATH = join(repoRoot, 'src', 'canvas', 'generated', 'types.ts')

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * This file is produced by scripts/canvas-spec/generate.ts from the
 * hand-authored prototype spec in spec/canvas/prototype.yaml, with
 * overlays from spec/canvas/overrides/*.yaml applied on top.
 *
 * To regenerate:
 *
 *   pnpm canvas:spec:generate
 *
 * The generated types stay license-clean because the source spec is
 * hand-authored from public Canvas API documentation. When the license
 * decision from issue #78 is resolved and the full Canvas spec is wired
 * in as the source, this banner should be revisited.
 */

/* prettier-ignore */
`

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge two OpenAPI fragments.
 *
 * - Plain objects merge recursively.
 * - Arrays of objects at the `parameters` key merge by `name + in`
 *   (so an overlay can patch a single parameter without listing them all).
 * - All other arrays replace wholesale, which is what enum overlays want.
 */
function mergeSpec<T>(base: T, overlay: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return (overlay ?? base) as T
  }
  const result: Record<string, unknown> = { ...base }
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = (base as Record<string, unknown>)[key]
    if (key === 'parameters' && Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      result[key] = mergeParameterArray(baseValue, overlayValue)
      continue
    }
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = mergeSpec(baseValue, overlayValue)
      continue
    }
    result[key] = overlayValue
  }
  return result as T
}

function mergeParameterArray(
  base: unknown[],
  overlay: unknown[],
): unknown[] {
  const identity = (p: unknown): string | null => {
    if (!isPlainObject(p)) return null
    const name = typeof p.name === 'string' ? p.name : null
    const location = typeof p.in === 'string' ? p.in : null
    if (!name || !location) return null
    return `${location}:${name}`
  }
  const result: unknown[] = [...base]
  for (const overlayParam of overlay) {
    const id = identity(overlayParam)
    if (!id) {
      result.push(overlayParam)
      continue
    }
    const idx = result.findIndex((p) => identity(p) === id)
    if (idx === -1) {
      result.push(overlayParam)
    } else {
      result[idx] = mergeSpec(result[idx], overlayParam)
    }
  }
  return result
}

function loadYaml(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'))
}

function loadOverlays(dir: string): unknown[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => loadYaml(join(dir, f)))
}

async function main() {
  const source = loadYaml(SPEC_PATH)
  const overlays = loadOverlays(OVERRIDES_DIR)
  const merged = overlays.reduce((acc, overlay) => mergeSpec(acc, overlay), source)

  const ast = await openapiTS(merged as Parameters<typeof openapiTS>[0], {
    immutable: true,
  })
  const raw = BANNER + astToString(ast) + '\n'

  const prettierConfig = (await prettier.resolveConfig(OUTPUT_PATH)) ?? {}
  const contents = await prettier.format(raw, { ...prettierConfig, parser: 'typescript' })

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, contents, 'utf8')

  const overlayCount = overlays.length
  console.log(
    `Generated ${OUTPUT_PATH} (${overlayCount} overlay${overlayCount === 1 ? '' : 's'} applied).`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
