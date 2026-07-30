import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import type { CanvasClient } from '../../src/canvas'
import type {
  CanvasAppointmentGroup,
  CanvasCalendarEvent,
  CanvasUser,
} from '../../src/canvas/types'
import { appointmentGroupTools } from '../../src/tools/appointment-groups'

const mockAppointmentGroup: CanvasAppointmentGroup = {
  id: 1,
  title: 'Office Hours',
  context_codes: ['course_10'],
  workflow_state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  appointment_count: 3,
  participant_count: 2,
  participant_type: 'User',
}

const mockUser: CanvasUser = {
  id: 5,
  name: 'Alice',
  sortable_name: 'Alice',
  login_id: 'alice@example.com',
  email: 'alice@example.com',
  created_at: '2026-01-01T00:00:00Z',
}

const mockEvent: CanvasCalendarEvent = {
  id: 20,
  title: 'Office Hours - slot 1',
  start_at: '2026-02-01T10:00:00Z',
  end_at: '2026-02-01T10:30:00Z',
  context_code: 'course_10',
  type: 'CalendarEvent',
}

const mockReservationEvent: CanvasCalendarEvent = {
  id: 30,
  title: 'Office Hours - slot 1 reservation',
  start_at: '2026-02-01T10:00:00Z',
  end_at: '2026-02-01T10:30:00Z',
  context_code: 'course_10',
  type: 'CalendarEvent',
  user: mockUser,
}

const mockSlotWithChildEvents: CanvasCalendarEvent = {
  ...mockEvent,
  child_events: [mockReservationEvent],
}

const mockAppointmentGroupWithChildEvents: CanvasAppointmentGroup = {
  ...mockAppointmentGroup,
  appointments: [mockSlotWithChildEvents],
}

function buildMockCanvas(): CanvasClient {
  return {
    appointmentGroups: {
      list: vi.fn().mockResolvedValue([mockAppointmentGroup]),
      get: vi.fn().mockResolvedValue(mockAppointmentGroup),
      create: vi.fn().mockResolvedValue(mockAppointmentGroup),
      update: vi.fn().mockResolvedValue(mockAppointmentGroup),
      delete: vi.fn().mockResolvedValue(undefined),
      listUsers: vi.fn().mockResolvedValue([mockUser]),
      listGroups: vi.fn().mockResolvedValue([]),
      nextAppointment: vi.fn().mockResolvedValue([mockEvent]),
    },
  } as unknown as CanvasClient
}

