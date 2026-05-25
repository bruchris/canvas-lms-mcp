import { posix, win32 } from 'node:path'
import TOML from '@iarna/toml'
import type { FileSystem } from './io'
import type { McpEntry } from './json-merge'

function dirOf(path: string): string {
  return path.includes('\\') ? win32.dirname(path) : posix.dirname(path)
}

export async function mergeTomlConfig(
  fs: FileSystem,
  path: string,
  wrapperKey: string,
  serverName: string,
  entry: McpEntry,
  opts: { noBackup?: boolean } = {},
): Promise<void> {
  const exists = await fs.exists(path)
  let config: TOML.JsonMap = {}

  if (exists) {
    const raw = await fs.readFile(path)
    config = TOML.parse(raw)
  }

  const wrapper = config[wrapperKey]
  config[wrapperKey] = {
    ...(typeof wrapper === 'object' && wrapper !== null && !Array.isArray(wrapper)
      ? (wrapper as TOML.JsonMap)
      : {}),
    [serverName]: entry as unknown as TOML.AnyJson,
  }

  const updated = TOML.stringify(config)
  const tmpPath = `${path}.tmp`

  await fs.mkdir(dirOf(path), { recursive: true })

  if (exists && !opts.noBackup) {
    await fs.copyFile(path, `${path}.bak`)
  }

  await fs.writeFile(tmpPath, updated)
  await fs.rename(tmpPath, path)
}
