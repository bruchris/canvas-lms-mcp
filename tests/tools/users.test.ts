import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasUser, CanvasUserProfile } from '../../src/canvas/types'
import { userTools } from '../../src/tools/users'

describe('userTools', () => {
  const mockUser: CanvasUser = {
    id: 5,
    name: 'Alice',
    sortable_name: 'Alice',
    short_name: 'Alice',
    login_id: 'alice@example.com',
    email: 'alice@example.com',
    created_at: '2026-01-01T00:00:00Z',
  }

  const mockProfile: CanvasUserProfile = {
    id: 5,
    name: 'Alice',
    short_name: 'Alice',
    login_id: 'alice@example.com',
    primary_email: 'alice@example.com',
    avatar_url: 'https://canvas.example.com/avatar.png',
    bio: null,
    locale: 'en',
    time_zone: 'America/New_York',
  }

  function buildMockCanvas(): CanvasClient {
    return {
      users: {
        listStudents: vi.fn().mockResolvedValue([mockUser]),
        get: vi.fn().mockResolvedValue(mockUser),
        getProfile: vi.fn().mockResolvedValue(mockProfile),
        searchUsers: vi.fn().mockResolvedValue([mockUser]),
        listCourseUsers: vi.fn().mockResolvedValue([mockUser]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 5 tool definitions', () => {
    expect(userTools(buildMockCanvas())).toHaveLength(5)
  })

  it('exports tools with correct names', () => {
    const names = userTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_students',
      'get_user',
      'get_profile',
      'search_users',
      'list_course_users',
    ])
  })

  describe('list_students', () => {
    it('has read-only annotations', () => {
      const tool = userTools(buildMockCanvas()).find((t) => t.name === 'list_students')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.users.listStudents', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'list_students')!
      await tool.handler({ course_id: 1 })
      expect(canvas.users.listStudents).toHaveBeenCalledWith(1)
    })
  })

  describe('get_user', () => {
    it('has read-only annotations', () => {
      const tool = userTools(buildMockCanvas()).find((t) => t.name === 'get_user')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.users.get', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'get_user')!
      await tool.handler({ user_id: 5 })
      expect(canvas.users.get).toHaveBeenCalledWith(5)
    })
  })

  describe('get_profile', () => {
    it('has read-only annotations', () => {
      const tool = userTools(buildMockCanvas()).find((t) => t.name === 'get_profile')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.users.getProfile', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'get_profile')!
      await tool.handler({})
      expect(canvas.users.getProfile).toHaveBeenCalled()
    })
  })

  describe('search_users', () => {
    it('has read-only annotations', () => {
      const tool = userTools(buildMockCanvas()).find((t) => t.name === 'search_users')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.users.searchUsers with required params', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'search_users')!
      await tool.handler({ account_id: 1, search_term: 'alice' })
      expect(canvas.users.searchUsers).toHaveBeenCalledWith(1, 'alice', undefined, undefined)
    })

    it('passes optional sort and order', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'search_users')!
      await tool.handler({ account_id: 1, search_term: 'alice', sort: 'username', order: 'asc' })
      expect(canvas.users.searchUsers).toHaveBeenCalledWith(1, 'alice', 'username', 'asc')
    })
  })

  describe('list_course_users', () => {
    it('has read-only annotations', () => {
      const tool = userTools(buildMockCanvas()).find((t) => t.name === 'list_course_users')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.users.listCourseUsers', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'list_course_users')!
      await tool.handler({ course_id: 100 })
      expect(canvas.users.listCourseUsers).toHaveBeenCalledWith(100, undefined)
    })

    it('passes optional enrollment_type', async () => {
      const canvas = buildMockCanvas()
      const tool = userTools(canvas).find((t) => t.name === 'list_course_users')!
      await tool.handler({ course_id: 100, enrollment_type: 'teacher' })
      expect(canvas.users.listCourseUsers).toHaveBeenCalledWith(100, 'teacher')
    })
  })
})
