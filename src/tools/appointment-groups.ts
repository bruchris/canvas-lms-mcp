import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import { type CanvasId, canvasIdInput } from '../canvas/id'

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
        'List appointment groups (Canvas Scheduler sign-up slots) visible to the current user, ' +
        "returning each group's id, title, context_codes, workflow_state, and location — time " +
        'slots, per-slot reservations, and participant counts are each left out unless you pass ' +
        'the matching include value. scope defaults to "reservable" (groups the user is eligible ' +
        'to sign up for; reserving a slot itself happens in the Canvas UI, not through this ' +
        'server) and can be set to "manageable" for the groups the user administers. Fetches ' +
        "every page (100 per request) and fails with a 'Results are incomplete' error instead of " +
        "silently truncating. Use get_appointment_group for one group's full detail by id, and " +
        'next_appointment to find the next open slot instead of browsing every group.',
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
        "Get a single appointment group's core record — id, title, context_codes, " +
        'workflow_state, and location — by id. None of its time slots, per-slot reservations, ' +
        'or participant counts come back unless you pass include with "appointments", ' +
        '"child_events", or "participant_count" respectively; omit include and you get only the ' +
        'core record. Find the id with list_appointment_groups. Use list_appointment_group_users ' +
        'or list_appointment_group_groups to see who has actually reserved a slot, and ' +
        'next_appointment to find the next slot still open to sign up for.',
      inputSchema: {
        appointment_group_id: canvasIdInput().describe('The appointment group ID'),
        include: includeSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      audience: 'shared',
      handler: async (params) => {
        const group = await canvas.appointmentGroups.get(
          params.appointment_group_id as CanvasId,
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
        'Create a new appointment group (Canvas Scheduler sign-up slots) in one or more ' +
        'contexts, e.g. ["course_123"], and return the created group object (id, title, ' +
        'workflow_state, context_codes). New groups start workflow_state "pending" (unpublished, ' +
        'invisible to participants) unless publish=true — once published, Canvas will not let it ' +
        'go back to unpublished, so confirm with get_appointment_group before setting it. ' +
        'participant_visibility defaults to "private"; set it to "protected" so signed-up ' +
        "participants can see each other's sign-ups. Add new_appointments as [start_at, end_at] " +
        'ISO 8601 pairs to create the bookable time slots up front, or add more later with ' +
        'update_appointment_group. Each call creates another group — there is no dedup against ' +
        'an existing title. Requires permission to manage the Scheduler in every context listed.',
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
        'Update an existing appointment group by id — only the fields you pass are changed — ' +
        'and return the updated group object. Set publish=true to make a draft group visible to ' +
        'participants; Canvas will not let you set it back to false once published. Add ' +
        'new_appointments as [start_at, end_at] ISO 8601 pairs to create additional time slots — ' +
        'existing slots are left alone and there is no removal here. This tool cannot change ' +
        'participant_type, participant_visibility, or the per-participant appointment limits set ' +
        'at create_appointment_group; those are fixed at creation. Find the id with ' +
        "list_appointment_groups. Requires permission to manage the Scheduler in the group's " +
        'context.',
      inputSchema: {
        appointment_group_id: canvasIdInput().describe('The appointment group ID'),
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
        canvas.appointmentGroups.update(params.appointment_group_id as CanvasId, {
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
        'Delete an appointment group by id, canceling every time slot and reservation on it and ' +
        'emailing every signed-up participant, then return the deleted group object. This is ' +
        'permanent: the group and its slots cannot be recovered afterward. Pass cancel_reason to ' +
        'include why in that cancellation email. Find the id with list_appointment_groups, and ' +
        'check list_appointment_group_users or list_appointment_group_groups first if you need ' +
        'to know who will be notified. Requires permission to manage the Scheduler in the ' +
        "group's context.",
      inputSchema: {
        appointment_group_id: canvasIdInput().describe('The appointment group ID'),
        cancel_reason: z
          .string()
          .optional()
          .describe('Message to include in cancellation notifications'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      handler: async (params) =>
        canvas.appointmentGroups.delete(
          params.appointment_group_id as CanvasId,
          params.cancel_reason as string | undefined,
        ),
    },
    {
      name: 'list_appointment_group_users',
      title: 'List Appointment Group Users',
      description:
        'List the individual Canvas users who have a reservation in this appointment group, ' +
        "returning each as a user object (id, name). Only meaningful when the group's " +
        'participant_type is "User" — a Group-type group returns an empty list here; use ' +
        'list_appointment_group_groups instead for those. Fetches every page (100 per request) ' +
        "and fails with a 'Results are incomplete' error instead of silently truncating. Find " +
        'the appointment_group_id with list_appointment_groups, or use get_appointment_group ' +
        'with include=["participant_count"] for just a count instead of the full list.',
      inputSchema: {
        appointment_group_id: canvasIdInput().describe('The appointment group ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        const users = await canvas.appointmentGroups.listUsers(
          params.appointment_group_id as CanvasId,
        )
        if (!pseudonymizer?.isEnabled()) return users
        return pseudonymizer.anonymizeUsers(
          `_apptgrp_${params.appointment_group_id as CanvasId}`,
          users,
        )
      },
    },
    {
      name: 'list_appointment_group_groups',
      title: 'List Appointment Group Groups',
      description:
        'List the student groups that have a reservation in this appointment group, returning ' +
        'each as a group object (id, name, group_category_id, members_count) — the same shape ' +
        'list_groups returns. Only meaningful when the group\'s participant_type is "Group" — a ' +
        'User-type group returns an empty list here; use list_appointment_group_users instead ' +
        "for those. Fetches every page (100 per request) and fails with a 'Results are " +
        "incomplete' error instead of silently truncating. Find the appointment_group_id with " +
        'list_appointment_groups.',
      inputSchema: {
        appointment_group_id: canvasIdInput().describe('The appointment group ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (params) => {
        // These are ordinary student groups, rendered by the same `group_json`
        // as `list_groups` — so the reserving group's leader arrives with a
        // real name unless it is pseudonymized here too (#441).
        const groups = await canvas.appointmentGroups.listGroups(
          params.appointment_group_id as CanvasId,
        )
        if (!pseudonymizer?.isEnabled()) return groups
        return pseudonymizer.anonymizeGroups(groups)
      },
    },
    {
      name: 'next_appointment',
      title: 'Next Appointment',
      description:
        'Get the single next open time slot the current user is still eligible to sign up for, ' +
        'searched across every appointment group the user can reserve in (or only the ' +
        'appointment_group_ids you pass), and return it as a one-element array of calendar-event ' +
        'objects — or an empty array if nothing is open. This is about availability, not ' +
        'history: it excludes slots the user already reserved and slots that are full, but does ' +
        'not exclude a whole group just because the user holds a reservation in one of its other ' +
        'slots. Use list_appointment_groups with scope="reservable" to browse every open group ' +
        'instead of just the next slot, and list_appointment_group_users to see existing ' +
        'reservations.',
      inputSchema: {
        appointment_group_ids: z
          .array(canvasIdInput())
          .optional()
          .describe('Limit to specific appointment group IDs'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      audience: 'shared',
      handler: async (params) =>
        canvas.appointmentGroups.nextAppointment(
          params.appointment_group_ids as CanvasId[] | undefined,
        ),
    },
  ]
}