describe('appointmentGroupTools', () => {
  it('returns 8 tool definitions', () => {
    expect(appointmentGroupTools(buildMockCanvas())).toHaveLength(8)
  })

  it('exports tools with correct names', () => {
    const names = appointmentGroupTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_appointment_groups',
      'get_appointment_group',
      'create_appointment_group',
      'update_appointment_group',
      'delete_appointment_group',
      'list_appointment_group_users',
      'list_appointment_group_groups',
      'next_appointment',
    ])
  })

  describe('annotations', () => {
    it('read tools have readOnlyHint + openWorldHint', () => {
      const readNames = [
        'list_appointment_groups',
        'get_appointment_group',
        'list_appointment_group_users',
        'list_appointment_group_groups',
        'next_appointment',
      ]
      const tools = appointmentGroupTools(buildMockCanvas())
      for (const name of readNames) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.annotations, `${name} should have readOnlyHint`).toEqual({
          readOnlyHint: true,
          openWorldHint: true,
        })
      }
    })

    it('write tools have destructiveHint + openWorldHint', () => {
      const writeNames = [
        'create_appointment_group',
        'update_appointment_group',
        'delete_appointment_group',
      ]
      const tools = appointmentGroupTools(buildMockCanvas())
      for (const name of writeNames) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.annotations, `${name} should have destructiveHint`).toEqual({
          destructiveHint: true,
          openWorldHint: true,
        })
      }
    })
  })

  describe('audience', () => {
    it('shared tools declare audience: shared', () => {
      const sharedNames = ['list_appointment_groups', 'get_appointment_group', 'next_appointment']
      const tools = appointmentGroupTools(buildMockCanvas())
      for (const name of sharedNames) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.audience, `${name} should be shared`).toBe('shared')
      }
    })

    it('educator-only tools do not override audience', () => {
      const educatorNames = [
        'create_appointment_group',
        'update_appointment_group',
        'delete_appointment_group',
        'list_appointment_group_users',
        'list_appointment_group_groups',
      ]
      const tools = appointmentGroupTools(buildMockCanvas())
      for (const name of educatorNames) {
        const tool = tools.find((t) => t.name === name)!
        expect(tool.audience, `${name} should not override audience`).toBeUndefined()
      }
    })
  })

  describe('list_appointment_groups', () => {
    it('delegates to canvas.appointmentGroups.list', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'list_appointment_groups')!
      const result = await tool.handler({ scope: 'reservable' })
      expect(canvas.appointmentGroups.list).toHaveBeenCalledWith({
        scope: 'reservable',
        include: undefined,
        context_codes: undefined,
      })
      expect(result).toEqual([mockAppointmentGroup])
    })

    it('passes all optional params', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'list_appointment_groups')!
      await tool.handler({
        scope: 'manageable',
        include: ['appointments', 'participant_count'],
        context_codes: ['course_10'],
      })
      expect(canvas.appointmentGroups.list).toHaveBeenCalledWith({
        scope: 'manageable',
        include: ['appointments', 'participant_count'],
        context_codes: ['course_10'],
      })
    })

    describe('pseudonymization of child_events', () => {
      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'appt-group-list-'))
      })
      afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
      })

      function makePseudonymizer(enabled = true) {
        return new Pseudonymizer({
          baseUrl: 'https://school.instructure.com/api/v1',
          rootDir: tmpDir,
          env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
        })
      }

      it('pseudonymizes user in child_events when pseudonymizer is enabled', async () => {
        const canvas = {
          ...buildMockCanvas(),
          appointmentGroups: {
            ...buildMockCanvas().appointmentGroups,
            list: vi.fn().mockResolvedValue([mockAppointmentGroupWithChildEvents]),
          },
        } as unknown as CanvasClient
        const tool = appointmentGroupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_appointment_groups',
        )!
        const result = (await tool.handler({
          include: ['appointments', 'child_events'],
        })) as CanvasAppointmentGroup[]
        const childUser = result[0].appointments?.[0].child_events?.[0].user
        expect(childUser?.name).toMatch(/^Student \d+$/)
        expect(childUser?.email).toMatch(/@anon\.invalid$/)
      })

      it('passes through real names in child_events when pseudonymizer is disabled', async () => {
        const canvas = {
          ...buildMockCanvas(),
          appointmentGroups: {
            ...buildMockCanvas().appointmentGroups,
            list: vi.fn().mockResolvedValue([mockAppointmentGroupWithChildEvents]),
          },
        } as unknown as CanvasClient
        const tool = appointmentGroupTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_appointment_groups',
        )!
        const result = (await tool.handler({
          include: ['appointments', 'child_events'],
        })) as CanvasAppointmentGroup[]
        const childUser = result[0].appointments?.[0].child_events?.[0].user
        expect(childUser?.name).toBe('Alice')
      })

      it('returns groups unchanged when no appointments are embedded', async () => {
        const canvas = buildMockCanvas()
        const tool = appointmentGroupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_appointment_groups',
        )!
        const result = (await tool.handler({})) as CanvasAppointmentGroup[]
        expect(result[0]).toEqual(mockAppointmentGroup)
      })
    })
  })

  describe('get_appointment_group', () => {
    it('delegates to canvas.appointmentGroups.get', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'get_appointment_group')!
      const result = await tool.handler({ appointment_group_id: 1 })
      expect(canvas.appointmentGroups.get).toHaveBeenCalledWith(1, undefined)
      expect(result).toEqual(mockAppointmentGroup)
    })

    it('passes include when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'get_appointment_group')!
      await tool.handler({ appointment_group_id: 1, include: ['appointments'] })
      expect(canvas.appointmentGroups.get).toHaveBeenCalledWith(1, ['appointments'])
    })

    describe('pseudonymization of child_events', () => {
      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'appt-group-get-'))
      })
      afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
      })

      function makePseudonymizer(enabled = true) {
        return new Pseudonymizer({
          baseUrl: 'https://school.instructure.com/api/v1',
          rootDir: tmpDir,
          env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
        })
      }

      it('pseudonymizes user in child_events when pseudonymizer is enabled', async () => {
        const canvas = {
          ...buildMockCanvas(),
          appointmentGroups: {
            ...buildMockCanvas().appointmentGroups,
            get: vi.fn().mockResolvedValue(mockAppointmentGroupWithChildEvents),
          },
        } as unknown as CanvasClient
        const tool = appointmentGroupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'get_appointment_group',
        )!
        const result = (await tool.handler({
          appointment_group_id: 1,
          include: ['appointments', 'child_events'],
        })) as CanvasAppointmentGroup
        const childUser = result.appointments?.[0].child_events?.[0].user
        expect(childUser?.name).toMatch(/^Student \d+$/)
        expect(childUser?.email).toMatch(/@anon\.invalid$/)
      })

      it('passes through real names in child_events when pseudonymizer is disabled', async () => {
        const canvas = {
          ...buildMockCanvas(),
          appointmentGroups: {
            ...buildMockCanvas().appointmentGroups,
            get: vi.fn().mockResolvedValue(mockAppointmentGroupWithChildEvents),
          },
        } as unknown as CanvasClient
        const tool = appointmentGroupTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'get_appointment_group',
        )!
        const result = (await tool.handler({
          appointment_group_id: 1,
          include: ['appointments', 'child_events'],
        })) as CanvasAppointmentGroup
        const childUser = result.appointments?.[0].child_events?.[0].user
        expect(childUser?.name).toBe('Alice')
      })
    })
  })

  describe('create_appointment_group', () => {
    it('delegates to canvas.appointmentGroups.create', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'create_appointment_group')!
      const result = await tool.handler({
        context_codes: ['course_10'],
        title: 'Office Hours',
        publish: true,
      })
      expect(canvas.appointmentGroups.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context_codes: ['course_10'],
          title: 'Office Hours',
          publish: true,
        }),
      )
      expect(result).toEqual(mockAppointmentGroup)
    })

    it('validates scope enum — accepts known values', () => {
      const schema = z.object(
        appointmentGroupTools(buildMockCanvas()).find((t) => t.name === 'list_appointment_groups')!
          .inputSchema,
      )
      expect(schema.safeParse({ scope: 'reservable' }).success).toBe(true)
      expect(schema.safeParse({ scope: 'manageable' }).success).toBe(true)
      expect(schema.safeParse({ scope: 'unknown' }).success).toBe(false)
    })
  })

  describe('update_appointment_group', () => {
    it('delegates to canvas.appointmentGroups.update', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'update_appointment_group')!
      await tool.handler({ appointment_group_id: 1, title: 'New Title', publish: true })
      expect(canvas.appointmentGroups.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: 'New Title', publish: true }),
      )
    })
  })

  describe('delete_appointment_group', () => {
    it('delegates to canvas.appointmentGroups.delete without reason', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'delete_appointment_group')!
      await tool.handler({ appointment_group_id: 1 })
      expect(canvas.appointmentGroups.delete).toHaveBeenCalledWith(1, undefined)
    })

    it('passes cancel_reason when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'delete_appointment_group')!
      await tool.handler({ appointment_group_id: 1, cancel_reason: 'Rescheduled' })
      expect(canvas.appointmentGroups.delete).toHaveBeenCalledWith(1, 'Rescheduled')
    })
  })

  describe('list_appointment_group_users', () => {
    it('delegates to canvas.appointmentGroups.listUsers', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find(
        (t) => t.name === 'list_appointment_group_users',
      )!
      const result = await tool.handler({ appointment_group_id: 1 })
      expect(canvas.appointmentGroups.listUsers).toHaveBeenCalledWith(1)
      expect(result).toEqual([mockUser])
    })

    describe('pseudonymization', () => {
      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'appt-group-tool-'))
      })
      afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
      })

      function makePseudonymizer(enabled = true) {
        return new Pseudonymizer({
          baseUrl: 'https://school.instructure.com/api/v1',
          rootDir: tmpDir,
          env: enabled ? { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' } : {},
        })
      }

      it('pseudonymizes user names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = appointmentGroupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_appointment_group_users',
        )!
        const result = (await tool.handler({ appointment_group_id: 1 })) as CanvasUser[]
        expect(result[0].name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = appointmentGroupTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_appointment_group_users',
        )!
        const result = (await tool.handler({ appointment_group_id: 1 })) as CanvasUser[]
        expect(result[0].name).toBe('Alice')
      })
    })
  })

  describe('list_appointment_group_groups', () => {
    it('delegates to canvas.appointmentGroups.listGroups', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find(
        (t) => t.name === 'list_appointment_group_groups',
      )!
      const result = await tool.handler({ appointment_group_id: 1 })
      expect(canvas.appointmentGroups.listGroups).toHaveBeenCalledWith(1)
      expect(result).toEqual([])
    })
  })

  describe('next_appointment', () => {
    it('delegates to canvas.appointmentGroups.nextAppointment without ids', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'next_appointment')!
      const result = await tool.handler({})
      expect(canvas.appointmentGroups.nextAppointment).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockEvent])
    })

    it('passes appointment_group_ids when provided', async () => {
      const canvas = buildMockCanvas()
      const tool = appointmentGroupTools(canvas).find((t) => t.name === 'next_appointment')!
      await tool.handler({ appointment_group_ids: [1, 2] })
      expect(canvas.appointmentGroups.nextAppointment).toHaveBeenCalledWith([1, 2])
    })
  })
})
