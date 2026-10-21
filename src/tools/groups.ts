import { z } from 'zod'
import type { CanvasClient } from '../canvas'
import { groupScopeKey, type Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'
import type { CanvasGroup } from '../canvas/types'
import type { CreateGroupParams } from '../canvas/groups'
import { type CanvasId, canvasIdInput } from '../canvas/id'

// Group WRITE responses may embed user identities even when pseudonymization
// is enabled. A newly created group has no leader and no members, and a deleted
// one is gone, so there is nothing a caller can do with either field: dropping
// them is both safe and lossless here. The read paths pseudonymize instead,
// because a group's leader is information an educator legitimately needs
// (#438 strips, #441 pseudonymizes).
function stripGroupUsers({ leader: _leader, users: _users, ...group }: CanvasGroup): CanvasGroup {
  return group
}

export function groupTools(canvas: CanvasClient, pseudonymizer?: Pseudonymizer): ToolDefinition[] {
  return [
    {
      name: 'list_groups',
      title: 'List Groups',
      description: 'List all groups in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        const groups = await canvas.groups.list(course_id)
        if (!pseudonymizer?.isEnabled()) return groups
        return pseudonymizer.anonymizeGroups(groups)
      },
    },
    {
      name: 'list_group_members',
      title: 'List Group Members',
      description: 'List all members of a group.',
      inputSchema: {
        group_id: canvasIdInput().describe('The Canvas group ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as CanvasId
        const users = await canvas.groups.listMembers(group_id)
        if (!pseudonymizer?.isEnabled()) return users
        // No course context — group identities share their own pseudonym pool,
        // which is also where `list_groups` puts a group's leader.
        return pseudonymizer.anonymizeUsers(groupScopeKey(group_id), users)
      },
    },
    {
      name: 'list_group_categories',
      title: 'List Group Categories',
      audience: 'educator',
      description:
        'List the group categories (group sets) in a course. A group assignment points at a category through its group_category_id, and create_group needs a category ID, so use this to find one.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.groups.listCategories(course_id)
      },
    },
    {
      name: 'create_group_category',
      title: 'Create Group Category',
      audience: 'educator',
      description: 'Create a new, empty group category (group set) in a course.',
      inputSchema: {
        course_id: canvasIdInput().describe('The Canvas course ID'),
        name: z.string().describe('Name of the group category'),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const course_id = params.course_id as CanvasId
        return canvas.groups.createCategory(course_id, { name: params.name as string })
      },
    },
    {
      name: 'create_group',
      title: 'Create Group',
      audience: 'educator',
      description:
        'Create a group inside a group category. This is addressed by group_category_id, not by course ID: find the category with list_group_categories. The new group has no members; add them with add_group_member.',
      inputSchema: {
        group_category_id: canvasIdInput().describe(
          'The Canvas group category ID to create the group in (not a course ID)',
        ),
        name: z.string().describe('Name of the group'),
        description: z.string().optional().describe('Description of the group'),
        join_level: z
          .enum(['parent_context_auto_join', 'parent_context_request', 'invitation_only'])
          .optional()
          .describe(
            'Join policy for the group. Only affects self-joining in categories that allow multiple memberships (e.g. student-organized); for teacher-managed group sets, self-signup is a category setting.',
          ),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_category_id = params.group_category_id as CanvasId
        const group = await canvas.groups.create(group_category_id, {
          name: params.name as string,
          description: params.description as string | undefined,
          join_level: params.join_level as CreateGroupParams['join_level'],
        })
        return stripGroupUsers(group)
      },
    },
    {
      name: 'delete_group',
      title: 'Delete Group',
      audience: 'educator',
      description:
        'Permanently delete a group and remove all of its members. The students stay enrolled in the course and the group category remains. Creating a group again does not restore the same group.',
      inputSchema: {
        group_id: canvasIdInput().describe('The Canvas group ID to delete'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as CanvasId
        return stripGroupUsers(await canvas.groups.delete(group_id))
      },
    },
    {
      name: 'add_group_member',
      title: 'Add Group Member',
      audience: 'educator',
      description:
        'Add a user to a group. Returns the membership Canvas reports; if the user is already a member, Canvas returns the existing membership. remove_group_member removes this membership; it does not restore any other group membership Canvas changed.',
      inputSchema: {
        group_id: canvasIdInput().describe('The Canvas group ID'),
        user_id: canvasIdInput().describe('The Canvas user ID to add'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as CanvasId
        const user_id = params.user_id as CanvasId
        return canvas.groups.addMember(group_id, user_id)
      },
    },
    {
      name: 'remove_group_member',
      title: 'Remove Group Member',
      audience: 'educator',
      description:
        'Remove a user from a group. The user stays enrolled in the course. Reverse with add_group_member.',
      inputSchema: {
        group_id: canvasIdInput().describe('The Canvas group ID'),
        user_id: canvasIdInput().describe('The Canvas user ID to remove'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const group_id = params.group_id as CanvasId
        const user_id = params.user_id as CanvasId
        return canvas.groups.removeMember(group_id, user_id)
      },
    },
  ]
}
