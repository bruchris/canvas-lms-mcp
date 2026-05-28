import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))

describe('manifest.json (.mcpb bundle)', () => {
  it('has required top-level fields', () => {
    expect(manifest.manifest_version).toBeTypeOf('string')
    expect(manifest.name).toBe('canvas-lms-mcp')
    expect(manifest.version).toBe(pkg.version)
    expect(manifest.description).toBeTypeOf('string')
    expect(manifest.author?.name).toBeTypeOf('string')
  })

  it('keeps description within the 100-char MCP Registry limit', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(100)
  })

  it('declares CANVAS_API_TOKEN and CANVAS_BASE_URL as required user_config', () => {
    expect(manifest.user_config.canvas_api_token).toMatchObject({ required: true, sensitive: true })
    expect(manifest.user_config.canvas_base_url).toMatchObject({ required: true })
  })

  it('forwards user_config into mcp_config env vars', () => {
    expect(manifest.server.mcp_config.env.CANVAS_API_TOKEN).toBe('${user_config.canvas_api_token}')
    expect(manifest.server.mcp_config.env.CANVAS_BASE_URL).toBe('${user_config.canvas_base_url}')
  })

  it('targets dist/stdio.js as the node entry point', () => {
    expect(manifest.server.type).toBe('node')
    expect(manifest.server.entry_point).toBe('dist/stdio.js')
    expect(manifest.server.mcp_config.command).toBe('node')
    expect(manifest.server.mcp_config.args).toContain('${__dirname}/dist/stdio.js')
  })

  it('supports darwin, win32, and linux', () => {
    expect(manifest.compatibility.platforms).toEqual(
      expect.arrayContaining(['darwin', 'win32', 'linux']),
    )
  })
})
