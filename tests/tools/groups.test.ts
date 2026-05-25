import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasGroup, CanvasUser } from '../../src/canvas/types'
import { groupTools } from '../../src/tools/groups'

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

  function buildMockCanvas(): CanvasClient {
    return {
      groups: {
        list: vi.fn().mockResolvedValue([mockGroup]),
        listMembers: vi.fn().mockResolvedValue([mockUser]),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 2 tool definitions', () => {
    expect(groupTools(buildMockCanvas())).toHaveLength(2)
  })

  it('exports tools with correct names', () => {
    const names = groupTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual(['list_groups', 'list_group_members'])
  })

  describe('list_groups', () => {
    it('has read-only annotations', () => {
      const tool = groupTools(buildMockCanvas()).find((t) => t.name === 'list_groups')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.groups.list', async () => {
      const canvas = buildMockCanvas()
      const tool = groupTools(canvas).find((t) => t.name === 'list_groups')!
      await tool.handler({ course_id: 1 })
      expect(canvas.groups.list).toHaveBeenCalledWith(1)
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
      await tool.handler({ group_id: 1 })
      expect(canvas.groups.listMembers).toHaveBeenCalledWith(1)
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

    describe('list_group_members', () => {
      it('pseudonymizes member names when enabled', async () => {
        const canvas = buildMockCanvas()
        const tool = groupTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'list_group_members',
        )!
        const result = (await tool.handler({ group_id: 1 })) as CanvasUser[]
        expect(result[0].name).toMatch(/^Student \d+$/)
      })

      it('passes through real names when disabled', async () => {
        const canvas = buildMockCanvas()
        const tool = groupTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'list_group_members',
        )!
        const result = (await tool.handler({ group_id: 1 })) as CanvasUser[]
        expect(result[0].name).toBe('Alice')
      })
    })
  })
})
