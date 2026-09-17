import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  BodyError,
  MAX_BODY_BYTES,
  contentType,
  parseBasicAuth,
  parseBearer,
  parseCookies,
  readBody,
  readFormBody,
  readJsonBody,
  routePath,
  serializeCookie,
} from '../../../src/auth/oauth/http-util'

function req(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(body, 'utf8')]) as unknown as IncomingMessage
  ;(stream as unknown as { headers: Record<string, string> }).headers = headers
  return stream
}

describe('OAuth http helpers', () => {
  it('readBody enforces the size cap', async () => {
    await expect(readBody(req('x'.repeat(10)), 5)).rejects.toBeInstanceOf(BodyError)
    await expect(readBody(req('x'.repeat(10)), 5)).rejects.toMatchObject({ status: 413 })
    expect(MAX_BODY_BYTES).toBe(65536)
  })

  it('readFormBody requires the form content type and parses it', async () => {
    const form = await readFormBody(
      req('a=1&b=%20x', { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }),
    )
    expect(form.get('a')).toBe('1')
    expect(form.get('b')).toBe(' x')
    await expect(
      readFormBody(req('{}', { 'content-type': 'application/json' })),
    ).rejects.toMatchObject({
      status: 400,
    })
  })

  it('readJsonBody requires JSON content type and valid JSON', async () => {
    expect(await readJsonBody(req('{"a":1}', { 'content-type': 'application/json' }))).toEqual({
      a: 1,
    })
    await expect(
      readJsonBody(req('nope', { 'content-type': 'application/json' })),
    ).rejects.toMatchObject({
      status: 400,
    })
    await expect(readJsonBody(req('{}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('contentType strips parameters and case', () => {
    expect(contentType(req('', { 'content-type': 'Application/JSON; charset=UTF-8' }))).toBe(
      'application/json',
    )
    expect(contentType(req(''))).toBe('')
  })

  it('parseBearer accepts only the Bearer scheme', () => {
    expect(parseBearer('Bearer abc')).toBe('abc')
    expect(parseBearer('bearer abc')).toBe('abc')
    expect(parseBearer('Basic abc')).toBeUndefined()
    expect(parseBearer('Bearer')).toBeUndefined()
    expect(parseBearer(undefined)).toBeUndefined()
  })

  it('parseBasicAuth decodes and form-urldecodes RFC 6749 §2.3.1 credentials', () => {
    const header = `Basic ${Buffer.from('my%3Aid:s%26cret').toString('base64')}`
    expect(parseBasicAuth(header)).toEqual({ username: 'my:id', password: 's&cret' })
    expect(parseBasicAuth('Basic !!!')).toBeUndefined()
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeUndefined()
    expect(parseBasicAuth('Bearer x')).toBeUndefined()
  })

  it('cookies round-trip and are HttpOnly + SameSite=Lax, Secure only when asked', () => {
    const cookie = serializeCookie('canvas_mcp_authz', 'a b', {
      secure: true,
      path: '/oauth/',
      maxAge: 600,
    })
    expect(cookie).toBe(
      'canvas_mcp_authz=a%20b; Path=/oauth/; HttpOnly; SameSite=Lax; Secure; Max-Age=600',
    )
    expect(serializeCookie('n', 'v', { secure: false })).toBe('n=v; Path=/; HttpOnly; SameSite=Lax')
    expect(parseCookies('canvas_mcp_authz=a%20b; other=1; bad')).toEqual({
      canvas_mcp_authz: 'a b',
      other: '1',
    })
    expect(parseCookies(undefined)).toEqual({})
    // First occurrence wins, as browsers send the most specific path first.
    expect(parseCookies('a=1; a=2')).toEqual({ a: '1' })
  })

  it('routePath strips the issuer path prefix when present and keeps the query', () => {
    expect(routePath('/mcp?x=1', '')).toMatchObject({ path: '/mcp' })
    expect(routePath('/canvas/mcp', '/canvas').path).toBe('/mcp')
    expect(routePath('/mcp', '/canvas').path).toBe('/mcp')
    expect(routePath('/canvas', '/canvas').path).toBe('/')
    expect(routePath('/canvasx/mcp', '/canvas').path).toBe('/canvasx/mcp')
    expect(routePath('/oauth/authorize?client_id=a', '').query.get('client_id')).toBe('a')
    expect(routePath(undefined, '').path).toBe('/')
  })
})
