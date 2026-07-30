import type { CanvasHttpClient } from './client'
import type { CanvasQueryParams } from './query'
import type { CanvasAppointmentGroup, CanvasCalendarEvent, CanvasGroup, CanvasUser } from './types'

export type AppointmentGroupInclude = 'appointments' | 'child_events' | 'participant_count'

export class AppointmentGroupsModule {
  constructor(private client: CanvasHttpClient) {}

  async list(params?: {
    scope?: 'reservable' | 'manageable'
    include?: ReadonlyArray<AppointmentGroupInclude>
    context_codes?: string[]
  }): Promise<CanvasAppointmentGroup[]> {
    const query: CanvasQueryParams = {}
    if (params?.scope) query.scope = params.scope
    if (params?.include?.length) query.include = [...params.include]
    if (params?.context_codes?.length) query.context_codes = params.context_codes
    return this.client.paginate<CanvasAppointmentGroup>('/api/v1/appointment_groups', query)
  }

  async get(
    id: number,
    include?: ReadonlyArray<AppointmentGroupInclude>,
  ): Promise<CanvasAppointmentGroup> {
    const query: CanvasQueryParams = {}
    if (include?.length) query.include = [...include]
    return this.client.request<CanvasAppointmentGroup>(`/api/v1/appointment_groups/${id}`, {
      query,
    })
  }

  async create(params: {
    context_codes: string[]
    title: string
    description?: string
    location_name?: string
    location_address?: string
    publish?: boolean
    participant_type?: 'User' | 'Group'
    max_appointments_per_participant?: number
    min_appointments_per_participant?: number
    new_appointments?: Array<[string, string]>
    participant_visibility?: 'private' | 'protected'
  }): Promise<CanvasAppointmentGroup> {
    return this.client.request<CanvasAppointmentGroup>('/api/v1/appointment_groups', {
      method: 'POST',
      body: JSON.stringify({ appointment_group: params }),
    })
  }

  async update(
    id: number,
    params: {
      context_codes?: string[]
      title?: string
      description?: string
      location_name?: string
      location_address?: string
      publish?: boolean
      new_appointments?: Array<[string, string]>
    },
  ): Promise<CanvasAppointmentGroup> {
    return this.client.request<CanvasAppointmentGroup>(`/api/v1/appointment_groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ appointment_group: params }),
    })
  }

  async delete(id: number, cancelReason?: string): Promise<void> {
    const body = cancelReason ? JSON.stringify({ cancel_reason: cancelReason }) : undefined
    return this.client.request<void>(`/api/v1/appointment_groups/${id}`, {
      method: 'DELETE',
      body,
    })
  }

  async listUsers(id: number): Promise<CanvasUser[]> {
    return this.client.paginate<CanvasUser>(`/api/v1/appointment_groups/${id}/users`)
  }

  async listGroups(id: number): Promise<CanvasGroup[]> {
    return this.client.paginate<CanvasGroup>(`/api/v1/appointment_groups/${id}/groups`)
  }

  async nextAppointment(appointmentGroupIds?: number[]): Promise<CanvasCalendarEvent[]> {
    const query: CanvasQueryParams = {}
    if (appointmentGroupIds?.length) query.appointment_group_ids = appointmentGroupIds
    return this.client.request<CanvasCalendarEvent[]>(
      '/api/v1/appointment_groups/next_appointment',
      { query },
    )
  }
}
