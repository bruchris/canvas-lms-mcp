import type { FileSystem } from './io'
import type { ClientDescriptor, PathEnv } from './clients'
import { currentPathEnv } from './clients'
import { mergeJsonConfig, type McpEntry } from './json-merge'
import { mergeTomlConfig } from './toml-merge'

export type { McpEntry }

export interface WriteConfigOptions {
  noBackup?: boolean
  serverName?: string
  pathEnv?: PathEnv
}

export async function writeClientConfigs(
  fs: FileSystem,
  targets: ClientDescriptor[],
  entry: McpEntry,
  opts: WriteConfigOptions = {},
): Promise<void> {
  const env = opts.pathEnv ?? currentPathEnv()
  const serverName = opts.serverName ?? 'canvas-lms'

  for (const target of targets) {
    const configPath = target.resolvePath(env)

    if (target.format === 'toml') {
      await mergeTomlConfig(fs, configPath, target.wrapperKey, serverName, entry, {
        noBackup: opts.noBackup,
      })
    } else {
      await mergeJsonConfig(fs, configPath, target.wrapperKey, serverName, entry, {
        noBackup: opts.noBackup,
      })
    }
  }
}
