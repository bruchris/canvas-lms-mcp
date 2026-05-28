#!/usr/bin/env node
// Packs an .mcpb bundle for one-click install in Claude Desktop / Claude Code / MCP for Windows.
//
// Steps:
//   1. Sync manifest.json `version` from package.json.
//   2. Stage manifest.json, dist/, a slimmed package.json, and LICENSE into a temp dir.
//   3. Install production-only dependencies into the staging dir (flat node_modules).
//   4. Invoke `mcpb pack` against the staging dir; output canvas-lms-mcp.mcpb at repo root.
//   5. Fail loudly if the output is missing or empty.
//
// Local usage:   pnpm build && pnpm mcpb:pack
// CI usage:      release workflow runs this on tagged releases.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const STAGING_DIR = resolve(REPO_ROOT, '.mcpb-staging')
const OUTPUT_FILE = resolve(REPO_ROOT, 'canvas-lms-mcp.mcpb')
const MANIFEST_PATH = resolve(REPO_ROOT, 'manifest.json')
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, 'package.json')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`)
  }
}

function syncManifestVersion(version) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (manifest.version !== version) {
    manifest.version = version
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(`manifest.json version synced to ${version}`)
  }
  return manifest
}

function buildStaging(pkg, manifest) {
  if (existsSync(STAGING_DIR)) rmSync(STAGING_DIR, { recursive: true, force: true })
  mkdirSync(STAGING_DIR, { recursive: true })

  writeFileSync(resolve(STAGING_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const distSrc = resolve(REPO_ROOT, 'dist')
  if (!existsSync(distSrc)) {
    throw new Error('dist/ not found — run `pnpm build` before packing.')
  }
  cpSync(distSrc, resolve(STAGING_DIR, 'dist'), { recursive: true })

  const licenseSrc = resolve(REPO_ROOT, 'LICENSE')
  if (existsSync(licenseSrc)) cpSync(licenseSrc, resolve(STAGING_DIR, 'LICENSE'))

  const stagedPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: 'dist/stdio.js',
    license: pkg.license,
    dependencies: pkg.dependencies ?? {},
  }
  writeFileSync(resolve(STAGING_DIR, 'package.json'), `${JSON.stringify(stagedPkg, null, 2)}\n`, 'utf8')
}

function installProductionDeps() {
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', '--no-package-lock'], {
    cwd: STAGING_DIR,
  })
}

function packBundle() {
  run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'pack', STAGING_DIR, OUTPUT_FILE])

  if (!existsSync(OUTPUT_FILE)) {
    throw new Error(`mcpb pack did not produce ${OUTPUT_FILE}`)
  }
  const { size } = statSync(OUTPUT_FILE)
  if (size <= 0) {
    throw new Error(`${OUTPUT_FILE} is empty (0 bytes)`)
  }
  const sizeMb = (size / (1024 * 1024)).toFixed(2)
  console.log(`Packed ${OUTPUT_FILE} (${sizeMb} MB)`)
}

function main() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'))
  const manifest = syncManifestVersion(pkg.version)
  buildStaging(pkg, manifest)
  installProductionDeps()
  packBundle()
  rmSync(STAGING_DIR, { recursive: true, force: true })
}

main()
