import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupsModule } from '../../src/canvas/groups'
import { CanvasHttpClient } from '../../src/canvas/client'

describe('GroupsModule', () => {
  let client: CanvasHttpClient
  let groups: GroupsModule

  beforeEach(() => {
    client = new CanvasHttpClient({
      token: 'test-token',
      baseUrl: 'https://canvas.example.com',
    })
    groups = new GroupsModule(client)
  })

  it('lists groups for a course', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'Group A', group_category_id: 10, members_count: 4 },
    ])
    const result = await groups.list(100)
    expect(result).toHaveLength(1)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/courses/100/groups')
  })

  it('lists members of a group', async () => {
    vi.spyOn(client, 'paginate').mockResolvedValueOnce([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
    const result = await groups.listMembers(5)
    expect(result).toHaveLength(2)
    expect(client.paginate).toHaveBeenCalledWith('/api/v1/groups/5/users')
  })
})
