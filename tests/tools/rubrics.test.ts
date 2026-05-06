import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasRubric, CanvasRubricAssessment, CanvasSubmission } from '../../src/canvas/types'
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

  function buildMockCanvas(): CanvasClient {
    return {
      rubrics: {
        list: vi.fn().mockResolvedValue([mockRubric]),
        get: vi.fn().mockResolvedValue(mockRubric),
        getAssessment: vi.fn().mockResolvedValue(mockSubmission),
        submitAssessment: vi.fn().mockResolvedValue(mockAssessment),
        create: vi.fn().mockResolvedValue(mockRubric),
      },
    } as unknown as CanvasClient
  }

  it('returns an array with 5 tool definitions', () => {
    const tools = rubricTools(buildMockCanvas())
    expect(tools).toHaveLength(5)
  })

  it('exports tools with correct names', () => {
    const names = rubricTools(buildMockCanvas()).map((t) => t.name)
    expect(names).toEqual([
      'list_rubrics',
      'get_rubric',
      'get_rubric_assessment',
      'submit_rubric_assessment',
      'create_rubric',
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
      const result = await tool.handler({ course_id: 1 })
      expect(canvas.rubrics.list).toHaveBeenCalledWith(1)
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
      const result = await tool.handler({ course_id: 1, rubric_id: 10 })
      expect(canvas.rubrics.get).toHaveBeenCalledWith(1, 10)
      expect(result).toEqual(mockRubric)
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
      await tool.handler({ course_id: 1, assignment_id: 101, user_id: 5 })
      expect(canvas.rubrics.getAssessment).toHaveBeenCalledWith(1, 101, 5)
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
      await tool.handler({ course_id: 1, association_id: 10, data })
      expect(canvas.rubrics.submitAssessment).toHaveBeenCalledWith(1, 10, data)
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
        course_id: 1,
        title: 'Essay Rubric',
        criteria: validCriteria,
      })
      expect(canvas.rubrics.create).toHaveBeenCalledWith(
        1,
        { title: 'Essay Rubric', criteria: validCriteria },
        undefined,
      )
      expect(result).toEqual(mockRubric)
    })

    it('delegates to canvas.rubrics.create with association', async () => {
      const canvas = buildMockCanvas()
      const tool = rubricTools(canvas).find((t) => t.name === 'create_rubric')!
      const association = { assignment_id: 55, use_for_grading: true, purpose: 'grading' }
      await tool.handler({
        course_id: 1,
        title: 'Essay Rubric',
        criteria: validCriteria,
        association,
      })
      expect(canvas.rubrics.create).toHaveBeenCalledWith(
        1,
        { title: 'Essay Rubric', criteria: validCriteria },
        association,
      )
    })
  })
})
