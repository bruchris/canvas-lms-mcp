import { describe, it, expect } from 'vitest'
import { CanvasClient, CanvasHttpClient, CanvasApiError } from '../../src/canvas/index'
import { CoursesModule } from '../../src/canvas/courses'

describe('CanvasClient facade', () => {
  it('creates a CanvasClient with courses module', () => {
    const client = new CanvasClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })

    expect(client.courses).toBeInstanceOf(CoursesModule)
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
})
