import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CanvasClient, type CanvasRubricCreateResult } from '../../src/canvas'
import { registerAllTools } from '../../src/tools'
import type { CanvasRubric, CanvasRubricAssessment, CanvasSubmission } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { rubricTools } from '../../src/tools/rubrics'

describe('rubricTools', () => {
  const mockRubric: CanvasRubric = {
    id: 1,
    title: 'Essay Rubric',
    points_possible: 100,
    data: [{ id: 'c1', description: 'Thesis', long_description: '', points: 25 }],
  }

  const mockSubmission: CanvasSubmission = {
    id: 201,
    assignment_id: 101,
    user_id: 5,
    submitted_at: null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: null,
    workflow_state: 'submitted',
  }

  const mockAssessment: CanvasRubricAssessment = {
    id: 1,
    rubric_id: 1,
    score: 25,
    data: [{ criterion_id: 'c1', points: 25, comments: 'Good thesis' }],
  }

  const mockAssociation = {
    id: 900,
    rubric_id: 1,
    association_id: 55,
    association_type: 'Assignment',
    use_for_grading: true,
    purpose: 'grading',
  }

  const mockCreateResult: CanvasRubricCreateResult = { rubric: mockRubric }

  function buildMockCanvas(): CanvasClient {
    return {
      rubrics: {
        list: vi.fn().mockResolvedValue([mockRubric]),
        get: vi.fn().mockResolvedValue(mockRubric),
        getAssessment: vi.fn().mockResolvedValue(mockSubmission),
        submitAssessment: vi.fn().mockResolvedValue(mockAssessment),
        create: vi.fn().mockResolvedValue(mockCreateResult),
        associate: vi.fn().mockResolvedValue(mockAssociation),
        delete: vi.fn().mockResolvedValue(mockRubric),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 7 tool definitions', () => {
    const tools = rubricTools(buildMockCanvas())
    expect(tools).toHaveLength(7)
  })

  it('exports tools with correct names', () => {
    const names = rubricTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_rubrics',
      'get_rubric',
      'get_rubric_assessment',
      'submit_rubric_assessment',
      'create_rubric',
      'attach_rubric',
      'delete_rubric',
    ])
  })

  describe('list_rubrics', () => {
    it('has read-only annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'list_rubrics')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.rubrics.list', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'list_rubrics')!
      const result = await tool.handler({ course_id: '1' })
      expect(canvas.rubrics.list).toHaveBeenCalledWith('1')
      expect(result).toEqual([mockRubric])
    })
  })

  describe('get_rubric', () => {
    it('has read-only annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'get_rubric')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.rubrics.get', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'get_rubric')!
      const result = await tool.handler({ course_id: '1', rubric_id: '10' })
      expect(canvas.rubrics.get).toHaveBeenCalledWith('1', '10')
      expect(result).toEqual(mockRubric)
    })

    it('passes requested rubric associations to canvas.rubrics.get', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'get_rubric')!
      await tool.handler({
        course_id: '1',
        rubric_id: '10',
        include: ['assignment_associations'],
      })
      expect(canvas.rubrics.get).toHaveBeenCalledWith('1', '10', {
        include: ['assignment_associations'],
      })
    })
  })

  describe('get_rubric_assessment', () => {
    it('has read-only annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'get_rubric_assessment')!
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
    })

    it('delegates to canvas.rubrics.getAssessment', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'get_rubric_assessment')!
      await tool.handler({ course_id: '1', assignment_id: '101', user_id: '5' })
      expect(canvas.rubrics.getAssessment).toHaveBeenCalledWith('1', '101', '5')
    })
  })

  describe('submit_rubric_assessment', () => {
    it('has destructive, idempotent, and openWorld annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find(
        (t) => t.name === 'submit_rubric_assessment',
      )!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.rubrics.submitAssessment', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'submit_rubric_assessment')!
      const data = [{ criterion_id: 'c1', points: 25, comments: 'Good' }]
      await tool.handler({ course_id: '1', association_id: '10', data })
      expect(canvas.rubrics.submitAssessment).toHaveBeenCalledWith('1', '10', data)
    })

    describe('pseudonymization (BRU-3123)', () => {
      const assessmentWithPeerFanOut: CanvasRubricAssessment = {
        id: 1,
        rubric_id: 1,
        score: 25,
        data: [{ criterion_id: 'c1', points: 25, comments: 'Good thesis' }],
        assessor_id: 7,
        assessor_name: 'Carol Peer',
        assessor_avatar_url: 'https://canvas.example/avatars/carol.png',
        artifact: {
          id: 10,
          assignment_id: 5,
          user_id: 1,
          submitted_at: null,
          score: 25,
          grade: '25',
          body: null,
          url: null,
          attempt: 1,
          workflow_state: 'graded',
        },
        related_group_submissions_and_assessments: [
          {
            submission: { id: 11, user_id: 2, assignment_id: 5 },
            rubric_assessments: [
              { id: 501, assessor_id: 8, assessor_name: 'Dave Peer', score: 25 },
            ],
          },
        ],
      }

      function buildCanvasWithPeerFanOut(): CanvasClient {
        return {
          rubrics: {
            submitAssessment: vi.fn().mockResolvedValue(assessmentWithPeerFanOut),
          },
        } as unknown as CanvasClient
      }

      let tmpDir: string
      beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'rubric-tool-'))
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

      it('masks the assessor and the group peer-review fan-out when enabled', async () => {
        const canvas = buildCanvasWithPeerFanOut()
        const tool = rubricTools(canvas, makePseudonymizer()).find(
          (t) => t.name === 'submit_rubric_assessment',
        )!
        const data = [{ criterion_id: 'c1', points: 25, comments: 'Good' }]
        const result = (await tool.handler({
          course_id: '1',
          association_id: '10',
          data,
        })) as CanvasRubricAssessment

        expect(result.assessor_name).toMatch(/^Student \d+$/)
        expect(result.assessor_name).not.toBe('Carol Peer')
        const relatedAssessorName =
          result.related_group_submissions_and_assessments?.[0]?.rubric_assessments?.[0]
            ?.assessor_name
        expect(relatedAssessorName).toMatch(/^Student \d+$/)
        expect(relatedAssessorName).not.toBe('Dave Peer')
      })

      it('passes real names through when disabled', async () => {
        const canvas = buildCanvasWithPeerFanOut()
        const tool = rubricTools(canvas, makePseudonymizer(false)).find(
          (t) => t.name === 'submit_rubric_assessment',
        )!
        const data = [{ criterion_id: 'c1', points: 25, comments: 'Good' }]
        const result = (await tool.handler({
          course_id: '1',
          association_id: '10',
          data,
        })) as CanvasRubricAssessment

        expect(result.assessor_name).toBe('Carol Peer')
        expect(
          result.related_group_submissions_and_assessments?.[0]?.rubric_assessments?.[0]
            ?.assessor_name,
        ).toBe('Dave Peer')
      })
    })
  })

  describe('create_rubric', () => {
    const validCriteria = [
      {
        description: 'Content Quality',
        points: 10,
        ratings: [
          { description: 'Excellent', points: 10 },
          { description: 'Poor', points: 0 },
        ],
      },
    ]

    it('has destructive and openWorld annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'create_rubric')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.rubrics.create without association', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'create_rubric')!
      const result = await tool.handler({
        course_id: '1',
        title: 'Essay Rubric',
        criteria: validCriteria,
      })
      expect(canvas.rubrics.create).toHaveBeenCalledWith(
        '1',
        { title: 'Essay Rubric', criteria: validCriteria },
        undefined,
      )
      expect(result).toEqual(mockCreateResult)
    })

    it('delegates to canvas.rubrics.create with association', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'create_rubric')!
      const association = { assignment_id: 55, use_for_grading: true, purpose: 'grading' }
      const linkedResult = { rubric: mockRubric, rubric_association: mockAssociation }
      vi.mocked(canvas.rubrics.create).mockResolvedValueOnce(linkedResult)
      const result = await tool.handler({
        course_id: '1',
        title: 'Essay Rubric',
        criteria: validCriteria,
        association,
      })
      expect(canvas.rubrics.create).toHaveBeenCalledWith(
        '1',
        { title: 'Essay Rubric', criteria: validCriteria },
        association,
      )
      expect(result).toEqual(linkedResult)
    })

    it('reports an HTTP 200 validation failure as an MCP tool error', async () => {
      const canvas = new CanvasClient({
        token: 'test-token',
        baseUrl: 'https://canvas.example.com',
      })
      const server = new McpServer({ name: 'test', version: '1.0.0' })
      const registerSpy = vi.spyOn(server, 'registerTool')
      registerAllTools(server, canvas)
      const call = registerSpy.mock.calls.find(([name]) => name === 'create_rubric')!
      const handler = call[2] as (params: Record<string, unknown>) => Promise<unknown>
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: true, messages: ['Association is invalid'] }), {
          status: 200,
        }),
      )
      try {
        const response = await handler({
          course_id: '1',
          title: 'Essay Rubric',
          criteria: validCriteria,
          association: { assignment_id: '55' },
        })
        expect(response).toEqual({
          content: [{ type: 'text', text: 'Invalid data sent to Canvas: Association is invalid' }],
          isError: true,
        })
      } finally {
        fetchSpy.mockRestore()
        registerSpy.mockRestore()
        await server.close()
      }
    })
  })

  describe('attach_rubric', () => {
    it('has destructive and openWorld annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'attach_rubric')!
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    })

    it('delegates to canvas.rubrics.associate and returns the association', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'attach_rubric')!
      const result = await tool.handler({
        course_id: 1,
        rubric_id: 1,
        assignment_id: 55,
        use_for_grading: true,
      })
      expect(canvas.rubrics.associate).toHaveBeenCalledWith(1, 1, 55, {
        use_for_grading: true,
        hide_score_total: undefined,
        purpose: undefined,
      })
      expect(result).toEqual(mockAssociation)
    })

    it('passes hide_score_total and purpose through', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'attach_rubric')!
      await tool.handler({
        course_id: 1,
        rubric_id: 1,
        assignment_id: 55,
        hide_score_total: true,
        purpose: 'bookmark',
      })
      expect(canvas.rubrics.associate).toHaveBeenCalledWith(1, 1, 55, {
        use_for_grading: undefined,
        hide_score_total: true,
        purpose: 'bookmark',
      })
    })
  })

  describe('delete_rubric', () => {
    it('has destructive, idempotent and openWorld annotations', () => {
      const tool = rubricTools(buildMockCanvas()).find((t) => t.name === 'delete_rubric')!
      expect(tool.annotations).toEqual({
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('delegates to canvas.rubrics.delete and returns the deleted rubric', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'delete_rubric')!
      const result = await tool.handler({ course_id: 1, rubric_id: 1 })
      expect(canvas.rubrics.delete).toHaveBeenCalledWith(1, 1)
      expect(result).toEqual(mockRubric)
    })
  })
})
