import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppointmentGroupsModule } from '../../src/canvas/appointment-groups'
import type { CanvasHttpClient } from '../../src/canvas/client'
import type {
  CanvasAppointmentGroup,
  CanvasCalendarEvent,
  CanvasGroup,
  CanvasUser,
} from '../../src/canvas/types'

const mockGroup: CanvasAppointmentGroup = {
  id: 1,
  title: 'Office Hours',
  context_codes: ['course_10'],
  workflow_state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  appointment_count: 3,
  participant_count: 2,
}

const mockUser: CanvasUser = {
  id: 5,
  name: 'Alice',
  sortable_name: 'Alice',
}

const mockCanvasGroup: CanvasGroup = {
  id: 7,
  name: 'Group A',
  group_category_id: 1,
  members_count: 3,
}

const mockEvent: CanvasCalendarEvent = {
  id: 20,
  title: 'Office Hours - slot 1',
  start_at: '2026-02-01T10:00:00Z',
  end_at: '2026-02-01T10:30:00Z',
  context_code: 'course_10',
  type: 'CalendarEvent',
}

function buildMockClient(): CanvasHttpClient {
  return {
    paginate: vi.fn(),
    request: vi.fn(),
  } as unknown as CanvasHttpClient
}

describe('AppointmentGroupsModule', () => {
  let client: CanvasHttpClient
  let mod: AppointmentGroupsModule

  beforeEach(() => {
    client = buildMockClient()
    mod = new AppointmentGroupsModule(client)
  })

  describe('list', () => {
    it('paginates /api/v1/appointment_groups without params', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockGroup])
      const result = await mod.list()
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/appointment_groups', {})
      expect(result).toEqual([mockGroup])
    })

    it('passes scope and include params', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockGroup])
      await mod.list({ scope: 'reservable', include: ['appointments', 'participant_count'] })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/appointment_groups', {
        scope: 'reservable',
        include: ['appointments', 'participant_count'],
      })
    })

    it('passes context_codes when provided', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockGroup])
      await mod.list({ context_codes: ['course_10'] })
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/appointment_groups', {
        context_codes: ['course_10'],
      })
    })
  })

  describe('get', () => {
    it('requests /api/v1/appointment_groups/:id without include', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockGroup)
      const result = await mod.get(1)
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/1', { query: {} })
      expect(result).toEqual(mockGroup)
    })

    it('passes include when provided', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockGroup)
      await mod.get(1, ['appointments', 'child_events'])
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/1', {
        query: { include: ['appointments', 'child_events'] },
      })
    })
  })

  describe('create', () => {
    it('POSTs appointment_group params', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockGroup)
      const result = await mod.create({
        context_codes: ['course_10'],
        title: 'Office Hours',
        publish: false,
      })
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups', {
        method: 'POST',
        body: JSON.stringify({
          appointment_group: {
            context_codes: ['course_10'],
            title: 'Office Hours',
            publish: false,
          },
        }),
      })
      expect(result).toEqual(mockGroup)
    })
  })

  describe('update', () => {
    it('PUTs updated params', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(mockGroup)
      await mod.update(1, { title: 'New Title', publish: true })
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/1', {
        method: 'PUT',
        body: JSON.stringify({ appointment_group: { title: 'New Title', publish: true } }),
      })
    })
  })

  describe('delete', () => {
    it('DELETEs without cancel_reason', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(undefined)
      await mod.delete(1)
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/1', {
        method: 'DELETE',
        body: undefined,
      })
    })

    it('DELETEs with cancel_reason', async () => {
      vi.mocked(client.request).mockResolvedValueOnce(undefined)
      await mod.delete(1, 'Cancelled due to conflict')
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/1', {
        method: 'DELETE',
        body: JSON.stringify({ cancel_reason: 'Cancelled due to conflict' }),
      })
    })
  })

  describe('listUsers', () => {
    it('paginates /api/v1/appointment_groups/:id/users', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockUser])
      const result = await mod.listUsers(1)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/appointment_groups/1/users')
      expect(result).toEqual([mockUser])
    })
  })

  describe('listGroups', () => {
    it('paginates /api/v1/appointment_groups/:id/groups', async () => {
      vi.mocked(client.paginate).mockResolvedValueOnce([mockCanvasGroup])
      const result = await mod.listGroups(1)
      expect(client.paginate).toHaveBeenCalledWith('/api/v1/appointment_groups/1/groups')
      expect(result).toEqual([mockCanvasGroup])
    })
  })

  describe('nextAppointment', () => {
    it('requests next_appointment without filters', async () => {
      vi.mocked(client.request).mockResolvedValueOnce([mockEvent])
      const result = await mod.nextAppointment()
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/next_appointment', {
        query: {},
      })
      expect(result).toEqual([mockEvent])
    })

    it('passes appointment_group_ids when provided', async () => {
      vi.mocked(client.request).mockResolvedValueOnce([mockEvent])
      await mod.nextAppointment([1, 2])
      expect(client.request).toHaveBeenCalledWith('/api/v1/appointment_groups/next_appointment', {
        query: { appointment_group_ids: [1, 2] },
      })
    })
  })
})
