import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer, WITHHELD_AUTHOR_NAME } from '../../src/pseudonym/pseudonymizer'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import type {
  CanvasGroup,
  CanvasGroupCategory,
  CanvasGroupMembership,
  CanvasUser,
} from '../../src/canvas/types'
import { formatError } from '../../src/tools/errors'
import { groupTools } from '../../src/tools/groups'
import {
  GROUP_JSON_REAL_NAMES,
  REAL_GROUP_LEADER_NAME,
  REAL_GROUP_MEMBER_NAME,
  groupJsonWithLeader,
  groupJsonWithUsers,
} from './fixtures/group-json'

describe('groupTools', () => {
  const mockGroup: CanvasGroup = {
    id: 1,
    name: 'Group A',
    description: null,
    members_count: 3,
    context_type: 'Course',
    course_id: 1,
    group_category_id: 1,
  }

  const mockUser: CanvasUser = {
    id: 5,
    name: 'Alice',
    sortable_name: 'Alice',
    short_name: 'Alice',
    login_id: 'alice@example.com',
    email: 'alice@example.com',
    created_at: '2026-01-01T00:00:00Z',
  }

  const mockCategory: CanvasGroupCategory = { id: 10, name: 'Project Groups' }

  const mockMembership: CanvasGroupMembership = {
    id: 77,
    group_id: 1,
    user_id: 5,
    workflow_state: 'accepted',
    moderator: false,
    just_created: true,
  }

  const mockGroupWithUsers = {
    ...mockGroup,
    leader: { id: '5', display_name: 'Real Name' },
    users: [{ id: '7', name: 'Real Student' }],
  }

  function buildMockCanvas(): CanvasClient {
    return {
      groups: {
        list: vi.fn().mockResolvedValue([mockGroup]),
        listMembers: vi.fn().mockResolvedValue([mockUser]),
        listCategories: vi.fn().mockResolvedValue([mockCategory]),
        createCategory: vi.fn().mockResolvedValue(mockCategory),
        create: vi.fn().mockResolvedValue(mockGroupWithUsers),
        delete: vi.fn().mockResolvedValue(mockGroupWithUsers),
        addMember: vi.fn().mockResolvedValue(mockMembership),
        removeMember: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as unknown as CanvasClient
  }

  function tool(canvas: CanvasClient, name: string) {
    return groupTools(canvas).find((t) => t.name === name)!
  }

  it('returns an array with 8 tool definitions', () => {
    expect(groupTools(buildMockCanvas())).toHaveLength(8)
  })

  it('exports tools with correct names', () => {
    const names = groupTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_groups',
      'list_group_members',
      'list_group_categories',
      'create_group_category',
      'create_group',
      'delete_group',
      'add_group_member',
      'remove_group_member',
    ])
  })

  describe('list_groups', () => {
    it('has read-only annotations', () => {
      const tool = groupTools(buildMockCanvas()).find((t) => t.name === 'list_groups')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.groups.list', async () => {
      const canvas = buildMockCanvas()
      const tool = groupTools(canvas).find((t) => t.name === 'list_groups')!
      await tool.handler({ course_id: '1' })
      expect(canvas.groups.list).toHaveBeenCalledWith('1')
    })
  })

  describe('list_group_members', () => {
    it('has read-only annotations', () => {
      const tool = groupTools(buildMockCanvas()).find((t) => t.name === 'list_group_members')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.groups.listMembers', async () => {
      const canvas = buildMockCanvas()
      const tool = groupTools(canvas).find((t) => t.name === 'list_group_members')!
      await tool.handler({ group_id: '1' })
      expect(canvas.groups.listMembers).toHaveBeenCalledWith('1')
    })
  })

  describe('list_group_categories', () => {
    it('is a read-only educator tool', () => {
      const t = tool(buildMockCanvas(), 'list_group_categories')
      expect(t.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
      expect(t.audience).toBe('educator')
    })

    it('delegates to canvas.groups.listCategories', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'list_group_categories').handler({ course_id: '1' })
      expect(canvas.groups.listCategories).toHaveBeenCalledWith('1')
      expect(result).toEqual([mockCategory])
    })
  })

  describe('create_group_category', () => {
    it('takes course_id and name only', () => {
      const t = tool(buildMockCanvas(), 'create_group_category')
      expect(Object.keys(t.inputSchema).sort()).toEqual(['course_id', 'name'])
      expect(t.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.groups.createCategory', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'create_group_category').handler({
        course_id: '1',
        name: 'Project Groups',
      })
      expect(canvas.groups.createCategory).toHaveBeenCalledWith('1', { name: 'Project Groups' })
      expect(result).toEqual(mockCategory)
    })
  })

  describe('create_group', () => {
    it('is addressed by group_category_id and takes no course_id', () => {
      const t = tool(buildMockCanvas(), 'create_group')
      expect(t.inputSchema).toHaveProperty('group_category_id')
      expect(t.inputSchema).not.toHaveProperty('course_id')
      expect(t.description).toContain('not by course ID')
      expect(t.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.groups.create with the category ID', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'create_group').handler({
        group_category_id: '10',
        name: 'Red One',
        join_level: 'invitation_only',
      })
      expect(canvas.groups.create).toHaveBeenCalledWith('10', {
        name: 'Red One',
        description: undefined,
        join_level: 'invitation_only',
      })
      expect(result).toEqual(mockGroup)
      expect(result).not.toHaveProperty('leader')
      expect(result).not.toHaveProperty('users')
    })
  })

  describe('delete_group', () => {
    it('has destructive + idempotent annotations', () => {
      expect(tool(buildMockCanvas(), 'delete_group').annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.groups.delete and returns the deleted group', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'delete_group').handler({ group_id: '1' })
      expect(canvas.groups.delete).toHaveBeenCalledWith('1')
      expect(result).toEqual(mockGroup)
      expect(result).not.toHaveProperty('leader')
      expect(result).not.toHaveProperty('users')
    })
  })

  describe('add_group_member', () => {
    it('has destructive + idempotent annotations', () => {
      expect(tool(buildMockCanvas(), 'add_group_member').annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('returns the membership Canvas reports, unchanged', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'add_group_member').handler({ group_id: '1', user_id: '5' })
      expect(canvas.groups.addMember).toHaveBeenCalledWith('1', '5')
      expect(result).toEqual(mockMembership)
    })

    it('does not describe moving a user between groups', () => {
      const words = tool(buildMockCanvas(), 'add_group_member')
        .description.toLowerCase()
        .split(/\W+/)
      expect(words.filter((w) => w.startsWith('mov'))).toEqual([])
    })
  })

  describe('remove_group_member', () => {
    it('has destructive + idempotent annotations', () => {
      expect(tool(buildMockCanvas(), 'remove_group_member').annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.groups.removeMember', async () => {
      const canvas = buildMockCanvas()
      const result = await tool(canvas, 'remove_group_member').handler({
        group_id: '1',
        user_id: '5',
      })
      expect(canvas.groups.removeMember).toHaveBeenCalledWith('1', '5')
      expect(result).toEqual({ ok: true })
    })
  })

  describe('Canvas error mapping on the new tools', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['list_group_categories', { course_id: '1' }, 'listCategories'],
      ['create_group_category', { course_id: '1', name: 'X' }, 'createCategory'],
      ['create_group', { group_category_id: '10', name: 'X' }, 'create'],
      ['delete_group', { group_id: '1' }, 'delete'],
      ['add_group_member', { group_id: '1', user_id: '5' }, 'addMember'],
      ['remove_group_member', { group_id: '1', user_id: '5' }, 'removeMember'],
    ]

    async function errorText(
      name: string,
      args: Record<string, unknown>,
      method: string,
      status: number,
    ): Promise<string> {
      const canvas = buildMockCanvas()
      const fn = (canvas.groups as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]!
      fn.mockRejectedValueOnce(new CanvasApiError('Canvas said no', status, '/api/v1/groups'))
      try {
        await tool(canvas, name).handler(args)
      } catch (error) {
        return formatError(error)
      }
      throw new Error('expected ' + name + ' to reject')
    }

    it.each(cases)('%s maps a 403 to the permission message', async (name, args, method) => {
      expect(await errorText(name, args, method, 403)).toBe(
        "You don't have permission to perform this action in this course",
      )
    })

    it.each(cases)('%s maps a 404 to the not-found message', async (name, args, method) => {
      expect(await errorText(name, args, method, 404)).toBe(
        'Course/assignment/submission not found — check the ID',
      )
    })
  })

  describe('pseudonymization', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'group-tool-'))
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

    it.each([
      ['create_group', { group_category_id: '10', name: 'Group A' }],
      ['delete_group', { group_id: '1' }],
    ] as const)(
      '%s omits embedded user identities when pseudonymization is enabled',
      async (name, params) => {
        const canvas = buildMockCanvas()
        const writeTool = groupTools(canvas, makePseudonymizer()).find((t) => t.name === name)!
        const result = await writeTool.handler(params)
        expect(result).toEqual(mockGroup)
        expect(result).not.toHaveProperty('leader')
        expect(result).not.toHaveProperty('users')
        expect(mockGroupWithUsers).toHaveProperty('leader.display_name', 'Real Name')
        expect(mockGroupWithUsers.users[0].name).toBe('Real Student')
      },
    )

    describe('list_group_members', () => {
      it('pseudonymizes member names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = groupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_group_members',
        )!
        const result = (await tool.handler({ group_id: '1' })) as CanvasUser[]
        expect(result[0].name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = groupTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_group_members',
        )!
        const result = (await tool.handler({ group_id: '1' })) as CanvasUser[]
        expect(result[0].name).toBe('Alice')
      })
    })

    describe('list_groups leader identity (#441)', () => {
      function listGroups(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
        return groupTools(canvas, pseudonymizer).find((t) => t.name === 'list_groups')!
      }

      function listing(groups: CanvasGroup[]): CanvasClient {
        const canvas = buildMockCanvas()
        ;(canvas.groups.list as ReturnType<typeof vi.fn>).mockResolvedValue(groups)
        return canvas
      }

      it('pseudonymizes the leader name and nulls the re-identifying siblings', async () => {
        const canvas = listing([groupJsonWithLeader()])
        const result = (await listGroups(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as CanvasGroup[]

        const leader = result[0].leader!
        expect(leader.display_name).toMatch(/^Student \d+$/)
        expect(leader.avatar_image_url).toBeNull()
        expect(leader.pronouns).toBeNull()
        // Identifiers are never rewritten in this layer.
        expect(leader.id).toBe(5)
        expect(leader.anonymous_id).toBe('aXy9Q')
        expect(leader.html_url).toBe(groupJsonWithLeader().leader!.html_url)
        // Everything that is not an identity field is untouched.
        expect(result[0].name).toBe('Project Team 3')
        expect(result[0].members_count).toBe(4)
      })

      it('leaves no real name anywhere in the payload', async () => {
        const canvas = listing([groupJsonWithUsers()])
        const result = await listGroups(canvas, makePseudonymizer()).handler({ course_id: '1' })
        const json = JSON.stringify(result)
        for (const name of GROUP_JSON_REAL_NAMES) expect(json).not.toContain(name)
      })

      it('CONTROL: every one of those names is present with pseudonymization off', async () => {
        const canvas = listing([groupJsonWithUsers()])
        const result = await listGroups(canvas, makePseudonymizer(false)).handler({
          course_id: '1',
        })
        const json = JSON.stringify(result)
        for (const name of GROUP_JSON_REAL_NAMES) expect(json).toContain(name)
      })

      it('passes the group through untouched when no pseudonymizer is wired at all', async () => {
        const canvas = listing([groupJsonWithLeader()])
        const result = await listGroups(canvas).handler({ course_id: '1' })
        expect(result).toEqual([groupJsonWithLeader()])
        expect(canvas.groups.list).toHaveBeenCalledWith('1')
      })

      it('gives the leader the same pseudonym list_group_members gives them', async () => {
        // The decisive argument for keying on `_group_<group.id>` rather than on
        // the course: `list_group_members` keys there, so one person gets one
        // label across the two tools of this domain.
        //
        // The members run FIRST and the leader is the SECOND of them. A
        // per-scope counter hands out `Student 1` in every fresh bucket, so a
        // leader who is alone in his own bucket would match a leader who joined
        // the group's bucket — comparing the two labels only means something
        // once the group's bucket already holds somebody else.
        const pseudonymizer = makePseudonymizer()
        const canvas = listing([groupJsonWithLeader()])
        ;(canvas.groups.listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
          { ...mockUser, id: 9, name: 'Other Member' },
          { ...mockUser, id: 5, name: REAL_GROUP_LEADER_NAME },
        ])

        const members = (await groupTools(canvas, pseudonymizer)
          .find((t) => t.name === 'list_group_members')!
          .handler({ group_id: '42' })) as CanvasUser[]
        const groups = (await listGroups(canvas, pseudonymizer).handler({
          course_id: '1',
        })) as CanvasGroup[]

        expect(groups[0].leader!.display_name).toBe(members[1]!.name)
        expect(groups[0].leader!.display_name).not.toBe(members[0]!.name)
      })

      it('withholds a leader name that arrives with no id to key a pseudonym on', async () => {
        const canvas = listing([
          groupJsonWithLeader({ leader: { display_name: REAL_GROUP_LEADER_NAME } }),
        ])
        const result = (await listGroups(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as CanvasGroup[]
        expect(result[0].leader!.display_name).toBe(WITHHELD_AUTHOR_NAME)
      })

      it('leaves a null leader alone', async () => {
        // Canvas renders `"leader": null` for a group that has no leader.
        const canvas = listing([groupJsonWithLeader({ leader: null })])
        const result = (await listGroups(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as CanvasGroup[]
        expect(result[0].leader).toBeNull()
      })

      it('GUARD: pseudonymizes an embedded users array if an include ever produces one', async () => {
        // Neither call site sends `include[]=users`, so Canvas cannot return
        // this today. The arm is here so adding the include later cannot
        // reintroduce the leak.
        const canvas = listing([groupJsonWithUsers()])
        const result = (await listGroups(canvas, makePseudonymizer()).handler({
          course_id: '1',
        })) as CanvasGroup[]
        expect(result[0].users![0].name).toMatch(/^Student \d+$/)
        expect(groupJsonWithUsers().users![0].name).toBe(REAL_GROUP_MEMBER_NAME)
      })
    })
  })
})
