import { posix, win32 } from 'node:path'
import type { FileSystem } from './io'

export interface McpEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

function dirOf(path: string): string {
  return path.includes('\\') ? win32.dirname(path) : posix.dirname(path)
}

export async function mergeJsonConfig(
  fs: FileSystem,
  path: string,
  wrapperKey: string,
  serverName: string,
  entry: McpEntry,
  opts: { noBackup?: boolean } = {},
): Promise<void> {
  const exists = await fs.exists(path)
  let config: Record<string, unknown> = {}

  if (exists) {
    const raw = await fs.readFile(path)
    config = JSON.parse(raw) as Record<string, unknown>
  }

  const wrapper = config[wrapperKey]
  config[wrapperKey] = {
    ...(typeof wrapper === 'object' && wrapper !== null
      ? (wrapper as Record<string, unknown>)
      : {}),
    [serverName]: entry,
  }

  const updated = `${JSON.stringify(config, null, 2)}\n`
  const tmpPath = `${path}.tmp`

  await fs.mkdir(dirOf(path), { recursive: true })

  if (exists && !opts.noBackup) {
    await fs.copyFile(path, `${path}.bak`)
  }

  await fs.writeFile(tmpPath, updated)
  await fs.rename(tmpPath, path)
}
