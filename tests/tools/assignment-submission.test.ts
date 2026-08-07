import { describe, it, expect, vi } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { CanvasApiError } from '../../src/canvas/client'
import { getAllTools } from '../../src/tools'
import { assignmentSubmissionTools } from '../../src/tools/assignment-submission'

function buildMockCanvas(overrides: Partial<CanvasClient> = {}): CanvasClient {
  return {
    submissions: {
      list: vi.fn(),
      get: vi.fn(),
      grade: vi.fn(),
      comment: vi.fn(),
      listMy: vi.fn(),
      listForStudents: vi.fn(),
      submit: vi.fn().mockResolvedValue({
        id: 500,
        assignment_id: 20,
        user_id: 1,
        submitted_at: '2026-07-30T10:00:00Z',
        score: null,
        grade: null,
        body: null,
        url: null,
        attempt: 1,
        workflow_state: 'submitted',
      }),
    },
    files: {
      list: vi.fn(),
      listFolders: vi.fn(),
      get: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      download: vi.fn(),
      uploadToSubmission: vi.fn().mockResolvedValue({
        id: 99,
        display_name: 'essay.pdf',
        filename: 'essay.pdf',
        content_type: 'application/pdf',
        url: 'https://canvas.example.com/files/99/download',
        size: 1024,
        folder_id: 0,
      }),
    },
    ...overrides,
  } as unknown as CanvasClient
}

// Deep proxy — getAllTools only constructs definitions, never calls handlers
function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

