import {
  copyFile as fsCopyFile,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import { dirname, posix as posixPath, win32 as winPath } from 'node:path'

export interface FileSystem {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  copyFile(src: string, dest: string): Promise<void>
  rename(src: string, dest: string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
}

export const nodeFileSystem: FileSystem = {
  async exists(path) {
    try {
      await fsReadFile(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      // Permission errors etc. mean the file is there but we can't read it —
      // surface as "exists" so callers don't try to overwrite it blindly.
      return true
    }
  },
  readFile: (path) => fsReadFile(path, 'utf8'),
  writeFile: (path, data) => fsWriteFile(path, data, 'utf8'),
  copyFile: (src, dest) => fsCopyFile(src, dest),
  rename: (src, dest) => fsRename(src, dest),
  mkdir: async (path, opts) => {
    await fsMkdir(path, { recursive: opts?.recursive ?? true })
  },
}

export interface MemoryFileSystem extends FileSystem {
  files: Map<string, string>
  has(path: string): boolean
  reset(): void
}

const memoryDirname = (path: string): string =>
  path.includes('\\') ? winPath.dirname(path) : posixPath.dirname(path)

export function createMemoryFileSystem(initial?: Record<string, string>): MemoryFileSystem {
  const files = new Map<string, string>(initial ? Object.entries(initial) : [])
  const dirs = new Set<string>()

  const ensureParent = (path: string) => {
    const parent = memoryDirname(path)
    if (!dirs.has(parent)) {
      throw Object.assign(new Error(`ENOENT: no such directory '${parent}'`), {
        code: 'ENOENT',
      })
    }
  }

  return {
    files,
    has: (path) => files.has(path),
    reset: () => {
      files.clear()
      dirs.clear()
    },
    async exists(path) {
      return files.has(path)
    },
    async readFile(path) {
      const content = files.get(path)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file '${path}'`), { code: 'ENOENT' })
      }
      return content
    },
    async writeFile(path, data) {
      ensureParent(path)
      files.set(path, data)
    },
    async copyFile(src, dest) {
      const content = files.get(src)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file '${src}'`), { code: 'ENOENT' })
      }
      ensureParent(dest)
      files.set(dest, content)
    },
    async rename(src, dest) {
      const content = files.get(src)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file '${src}'`), { code: 'ENOENT' })
      }
      ensureParent(dest)
      files.set(dest, content)
      files.delete(src)
    },
    async mkdir(path, opts) {
      if (opts?.recursive !== false) {
        // Walk parents — supports both / and \ separators.
        const parts = path.split(/[\\/]/).filter(Boolean)
        let acc = path.startsWith('/') ? '' : ''
        const sep = path.includes('\\') ? '\\' : '/'
        if (path.startsWith('/')) acc = ''
        for (const part of parts) {
          acc =
            acc.length === 0 && path.startsWith('/')
              ? `/${part}`
              : acc
                ? `${acc}${sep}${part}`
                : part
          dirs.add(acc)
        }
      } else {
        const parent = memoryDirname(path)
        if (!dirs.has(parent) && parent !== path) {
          throw Object.assign(new Error(`ENOENT: parent '${parent}' does not exist`), {
            code: 'ENOENT',
          })
        }
        dirs.add(path)
      }
    },
  }
}

// Re-export for callers that prefer to seed parent directories before writing.
export { dirname }
