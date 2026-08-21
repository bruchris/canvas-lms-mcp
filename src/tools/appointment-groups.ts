import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

const includeSchema = z
  .array(z.enum(['appointments', 'child_events', 'participant_count']))
  .optional()
  .describe(
    'Extra data to include: appointments (time slots), child_events (per-slot reservations), participant_count',
  )

// `new_appointments` MUST stay `z.array(z.array(z.string()).length(2))`, never
// `z.array(z.tuple([z.string(), z.string()]))`. z.tuple() compiles to
// draft-07 positional `"items": [...]` (or 2020-12 `prefixItems`); Anthropic
// accepts that shape but OpenAI-compatible backends (Z.AI/GLM confirmed)
// reject the *entire request* the moment either appointment-group tool is
// registered, since MCP clients send all registered tools on every call.
// Regression: https://github.com/bruchris/canvas-lms-mcp/pull/308. Guarded by
// tests/tools/tool-schema-shape.test.ts, which walks the real tools/list wire
// output for tuple-style array schemas across every tool, not just this one.

export function appointmentGroupTools(
  canvas: CanvasClient,
  pseudonymizer?: Pseudonymizer,
): ToolDefinition[] {
  return [
    {
      name: 'list_appointment_groups',
      title: 'List Appointment Groups',
      description:
        'List appointment groups (Canvas Scheduler sign-up slots). Use scope=reservable to find groups students can reserve, or scope=manageable for groups the current user manages.',
      inputSchema: {
        scope: z
          .enum(['reservable', 'manageable'])
          .optional()
          .describe(
            'Filter by scope: "reservable" (student sign-ups) or "manageable" (instructor-owned)',
          ),
        include: includeSchema,
        context_codes: z
          .array(z.string())
          .optional()
          .describe('Limit to specific contexts, e.g. ["course_123"]'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      audience: 'shared',
      handler: async (params) => {
        const groups = await canvas.appointmentGroups.list({
          scope: params.scope as 'reservable' | 'manageable' | undefined,
          include: params.include as
            Array<'appointments' | 'child_events' | 'participant_count'> | undefined,
          context_codes: params.context_codes as string[] | undefined,
        })
        if (!pseudonymizer?.isEnabled()) return groups
        return Promise.all(groups.map((g) => pseudonymizer.anonymizeAppointmentGroupResponse(g)))
      },
    },
    {
      name: 'get_appointment_group',
      title: 'Get Appointment Group',
      description:
        'Get a single appointment group by ID, including its time slots and participant counts.',
      inputSchema: {
        appointment_group_id: z.number().describe('The appointment group ID'),
        include: includeSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      audience: 'shared',
      handler: async (params) => {
        const group = await canvas.appointmentGroups.get(
          params.appointment_group_id as number,
          params.include as
            Array<'appointments' | 'child_events' | 'participant_count'> | undefined,
        )
        if (!pseudonymizer?.isEnabled()) return group
        return pseudonymizer.anonymizeAppointmentGroupResponse(group)
      },
    },
    {
      name: 'create_appointment_group',
      title: 'Create Appointment Group',
      description:
        'Create a new appointment group (sign-up slots) in Canvas Scheduler. Provide at least one context_code (e.g. "course_123") and a title. Add new_appointments as [start_at, end_at] pairs to define time slots.',
      inputSchema: {
        context_codes: z
          .array(z.string())
          .describe('Contexts to associate with this group, e.g. ["course_123"]'),
        title: z.string().describe('Title of the appointment group'),
        description: z.string().optional().describe('Optional description'),
        location_name: z.string().optional().describe('Location name'),
        location_address: z.string().optional().describe('Location address'),
        publish: z
          .boolean()
          .optional()
          .describe('If true, publish immediately (default: false = draft)'),
        participant_type: z
          .enum(['User', 'Group'])
          .optional()
          .describe('Whether individuals (User) or groups (Group) sign up. Default: User'),
        max_appointments_per_participant: z
          .number()
          .optional()
          .describe('Maximum time slots each participant can reserve'),
        min_appointments_per_participant: z
          .number()
          .optional()
          .describe('Minimum time slots each participant must reserve'),
        participant_visibility: z
          .enum(['private', 'protected'])
          .optional()
          .describe(
            'Who can see other sign-ups: "private" (instructors only) or "protected" (all participants)',
          ),
        new_appointments: z
          .array(z.array(z.string()).length(2))
          .optional()
          .describe('Time slots to create as [start_at, end_at] pairs (ISO 8601 strings)'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.appointmentGroups.create({
          context_codes: params.context_codes as string[],
          title: params.title as string,
          description: params.description as string | undefined,
          location_name: params.location_name as string | undefined,
          location_address: params.location_address as string | undefined,
          publish: params.publish as boolean | undefined,
          participant_type: params.participant_type as 'User' | 'Group' | undefined,
          max_appointments_per_participant: params.max_appointments_per_participant as
            number | undefined,
          min_appointments_per_participant: params.min_appointments_per_participant as
            number | undefined,
          participant_visibility: params.participant_visibility as
            'private' | 'protected' | undefined,
          new_appointments: params.new_appointments as Array<[string, string]> | undefined,
        }),
    },
    {
      name: 'update_appointment_group',
      title: 'Update Appointment Group',
      description:
        'Update an existing appointment group. Use publish=true to make a draft group visible to participants, or add new time slots via new_appointments.',
      inputSchema: {
        appointment_group_id: z.number().describe('The appointment group ID'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        location_name: z.string().optional().describe('Location name'),
        location_address: z.string().optional().describe('Location address'),
        publish: z.boolean().optional().describe('Set to true to publish the group'),
        context_codes: z.array(z.string()).optional().describe('Update context associations'),
        new_appointments: z
          .array(z.array(z.string()).length(2))
          .optional()
          .describe('New time slots to add as [start_at, end_at] pairs'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.appointmentGroups.update(params.appointment_group_id as number, {
          title: params.title as string | undefined,
          description: params.description as string | undefined,
          location_name: params.location_name as string | undefined,
          location_address: params.location_address as string | undefined,
          publish: params.publish as boolean | undefined,
          context_codes: params.context_codes as string[] | undefined,
          new_appointments: params.new_appointments as Array<[string, string]> | undefined,
        }),
    },
    {
      name: 'delete_appointment_group',
      title: 'Delete Appointment Group',
      description:
        'Delete an appointment group and cancel any existing reservations. Provide cancel_reason to notify participants.',
      inputSchema: {
        appointment_group_id: z.number().describe('The appointment group ID'),
        cancel_reason: z
          .string()
          .optional()
          .describe('Message to include in cancellation notifications'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.appointmentGroups.delete(
          params.appointment_group_id as number,
          params.cancel_reason as string | undefined,
        ),
    },
    {
      name: 'list_appointment_group_users',
      title: 'List Appointment Group Users',
      description: 'List participants (users) who have reserved a slot in an appointment group.',
      inputSchema: {
        appointment_group_id: z.number().describe('The appointment group ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const users = await canvas.appointmentGroups.listUsers(
          params.appointment_group_id as number,
        )
        if (!pseudonymizer?.isEnabled()) return users
        return pseudonymizer.anonymizeUsers(
          `_apptgrp_${params.appointment_group_id as number}`,
          users,
        )
      },
    },
    {
      name: 'list_appointment_group_groups',
      title: 'List Appointment Group Groups',
      description:
        'List student groups that have reserved a slot in an appointment group (when participant_type=Group).',
      inputSchema: {
        appointment_group_id: z.number().describe('The appointment group ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.appointmentGroups.listGroups(params.appointment_group_id as number),
    },
    {
      name: 'next_appointment',
      title: 'Next Appointment',
      description:
        "Get the current user's next upcoming appointment across all (or specified) appointment groups.",
      inputSchema: {
        appointment_group_ids: z
          .array(z.number())
          .optional()
          .describe('Limit to specific appointment group IDs'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      audience: 'shared',
      handler: async (params) =>
        canvas.appointmentGroups.nextAppointment(
          params.appointment_group_ids as number[] | undefined,
        ),
    },
  ]
}