describe('assignmentSubmissionTools', () => {
  // Test 8: returns exactly the two tools with correct annotations
  it('returns exactly [upload_submission_file, submit_assignment] with destructive + openWorld hints', () => {
    const tools = assignmentSubmissionTools(buildMockCanvas())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['upload_submission_file', 'submit_assignment'])
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    }
  })

  // Test 9: gate — off by default, on when features.assignmentSubmission = true
  describe('gate behaviour in getAllTools', () => {
    it('excludes both tools when features is not passed (default off)', () => {
      const names = getAllTools(mockCanvas()).map((t) => t.name)
      expect(names).not.toContain('submit_assignment')
      expect(names).not.toContain('upload_submission_file')
    })

    it('includes both tools with student audience when assignmentSubmission: true', () => {
      const tools = getAllTools(mockCanvas(), undefined, undefined, { assignmentSubmission: true })
      const subTools = tools.filter(
        (t) => t.name === 'submit_assignment' || t.name === 'upload_submission_file',
      )
      expect(subTools).toHaveLength(2)
      for (const t of subTools) {
        expect(t.audience).toBe('student')
      }
    })
  })

  // Test 10: role interplay
  describe('role interplay with gate', () => {
    it('gate on + role teacher → excluded (student-audience tools hidden from teacher)', () => {
      const names = getAllTools(mockCanvas(), undefined, 'teacher', {
        assignmentSubmission: true,
      }).map((t) => t.name)
      expect(names).not.toContain('submit_assignment')
      expect(names).not.toContain('upload_submission_file')
    })

    it('gate on + role student → included', () => {
      const names = getAllTools(mockCanvas(), undefined, 'student', {
        assignmentSubmission: true,
      }).map((t) => t.name)
      expect(names).toContain('submit_assignment')
      expect(names).toContain('upload_submission_file')
    })

    it('gate off + role student → excluded', () => {
      const names = getAllTools(mockCanvas(), undefined, 'student').map((t) => t.name)
      expect(names).not.toContain('submit_assignment')
      expect(names).not.toContain('upload_submission_file')
    })
  })

  // Test 11: handler validation — mismatch cases
  describe('submit_assignment handler validation', () => {
    function getSubmitTool(canvas: CanvasClient) {
      return assignmentSubmissionTools(canvas).find((t) => t.name === 'submit_assignment')!
    }

    it('online_text_entry missing body rejects without calling canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await expect(
        tool.handler({ course_id: 1, assignment_id: 20, submission_type: 'online_text_entry' }),
      ).rejects.toThrow("submission_type 'online_text_entry' requires 'body'")
      expect(canvas.submissions.submit).not.toHaveBeenCalled()
    })

    it('online_url missing url rejects without calling canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await expect(
        tool.handler({ course_id: 1, assignment_id: 20, submission_type: 'online_url' }),
      ).rejects.toThrow("submission_type 'online_url' requires 'url'")
      expect(canvas.submissions.submit).not.toHaveBeenCalled()
    })

    it('online_url non-http(s) url rejects without calling canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await expect(
        tool.handler({
          course_id: 1,
          assignment_id: 20,
          submission_type: 'online_url',
          url: 'ftp://example.com/file',
        }),
      ).rejects.toThrow("submission_type 'online_url' requires 'url'")
      expect(canvas.submissions.submit).not.toHaveBeenCalled()
    })

    it('online_upload empty file_ids rejects without calling canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await expect(
        tool.handler({
          course_id: 1,
          assignment_id: 20,
          submission_type: 'online_upload',
          file_ids: [],
        }),
      ).rejects.toThrow("submission_type 'online_upload' requires non-empty 'file_ids'")
      expect(canvas.submissions.submit).not.toHaveBeenCalled()
    })

    it('online_text_entry with extra url rejects without calling canvas', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await expect(
        tool.handler({
          course_id: 1,
          assignment_id: 20,
          submission_type: 'online_text_entry',
          body: 'my essay',
          url: 'https://example.com',
        }),
      ).rejects.toThrow("submission_type 'online_text_entry' requires 'body'")
      expect(canvas.submissions.submit).not.toHaveBeenCalled()
    })
  })

  // Test 12: happy paths
  describe('submit_assignment happy paths', () => {
    function getSubmitTool(canvas: CanvasClient) {
      return assignmentSubmissionTools(canvas).find((t) => t.name === 'submit_assignment')!
    }

    it('online_text_entry calls submit with correct params', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await tool.handler({
        course_id: 1,
        assignment_id: 20,
        submission_type: 'online_text_entry',
        body: 'my essay text',
      })
      expect(canvas.submissions.submit).toHaveBeenCalledWith(1, 20, {
        submission_type: 'online_text_entry',
        body: 'my essay text',
        url: undefined,
        file_ids: undefined,
        comment: undefined,
      })
    })

    it('online_url calls submit with correct params and comment passes through', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await tool.handler({
        course_id: 1,
        assignment_id: 20,
        submission_type: 'online_url',
        url: 'https://my-project.example.com',
        comment: 'Here is my project',
      })
      expect(canvas.submissions.submit).toHaveBeenCalledWith(1, 20, {
        submission_type: 'online_url',
        body: undefined,
        url: 'https://my-project.example.com',
        file_ids: undefined,
        comment: 'Here is my project',
      })
    })

    it('online_upload calls submit with file_ids array', async () => {
      const canvas = buildMockCanvas()
      const tool = getSubmitTool(canvas)
      await tool.handler({
        course_id: 1,
        assignment_id: 20,
        submission_type: 'online_upload',
        file_ids: [99, 100],
      })
      expect(canvas.submissions.submit).toHaveBeenCalledWith(1, 20, {
        submission_type: 'online_upload',
        body: undefined,
        url: undefined,
        file_ids: [99, 100],
        comment: undefined,
      })
    })
  })

  describe('upload_submission_file happy path', () => {
    it('calls uploadToSubmission and returns its result', async () => {
      const canvas = buildMockCanvas()
      const tool = assignmentSubmissionTools(canvas).find(
        (t) => t.name === 'upload_submission_file',
      )!
      const result = await tool.handler({
        course_id: 1,
        assignment_id: 20,
        name: 'essay.pdf',
        content_base64: btoa('pdf content'),
        content_type: 'application/pdf',
      })
      expect(canvas.files.uploadToSubmission).toHaveBeenCalledWith(
        1,
        20,
        'essay.pdf',
        btoa('pdf content'),
        'application/pdf',
      )
      expect(result).toMatchObject({ id: 99, display_name: 'essay.pdf' })
    })
  })

  // Test 13: CanvasApiError propagation
  describe('CanvasApiError propagation', () => {
    it('submit_assignment propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.submissions.submit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new CanvasApiError(403, '/api/v1/courses/1/assignments/20/submissions', 'Forbidden'),
      )
      const tool = assignmentSubmissionTools(canvas).find((t) => t.name === 'submit_assignment')!
      await expect(
        tool.handler({
          course_id: 1,
          assignment_id: 20,
          submission_type: 'online_text_entry',
          body: 'test body',
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })

    it('upload_submission_file propagates CanvasApiError', async () => {
      const canvas = buildMockCanvas()
      ;(canvas.files.uploadToSubmission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new CanvasApiError(
          403,
          '/api/v1/courses/1/assignments/20/submissions/self/files',
          'Forbidden',
        ),
      )
      const tool = assignmentSubmissionTools(canvas).find(
        (t) => t.name === 'upload_submission_file',
      )!
      await expect(
        tool.handler({
          course_id: 1,
          assignment_id: 20,
          name: 'essay.pdf',
          content_base64: btoa('pdf content'),
          content_type: 'application/pdf',
        }),
      ).rejects.toBeInstanceOf(CanvasApiError)
    })
  })
})
