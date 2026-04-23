import { describe, it, expect } from 'vitest'
import {
  CanvasClient,
  CanvasHttpClient,
  CanvasApiError,
  GeneratedUsersModule,
} from '../../src/canvas/index'
import { CoursesModule } from '../../src/canvas/courses'
import { GradebookHistoryModule } from '../../src/canvas/gradebook-history'
import { UsersModule } from '../../src/canvas/users'

describe('CanvasClient facade', () => {
  it('creates a CanvasClient with courses module', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(client.courses).toBeInstanceOf(CoursesModule)
  })

  it('creates a CanvasClient with gradebookHistory module', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(client.gradebookHistory).toBeInstanceOf(GradebookHistoryModule)
  })

  it('re-exports CanvasHttpClient', () => {
    expect(CanvasHttpClient).toBeDefined()
    const httpClient = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    expect(httpClient).toBeInstanceOf(CanvasHttpClient)
  })

  it('re-exports CanvasApiError', () => {
    expect(CanvasApiError).toBeDefined()
    const error = new CanvasApiError('test', 404, '/api/v1/courses')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(CanvasApiError)
  })

  it('uses the hand-written UsersModule by default', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    expect(client.users).toBeInstanceOf(UsersModule)
    expect(client.users).not.toBeInstanceOf(GeneratedUsersModule)
  })

  it('uses GeneratedUsersModule when useGeneratedClient=true', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      useGeneratedClient: true,
    })
    expect(client.users).toBeInstanceOf(GeneratedUsersModule)
  })

  it('uses GeneratedUsersModule when useGeneratedClient=["users"]', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      useGeneratedClient: ['users'],
    })
    expect(client.users).toBeInstanceOf(GeneratedUsersModule)
  })

  it('falls back to hand-written module when flag list omits users', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
      useGeneratedClient: [],
    })
    expect(client.users).toBeInstanceOf(UsersModule)
  })
})
