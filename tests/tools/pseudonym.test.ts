import { describe, it, expect, vi } from 'vitest'
import type { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { pseudonymTools } from '../../src/tools/pseudonym'

function buildMockPseudonymizer(overrides: Partial<Record<string, unknown>> = {}): Pseudonymizer {
  return {
    isReverseLookupEnabled: vi.fn().mockReturnValue(false),
    reverseLookup: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Pseudonymizer
}

describe('pseudonymTools', () => {
  describe('conditional registration', () => {
    it('returns [] when reverse lookup is disabled', () => {
      const pseudonymizer = buildMockPseudonymizer({
        isReverseLookupEnabled: vi.fn().mockReturnValue(false),
      })
      const tools = pseudonymTools(pseudonymizer)
      expect(tools).toHaveLength(0)
    })

    it('returns one tool when reverse lookup is enabled', () => {
      const pseudonymizer = buildMockPseudonymizer({
        isReverseLookupEnabled: vi.fn().mockReturnValue(true),
      })
      const tools = pseudonymTools(pseudonymizer)
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('resolve_pseudonym')
    })
  })

  describe('resolve_pseudonym handler', () => {
    function getHandler() {
      const pseudonymizer = buildMockPseudonymizer({
        isReverseLookupEnabled: vi.fn().mockReturnValue(true),
      })
      const tool = pseudonymTools(pseudonymizer)[0]
      return { tool, pseudonymizer }
    }

    it('returns found=true with user_id, pseudonym, status, and audit note on match', async () => {
      const { tool, pseudonymizer } = getHandler()
      ;(pseudonymizer.reverseLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
        user_id: 42,
        pseudonym: 'Student 7',
        status: 'active',
      })
      const result = await tool.handler({ course_id: 1, pseudonym: 'Student 7' })
      expect(result).toEqual({
        found: true,
        user_id: 42,
        pseudonym: 'Student 7',
        status: 'active',
        note: 'Reverse lookup is audit-logged. Use the returned user_id only for the explicit identification the teacher asked for.',
      })
    })

    it('returns found=false with check-spelling note when no match', async () => {
      const { tool, pseudonymizer } = getHandler()
      ;(pseudonymizer.reverseLookup as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const result = await tool.handler({ course_id: 1, pseudonym: 'Student 99' })
      expect(result).toEqual({
        found: false,
        note: 'No pseudonym matched in the course map. Check the course_id and the exact pseudonym spelling.',
      })
    })

    it('calls reverseLookup with the correct course_id and pseudonym', async () => {
      const { tool, pseudonymizer } = getHandler()
      ;(pseudonymizer.reverseLookup as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      await tool.handler({ course_id: 99, pseudonym: 'Student 3' })
      expect(pseudonymizer.reverseLookup).toHaveBeenCalledWith(99, 'Student 3')
    })
  })

  describe('annotations', () => {
    it('has readOnlyHint: true and openWorldHint: true', () => {
      const pseudonymizer = buildMockPseudonymizer({
        isReverseLookupEnabled: vi.fn().mockReturnValue(true),
      })
      const tool = pseudonymTools(pseudonymizer)[0]
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })
  })
})
