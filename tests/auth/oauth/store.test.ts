import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileOAuthStore,
  OAuthStoreFileError,
  decryptSnapshot,
  deriveStoreKey,
  encryptSnapshot,
} from '../../../src/auth/oauth/file-store'
import {
  MemoryOAuthStore,
  type AuthorizationCode,
  type Grant,
  type OAuthStore,
  type PendingAuthorization,
  type RegisteredClient,
  type TokenRecord,
} from '../../../src/auth/oauth/store'

const NOW = 1_800_000_000_000

function client(id: string, source: RegisteredClient['source'] = 'dynamic'): RegisteredClient {
  return {
    clientId: id,
    redirectUris: ['http://127.0.0.1/callback'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    source,
    createdAt: NOW,
  }
}

function pending(id: string, expiresAt = NOW + 600_000): PendingAuthorization {
  return {
    id,
    clientId: 'c1',
    redirectUri: 'http://127.0.0.1/callback',
    codeChallenge: 'x'.repeat(43),
    scopes: ['canvas:read'],
    resource: 'http://127.0.0.1:3001/mcp',
    csrfHash: 'csrf',
    createdAt: NOW,
    expiresAt,
  }
}

function code(hash: string, expiresAt = NOW + 300_000): AuthorizationCode {
  return {
    hash,
    clientId: 'c1',
    redirectUri: 'http://127.0.0.1/callback',
    codeChallenge: 'x'.repeat(43),
    scopes: ['canvas:read'],
    resource: 'http://127.0.0.1:3001/mcp',
    grantId: 'g1',
    createdAt: NOW,
    expiresAt,
  }
}

function grant(id: string): Grant {
  return {
    id,
    clientId: 'c1',
    scopes: ['canvas:read', 'canvas:write'],
    resource: 'http://127.0.0.1:3001/mcp',
    canvasUserId: '42',
    canvas: {
      accessToken: 'canvas-access-SECRET',
      refreshToken: 'canvas-refresh-SECRET',
      expiresAt: NOW + 3_600_000,
    },
    createdAt: NOW,
  }
}

function token(
  hash: string,
  grantId: string,
  kind: TokenRecord['kind'] = 'access',
  expiresAt = NOW + 3_600_000,
): TokenRecord {
  return {
    hash,
    kind,
    grantId,
    clientId: 'c1',
    scopes: ['canvas:read'],
    resource: 'http://127.0.0.1:3001/mcp',
    createdAt: NOW,
    expiresAt,
  }
}

function storeContract(name: string, make: () => Promise<OAuthStore>) {
  describe(name, () => {
    let store: OAuthStore
    beforeEach(async () => {
      store = await make()
    })

    it('round-trips clients, grants, and tokens', async () => {
      await store.putClient(client('c1', 'preregistered'))
      await store.putGrant(grant('g1'))
      await store.putToken(token('t1', 'g1'))
      expect(await store.getClient('c1')).toMatchObject({ clientId: 'c1' })
      expect(await store.getGrant('g1')).toMatchObject({ canvasUserId: '42' })
      expect(await store.getToken('t1')).toMatchObject({ grantId: 'g1' })
      expect(await store.getClient('nope')).toBeUndefined()
    })

    it('takePendingAuthorization is single-use', async () => {
      await store.putPendingAuthorization(pending('p1'))
      expect(await store.getPendingAuthorization('p1')).toBeDefined()
      expect(await store.takePendingAuthorization('p1')).toMatchObject({ id: 'p1' })
      expect(await store.takePendingAuthorization('p1')).toBeUndefined()
      expect(await store.getPendingAuthorization('p1')).toBeUndefined()
    })

    it('updatePendingAuthorization replaces the record (consent state)', async () => {
      await store.putPendingAuthorization(pending('p1'))
      await store.updatePendingAuthorization({
        ...pending('p1'),
        cookieHash: 'ck',
        consentedAt: NOW,
      })
      expect(await store.getPendingAuthorization('p1')).toMatchObject({ cookieHash: 'ck' })
    })

    it('consumeAuthorizationCode marks the first redemption and flags the second', async () => {
      await store.putAuthorizationCode(code('h1'))
      const first = await store.consumeAuthorizationCode('h1', NOW + 1)
      expect(first).toMatchObject({ alreadyConsumed: false })
      expect(first?.record.consumedAt).toBe(NOW + 1)
      const second = await store.consumeAuthorizationCode('h1', NOW + 2)
      expect(second).toMatchObject({ alreadyConsumed: true })
      expect(second?.record.grantId).toBe('g1')
    })

    it('consumeAuthorizationCode treats expired and unknown codes as absent', async () => {
      await store.putAuthorizationCode(code('h1', NOW - 1))
      expect(await store.consumeAuthorizationCode('h1', NOW)).toBeUndefined()
      expect(await store.consumeAuthorizationCode('unknown', NOW)).toBeUndefined()
    })

    it('takeToken is single-use; deleteTokensForGrant removes every token of a grant', async () => {
      await store.putToken(token('a1', 'g1'))
      await store.putToken(token('r1', 'g1', 'refresh'))
      await store.putToken(token('a2', 'g2'))
      expect(await store.takeToken('r1')).toMatchObject({ kind: 'refresh' })
      expect(await store.takeToken('r1')).toBeUndefined()
      await store.deleteTokensForGrant('g1')
      expect(await store.getToken('a1')).toBeUndefined()
      expect(await store.getToken('a2')).toBeDefined()
    })

    it('deleteGrant and deleteToken and deleteClient remove records', async () => {
      await store.putClient(client('c1'))
      await store.putGrant(grant('g1'))
      await store.putToken(token('t1', 'g1'))
      await store.deleteClient('c1')
      await store.deleteGrant('g1')
      await store.deleteToken('t1')
      expect(await store.getClient('c1')).toBeUndefined()
      expect(await store.getGrant('g1')).toBeUndefined()
      expect(await store.getToken('t1')).toBeUndefined()
    })

    it('updateGrant replaces the Canvas connection (refresh path)', async () => {
      await store.putGrant(grant('g1'))
      const g = (await store.getGrant('g1'))!
      await store.updateGrant({
        ...g,
        canvas: { ...g.canvas, accessToken: 'new', expiresAt: NOW + 1 },
      })
      expect((await store.getGrant('g1'))?.canvas.accessToken).toBe('new')
    })

    it('purgeExpired drops expired pending, codes, tokens, and stale CIMD documents only', async () => {
      await store.putPendingAuthorization(pending('old', NOW - 1))
      await store.putPendingAuthorization(pending('fresh', NOW + 1))
      await store.putAuthorizationCode(code('old', NOW - 1))
      await store.putAuthorizationCode(code('fresh', NOW + 1))
      await store.putToken(token('old', 'g1', 'access', NOW - 1))
      await store.putToken(token('fresh', 'g1', 'access', NOW + 1))
      await store.putClient({ ...client('cimd-old', 'cimd'), cimdExpiresAt: NOW - 1 })
      await store.putClient({ ...client('cimd-fresh', 'cimd'), cimdExpiresAt: NOW + 1 })
      await store.putClient(client('dyn', 'dynamic'))
      await store.putGrant(grant('g1'))

      await store.purgeExpired(NOW)

      expect(await store.getPendingAuthorization('old')).toBeUndefined()
      expect(await store.getPendingAuthorization('fresh')).toBeDefined()
      expect(await store.consumeAuthorizationCode('fresh', NOW)).toBeDefined()
      expect(await store.getToken('old')).toBeUndefined()
      expect(await store.getToken('fresh')).toBeDefined()
      expect(await store.getClient('cimd-old')).toBeUndefined()
      expect(await store.getClient('cimd-fresh')).toBeDefined()
      expect(await store.getClient('dyn')).toBeDefined()
      expect(await store.getGrant('g1')).toBeDefined()
    })
  })
}

storeContract('MemoryOAuthStore', async () => new MemoryOAuthStore())

describe('MemoryOAuthStore dynamic-client cap (§7.3)', () => {
  it('evicts the oldest dynamic clients past the cap and never a pre-registered one', async () => {
    const store = new MemoryOAuthStore({ maxDynamicClients: 2 })
    await store.putClient(client('pre', 'preregistered'))
    await store.putClient(client('d1'))
    await store.putClient(client('d2'))
    await store.putClient(client('d3'))
    expect(await store.getClient('pre')).toBeDefined()
    expect(await store.getClient('d1')).toBeUndefined()
    expect(await store.getClient('d2')).toBeDefined()
    expect(await store.getClient('d3')).toBeDefined()
  })

  it('defaults to a cap of 1000', async () => {
    const store = new MemoryOAuthStore()
    for (let i = 0; i < 1001; i++) await store.putClient(client(`d${i}`))
    expect(await store.getClient('d0')).toBeUndefined()
    expect(await store.getClient('d1')).toBeDefined()
    expect(await store.getClient('d1000')).toBeDefined()
  })
})

describe('FileOAuthStore', () => {
  let dir: string
  let path: string
  const KEY = 'a-long-enough-secret-value'

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-mcp-oauth-store-'))
    path = join(dir, 'nested', 'oauth-store.enc')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  storeContract('contract', async () => {
    const d = await mkdtemp(join(tmpdir(), 'canvas-mcp-oauth-store-contract-'))
    return FileOAuthStore.open(join(d, 'store.enc'), KEY)
  })

  it('persists across reopen, creating the directory as needed', async () => {
    const a = await FileOAuthStore.open(path, KEY)
    await a.putGrant(grant('g1'))
    await a.putToken(token('t1', 'g1'))
    await a.flush()

    const b = await FileOAuthStore.open(path, KEY)
    expect(await b.getGrant('g1')).toMatchObject({ canvasUserId: '42' })
    expect(await b.getToken('t1')).toMatchObject({ grantId: 'g1' })
  })

  it('never writes a Canvas token, MCP token hash, or user id in the clear', async () => {
    const store = await FileOAuthStore.open(path, KEY)
    await store.putGrant(grant('g1'))
    await store.putToken(token('deadbeefhash', 'g1'))
    await store.flush()
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('SECRET')
    expect(raw).not.toContain('deadbeefhash')
    expect(raw).not.toContain('"canvasUserId"')
    expect(JSON.parse(raw)).toMatchObject({ version: 1, kdf: 'scrypt' })
  })

  it('refuses to open with the wrong key rather than starting empty', async () => {
    const store = await FileOAuthStore.open(path, KEY)
    await store.putGrant(grant('g1'))
    await store.flush()
    await expect(FileOAuthStore.open(path, 'another-long-enough-secret')).rejects.toThrow(
      OAuthStoreFileError,
    )
    await expect(FileOAuthStore.open(path, 'another-long-enough-secret')).rejects.toThrow(
      /does not match the key that wrote it/,
    )
  })

  it('refuses a corrupt or foreign file', async () => {
    const key = deriveStoreKey(KEY)
    expect(() => decryptSnapshot('not json', key)).toThrow(/not valid JSON/)
    expect(() => decryptSnapshot('{"version":9}', key)).toThrow(/unrecognised format/)
    const good = encryptSnapshot(new MemoryOAuthStore().snapshot(), key)
    const tampered = JSON.parse(good)
    tampered.data = Buffer.from('tampered').toString('base64')
    expect(() => decryptSnapshot(JSON.stringify(tampered), key)).toThrow(/could not be decrypted/)
  })

  it('coalesces a burst of mutations into a consistent final file', async () => {
    const store = await FileOAuthStore.open(path, KEY)
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.putGrant(grant(`g${i}`))))
    await store.flush()
    const reopened = await FileOAuthStore.open(path, KEY)
    for (let i = 0; i < 25; i++) expect(await reopened.getGrant(`g${i}`)).toBeDefined()
  })
})
