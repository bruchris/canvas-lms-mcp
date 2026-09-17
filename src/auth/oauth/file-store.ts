// Encrypted, file-backed OAuth store (design §6).
//
// Wraps a `MemoryOAuthStore` and persists its whole snapshot as one
// AES-256-GCM blob after every mutation. The key is derived from the
// operator's `CANVAS_MCP_OAUTH_STORE_KEY` with scrypt and a fixed
// application salt, so the same secret opens the same file on every start.
//
// Writes are atomic (`<file>.tmp-<rand>` then rename) and serialised through
// one promise chain, with coalescing: a burst of mutations produces one write
// carrying the latest state, never an interleaved or torn file.
//
// On-disk shape (JSON): { "version": 1, "kdf": "scrypt", "iv": b64, "tag": b64, "data": b64 }.
// Nothing in it is readable without the key — a copied store file is not a
// copied set of Canvas refresh tokens.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  MemoryOAuthStore,
  type AuthorizationCode,
  type ConsumeCodeResult,
  type Grant,
  type MemoryOAuthStoreOptions,
  type OAuthStore,
  type PendingAuthorization,
  type RegisteredClient,
  type StoreSnapshot,
  type TokenRecord,
} from './store'

const KDF_SALT = 'canvas-lms-mcp:oauth-store:v1'
const FILE_VERSION = 1

interface EncryptedFile {
  version: number
  kdf: 'scrypt'
  iv: string
  tag: string
  data: string
}

export class OAuthStoreFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthStoreFileError'
  }
}

export function deriveStoreKey(secret: string): Buffer {
  return scryptSync(secret, KDF_SALT, 32)
}

export function encryptSnapshot(snapshot: StoreSnapshot, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8')
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const file: EncryptedFile = {
    version: FILE_VERSION,
    kdf: 'scrypt',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
  return JSON.stringify(file)
}

export function decryptSnapshot(contents: string, key: Buffer): StoreSnapshot {
  let file: EncryptedFile
  try {
    file = JSON.parse(contents) as EncryptedFile
  } catch {
    throw new OAuthStoreFileError('OAuth store file is not valid JSON')
  }
  if (
    file.version !== FILE_VERSION ||
    file.kdf !== 'scrypt' ||
    !file.iv ||
    !file.tag ||
    !file.data
  ) {
    throw new OAuthStoreFileError('OAuth store file has an unrecognised format')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(file.data, 'base64')),
      decipher.final(),
    ])
    const snapshot = JSON.parse(plaintext.toString('utf8')) as StoreSnapshot
    if (snapshot.version !== 1) {
      throw new OAuthStoreFileError(
        `OAuth store snapshot version ${snapshot.version} is not supported`,
      )
    }
    return snapshot
  } catch (error) {
    if (error instanceof OAuthStoreFileError) throw error
    throw new OAuthStoreFileError(
      'OAuth store file could not be decrypted: CANVAS_MCP_OAUTH_STORE_KEY does not match the key that wrote it',
    )
  }
}

export type FileOAuthStoreOptions = MemoryOAuthStoreOptions

export class FileOAuthStore implements OAuthStore {
  private readonly inner: MemoryOAuthStore
  private readonly path: string
  private readonly key: Buffer
  private chain: Promise<void> = Promise.resolve()
  private dirty = false
  private writing = false

  private constructor(path: string, key: Buffer, inner: MemoryOAuthStore) {
    this.path = path
    this.key = key
    this.inner = inner
  }

  /**
   * Open (or create) the store. Throws `OAuthStoreFileError` when the file
   * exists but cannot be read with this key — silently starting empty would
   * strand every existing grant and hide a misconfiguration.
   */
  static async open(
    path: string,
    keySecret: string,
    options: FileOAuthStoreOptions = {},
  ): Promise<FileOAuthStore> {
    const key = deriveStoreKey(keySecret)
    let contents: string | undefined
    try {
      contents = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const inner =
      contents === undefined
        ? new MemoryOAuthStore(options)
        : MemoryOAuthStore.fromSnapshot(decryptSnapshot(contents, key), options)
    return new FileOAuthStore(path, key, inner)
  }

  /** Resolves once every mutation so far has reached disk. */
  async flush(): Promise<void> {
    await this.chain
  }

  private persist(): Promise<void> {
    this.dirty = true
    if (this.writing) return this.chain
    this.writing = true
    this.chain = this.chain.then(() => this.writeLoop())
    return this.chain
  }

  private async writeLoop(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false
        await this.writeOnce()
      }
    } finally {
      this.writing = false
    }
  }

  private async writeOnce(): Promise<void> {
    const payload = encryptSnapshot(this.inner.snapshot(), this.key)
    const dir = dirname(this.path)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.tmp-${randomBytes(6).toString('hex')}`
    await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 })
    try {
      await chmod(tmp, 0o600)
    } catch {
      // Best-effort on platforms without POSIX modes.
    }
    await rename(tmp, this.path)
  }

  private async mutate<T>(op: () => Promise<T>): Promise<T> {
    const result = await op()
    await this.persist()
    return result
  }

  getClient(clientId: string): Promise<RegisteredClient | undefined> {
    return this.inner.getClient(clientId)
  }
  putClient(client: RegisteredClient): Promise<void> {
    return this.mutate(() => this.inner.putClient(client))
  }
  deleteClient(clientId: string): Promise<void> {
    return this.mutate(() => this.inner.deleteClient(clientId))
  }
  putPendingAuthorization(pending: PendingAuthorization): Promise<void> {
    return this.mutate(() => this.inner.putPendingAuthorization(pending))
  }
  getPendingAuthorization(id: string): Promise<PendingAuthorization | undefined> {
    return this.inner.getPendingAuthorization(id)
  }
  updatePendingAuthorization(pending: PendingAuthorization): Promise<void> {
    return this.mutate(() => this.inner.updatePendingAuthorization(pending))
  }
  takePendingAuthorization(id: string): Promise<PendingAuthorization | undefined> {
    return this.mutate(() => this.inner.takePendingAuthorization(id))
  }
  putAuthorizationCode(code: AuthorizationCode): Promise<void> {
    return this.mutate(() => this.inner.putAuthorizationCode(code))
  }
  consumeAuthorizationCode(hash: string, now: number): Promise<ConsumeCodeResult | undefined> {
    return this.mutate(() => this.inner.consumeAuthorizationCode(hash, now))
  }
  putGrant(grant: Grant): Promise<void> {
    return this.mutate(() => this.inner.putGrant(grant))
  }
  getGrant(id: string): Promise<Grant | undefined> {
    return this.inner.getGrant(id)
  }
  updateGrant(grant: Grant): Promise<void> {
    return this.mutate(() => this.inner.updateGrant(grant))
  }
  deleteGrant(id: string): Promise<void> {
    return this.mutate(() => this.inner.deleteGrant(id))
  }
  putToken(token: TokenRecord): Promise<void> {
    return this.mutate(() => this.inner.putToken(token))
  }
  getToken(hash: string): Promise<TokenRecord | undefined> {
    return this.inner.getToken(hash)
  }
  takeToken(hash: string): Promise<TokenRecord | undefined> {
    return this.mutate(() => this.inner.takeToken(hash))
  }
  deleteToken(hash: string): Promise<void> {
    return this.mutate(() => this.inner.deleteToken(hash))
  }
  deleteTokensForGrant(grantId: string): Promise<void> {
    return this.mutate(() => this.inner.deleteTokensForGrant(grantId))
  }
  purgeExpired(now: number): Promise<void> {
    return this.mutate(() => this.inner.purgeExpired(now))
  }
}
