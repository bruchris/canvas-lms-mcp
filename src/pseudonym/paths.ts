// Cross-platform path resolution for the pseudonym map directory.
//
// Override: `CANVAS_PSEUDONYM_DIR` (absolute path).
// Default:
//   - Linux:   `${XDG_DATA_HOME:-~/.local/share}/canvas-lms-mcp/pseudonyms`
//   - macOS:   `~/Library/Application Support/canvas-lms-mcp/pseudonyms`
//   - Windows: `%APPDATA%\canvas-lms-mcp\pseudonyms` (falls back to `%USERPROFILE%\AppData\Roaming\...`)
// Inside the chosen directory the layout is `<host>/<course_id>.json`.

import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_NAME = 'canvas-lms-mcp'
const PSEUDONYMS_SUBDIR = 'pseudonyms'

export interface ResolvePathsEnv {
  CANVAS_PSEUDONYM_DIR?: string
  XDG_DATA_HOME?: string
  APPDATA?: string
  USERPROFILE?: string
  HOME?: string
}

/**
 * Resolve the directory that holds pseudonym maps.
 *
 * Honors `CANVAS_PSEUDONYM_DIR` when set; otherwise uses the platform default.
 * Pass an explicit `platform`/`env` for tests; defaults to the current process.
 */
export function resolvePseudonymDir(
  options: { platform?: NodeJS.Platform; env?: ResolvePathsEnv; home?: string } = {},
): string {
  const env = options.env ?? (process.env as ResolvePathsEnv)
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()

  const override = env.CANVAS_PSEUDONYM_DIR
  if (override && override.length > 0) {
    return override
  }

  if (platform === 'win32') {
    const appData =
      env.APPDATA ?? (env.USERPROFILE ? join(env.USERPROFILE, 'AppData', 'Roaming') : null)
    const base = appData ?? join(home, 'AppData', 'Roaming')
    return join(base, APP_NAME, PSEUDONYMS_SUBDIR)
  }

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', APP_NAME, PSEUDONYMS_SUBDIR)
  }

  const xdg = env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(home, '.local', 'share')
  return join(base, APP_NAME, PSEUDONYMS_SUBDIR)
}

/**
 * Normalize a Canvas base URL into a filesystem-safe host identifier.
 * Lower-cases, strips port, strips path. Returns null for unparseable URLs.
 */
export function normalizeHost(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl)
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Full path to the map file for a (host, course_id) pair.
 */
export function mapFilePath(rootDir: string, host: string, courseId: number | string): string {
  return join(rootDir, host, `${courseId}.json`)
}

/**
 * Full path to the cross-course conversations map.
 */
export function conversationsFilePath(rootDir: string, host: string): string {
  return join(rootDir, host, '_conversations.json')
}
