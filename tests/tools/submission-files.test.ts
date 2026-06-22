import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanvasClient } from '../../src/canvas'
import type { CanvasAttachment, CanvasSubmission } from '../../src/canvas/types'
import { Pseudonymizer } from '../../src/pseudonym/pseudonymizer'
import { submissionFileTools } from '../../src/tools/submission-files'

// All Canvas responses are mocked — no real Canvas instance is hit.

function att(
  overrides: Partial<CanvasAttachment> & Pick<CanvasAttachment, 'id' | 'display_name'>,
): CanvasAttachment {
  return {
    filename: overrides.display_name,
    url: `https://canvas.example.com/files/${overrides.id}/download`,
    content_type: 'application/octet-stream',
    size: 1024,
    ...overrides,
  }
}

function sub(overrides: Partial<CanvasSubmission>): CanvasSubmission {
  return {
    id: 1,
    assignment_id: 0,
    user_id: 0,
    submitted_at: null,
    score: null,
    grade: null,
    body: null,
    url: null,
    attempt: 1,
    workflow_state: 'submitted',
    ...overrides,
  }
}

function buildMockCanvas(submissions: CanvasSubmission[]): {
  canvas: CanvasClient
  listForStudents: ReturnType<typeof vi.fn>
} {
  const listForStudents = vi.fn().mockResolvedValue(submissions)
  const canvas = {
    submissions: { listForStudents },
  } as unknown as CanvasClient
  return { canvas, listForStudents }
}

function getTool(canvas: CanvasClient, pseudonymizer?: Pseudonymizer) {
  return submissionFileTools(canvas, pseudonymizer).find(
    (t) => t.name === 'list_course_submission_files',
  )!
}

type Manifest = {
  course_id: number
  total_files: number
  total_submissions_scanned: number
  truncated: boolean
  truncation_note: string | null
  url_expiry_note: string
  files: Array<{
    assignment_id: number
    assignment_name: string | null
    user_id: number
    user_name: string | null
    original_filename: string
    file_id: number
    download_url: string
    content_type: string
    size: number
    submitted_at: string | null
    _warning?: string
  }>
}

// Fixture A — basic two-assignment, two-student course
const FIXTURE_A: CanvasSubmission[] = [
  sub({
    id: 1,
    assignment_id: 10,
    assignment: {
      id: 10,
      name: 'Essay',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_upload'],
      course_id: 1,
      allowed_attempts: -1,
    },
    user_id: 100,
    user: { id: 100, name: 'Alice' },
    submitted_at: '2026-01-10T12:00:00Z',
    attachments: [
      att({
        id: 501,
        display_name: 'essay.docx',
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 24576,
      }),
    ],
  }),
  sub({
    id: 2,
    assignment_id: 10,
    assignment: {
      id: 10,
      name: 'Essay',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_upload'],
      course_id: 1,
      allowed_attempts: -1,
    },
    user_id: 101,
    user: { id: 101, name: 'Bob' },
    submitted_at: '2026-01-11T09:30:00Z',
    attachments: [
      att({
        id: 502,
        display_name: 'essay_final.pdf',
        content_type: 'application/pdf',
        size: 98304,
      }),
    ],
  }),
  sub({
    id: 3,
    assignment_id: 20,
    assignment: {
      id: 20,
      name: 'Project',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_upload'],
      course_id: 1,
      allowed_attempts: -1,
    },
    user_id: 100,
    user: { id: 100, name: 'Alice' },
    submitted_at: '2026-02-01T15:00:00Z',
    attachments: [
      att({ id: 503, display_name: 'project.zip', content_type: 'application/zip', size: 204800 }),
    ],
  }),
  sub({
    id: 4,
    assignment_id: 20,
    assignment: {
      id: 20,
      name: 'Project',
      description: null,
      due_at: null,
      points_possible: 100,
      grading_type: 'points',
      submission_types: ['online_upload'],
      course_id: 1,
      allowed_attempts: -1,
    },
    user_id: 101,
    user: { id: 101, name: 'Bob' },
    submitted_at: '2026-02-02T10:00:00Z',
    attachments: [],
  }),
]

describe('submissionFileTools', () => {
  it('returns a single tool definition', () => {
    const { canvas } = buildMockCanvas([])
    expect(submissionFileTools(canvas)).toHaveLength(1)
  })

  it('exports list_course_submission_files', () => {
    const { canvas } = buildMockCanvas([])
    expect(submissionFileTools(canvas).map((t) => t.name)).toEqual(['list_course_submission_files'])
  })

  it('declares read-only annotations', () => {
    const { canvas } = buildMockCanvas([])
    expect(getTool(canvas).annotations).toEqual({ readOnlyHint: true, openWorldHint: true })
  })

  it('exposes course_id in the input schema', () => {
    const { canvas } = buildMockCanvas([])
    expect(getTool(canvas).inputSchema).toHaveProperty('course_id')
  })

  // Fixture A — basic walk, attachments_only default (true)
  describe('basic two-assignment walk (Fixture A)', () => {
    it('emits one entry per attachment and skips attachment-less submissions', async () => {
      const { canvas } = buildMockCanvas(FIXTURE_A)
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      expect(result.total_files).toBe(3)
      expect(result.total_submissions_scanned).toBe(4)
      expect(result.truncated).toBe(false)
      expect(result.truncation_note).toBeNull()
      expect(result.files[0].original_filename).toBe('essay.docx')
      expect(result.files[0].file_id).toBe(501)
      expect(result.files[0].assignment_name).toBe('Essay')
      expect(result.files[0].download_url).toBe('https://canvas.example.com/files/501/download')
      expect(result.files[0].size).toBe(24576)
      expect(result.url_expiry_note).toContain('file_id')
      expect(result.course_id).toBe(1)
    })
  })

  // Fixture B — attachments_only: false
  describe('attachments_only false (Fixture B)', () => {
    it('still emits only attachment-based entries and counts every submission', async () => {
      const { canvas } = buildMockCanvas(FIXTURE_A)
      const result = (await getTool(canvas).handler({
        course_id: 1,
        attachments_only: false,
      })) as Manifest
      expect(result.total_files).toBe(3)
      expect(result.total_submissions_scanned).toBe(4)
    })
  })

  // Fixture C — truncation at max_files
  describe('truncation at max_files (Fixture C)', () => {
    it('stops at max_files, flags truncated, and explains how to retrieve the rest', async () => {
      const submissions = Array.from({ length: 6 }, (_, i) =>
        sub({
          id: i + 1,
          assignment_id: 10,
          user_id: 100 + i,
          user: { id: 100 + i, name: `Student${i}` },
          attachments: [att({ id: 600 + i, display_name: `file${i}.pdf` })],
        }),
      )
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1, max_files: 3 })) as Manifest
      expect(result.total_files).toBe(3)
      expect(result.truncated).toBe(true)
      // Pin the interpolated max_files in the note, plus the recovery guidance.
      expect(result.truncation_note).toContain('truncated at 3 files')
      expect(result.truncation_note).toMatch(/assignment_ids or student_ids/)
      expect(result.total_submissions_scanned).toBe(4)
    })

    it('cuts mid-submission when max_files falls between a submission’s attachments', async () => {
      // Two submissions, three attachments each; cap at 4 → 3 from sub 1 plus the
      // FIRST attachment of sub 2. Pins the inner-loop (mid-submission) cut point
      // so a refactor to a submission-boundary check (which would overshoot to 6)
      // is caught.
      const submissions = [
        sub({
          id: 1,
          assignment_id: 10,
          user_id: 100,
          user: { id: 100, name: 'Alice' },
          attachments: [
            att({ id: 1, display_name: 'a1.pdf' }),
            att({ id: 2, display_name: 'a2.pdf' }),
            att({ id: 3, display_name: 'a3.pdf' }),
          ],
        }),
        sub({
          id: 2,
          assignment_id: 10,
          user_id: 101,
          user: { id: 101, name: 'Bob' },
          attachments: [
            att({ id: 4, display_name: 'b1.pdf' }),
            att({ id: 5, display_name: 'b2.pdf' }),
            att({ id: 6, display_name: 'b3.pdf' }),
          ],
        }),
      ]
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1, max_files: 4 })) as Manifest
      expect(result.total_files).toBe(4)
      expect(result.truncated).toBe(true)
      expect(result.files.map((f) => f.file_id)).toEqual([1, 2, 3, 4])
      // files[3] is the first attachment of the second submission — the cut is mid-submission.
      expect(result.files[3].file_id).toBe(4)
    })

    it('does not flag truncation when files exactly fill max_files', async () => {
      const submissions = Array.from({ length: 3 }, (_, i) =>
        sub({
          id: i + 1,
          assignment_id: 10,
          user_id: 100 + i,
          user: { id: 100 + i, name: `S${i}` },
          attachments: [att({ id: 700 + i, display_name: `f${i}.pdf` })],
        }),
      )
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1, max_files: 3 })) as Manifest
      expect(result.total_files).toBe(3)
      expect(result.truncated).toBe(false)
      expect(result.truncation_note).toBeNull()
    })
  })

  // Attachment whose signed URL is not yet ready (e.g. still processing)
  describe('missing attachment url', () => {
    it('flags a warning instead of emitting a silently-broken download entry', async () => {
      const submissions = [
        sub({
          id: 1,
          assignment_id: 10,
          user_id: 100,
          user: { id: 100, name: 'Alice' },
          attachments: [att({ id: 800, display_name: 'processing.pdf', url: '' })],
        }),
      ]
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      expect(result.total_files).toBe(1)
      expect(result.files[0]._warning).toContain('attachment url unavailable')
      // file_id is still present so the caller can re-fetch once the file is ready.
      expect(result.files[0].file_id).toBe(800)
    })

    it('combines the user and attachment warnings when both apply', async () => {
      const submissions = [
        sub({
          id: 1,
          assignment_id: 10,
          user_id: 200,
          user: undefined,
          attachments: [att({ id: 801, display_name: 'processing.pdf', url: '' })],
        }),
      ]
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      // Both clauses present, user-warning first, joined by '; '.
      expect(result.files[0]._warning).toMatch(/user data unavailable; attachment url unavailable/)
    })
  })

  // Fixture D — FERPA pseudonymization
  describe('pseudonymization (Fixture D)', () => {
    let tmpDir: string
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'submission-files-'))
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

    it('replaces user_name with a stable per-student pseudonym while keeping the raw user_id', async () => {
      const { canvas } = buildMockCanvas(FIXTURE_A)
      const result = (await getTool(canvas, makePseudonymizer()).handler({
        course_id: 1,
      })) as Manifest
      // Names are pseudonymized...
      expect(result.files[0].user_name).toMatch(/^Student \d+$/)
      expect(result.files[1].user_name).toMatch(/^Student \d+$/)
      // ...distinct students get distinct pseudonyms...
      expect(result.files[0].user_name).not.toBe(result.files[1].user_name)
      // ...the same student is stable across submissions (Alice appears twice)...
      expect(result.files[2].user_name).toBe(result.files[0].user_name)
      // ...and the numeric user_id is never altered (stable folder key).
      expect(result.files[0].user_id).toBe(100)
      expect(result.files[1].user_id).toBe(101)
      expect(result.files[2].user_id).toBe(100)
    })

    it('passes through real names when pseudonymization is disabled', async () => {
      const { canvas } = buildMockCanvas(FIXTURE_A)
      const result = (await getTool(canvas, makePseudonymizer(false)).handler({
        course_id: 1,
      })) as Manifest
      expect(result.files[0].user_name).toBe('Alice')
      expect(result.files[1].user_name).toBe('Bob')
    })
  })

  // Fixture E — missing user on submission
  describe('missing user data (Fixture E)', () => {
    it('falls back to user_id and flags a warning', async () => {
      const submissions = [
        sub({
          id: 1,
          assignment_id: 30,
          user_id: 200,
          user: undefined,
          attachments: [att({ id: 601, display_name: 'hw.pdf' })],
        }),
      ]
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      expect(result.files[0].user_id).toBe(200)
      expect(result.files[0].user_name).toBeNull()
      expect(result.files[0]._warning).toBe('user data unavailable')
    })
  })

  // Fixture F — filters passed through to the Canvas API layer
  describe('filter pass-through (Fixture F)', () => {
    it('forwards assignment_ids', async () => {
      const { canvas, listForStudents } = buildMockCanvas([])
      await getTool(canvas).handler({ course_id: 1, assignment_ids: [10, 20] })
      expect(listForStudents).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ assignment_ids: [10, 20] }),
      )
    })

    it('forwards student_ids verbatim (not "all")', async () => {
      const { canvas, listForStudents } = buildMockCanvas([])
      await getTool(canvas).handler({ course_id: 1, student_ids: [100] })
      expect(listForStudents).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ student_ids: [100] }),
      )
    })

    it('defaults student_ids to ["all"] when none are provided', async () => {
      const { canvas, listForStudents } = buildMockCanvas([])
      await getTool(canvas).handler({ course_id: 1 })
      expect(listForStudents).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ student_ids: ['all'] }),
      )
    })

    it('always requests the user and assignment includes', async () => {
      const { canvas, listForStudents } = buildMockCanvas([])
      await getTool(canvas).handler({ course_id: 1 })
      expect(listForStudents).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ include: ['user', 'assignment'] }),
      )
    })

    it('forwards workflow_state when provided', async () => {
      const { canvas, listForStudents } = buildMockCanvas([])
      await getTool(canvas).handler({ course_id: 1, workflow_state: 'graded' })
      expect(listForStudents).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ workflow_state: 'graded' }),
      )
    })
  })

  // Fixture G — empty course
  describe('empty course (Fixture G)', () => {
    it('returns an empty manifest with the expiry note still present', async () => {
      const { canvas } = buildMockCanvas([])
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      expect(result.total_files).toBe(0)
      expect(result.files).toEqual([])
      expect(result.truncated).toBe(false)
      expect(result.url_expiry_note).toBeTruthy()
    })
  })

  // Fixture H — multiple attachments per submission
  describe('multiple attachments per submission (Fixture H)', () => {
    it('emits one entry per attachment sharing the submission metadata', async () => {
      const submissions = [
        sub({
          id: 1,
          assignment_id: 40,
          assignment: {
            id: 40,
            name: 'Portfolio',
            description: null,
            due_at: null,
            points_possible: 100,
            grading_type: 'points',
            submission_types: ['online_upload'],
            course_id: 1,
            allowed_attempts: -1,
          },
          user_id: 300,
          user: { id: 300, name: 'Carol' },
          attachments: [
            att({ id: 701, display_name: 'a.pdf' }),
            att({ id: 702, display_name: 'b.pdf' }),
            att({ id: 703, display_name: 'c.pdf' }),
          ],
        }),
      ]
      const { canvas } = buildMockCanvas(submissions)
      const result = (await getTool(canvas).handler({ course_id: 1 })) as Manifest
      expect(result.total_files).toBe(3)
      expect(result.files.map((f) => f.user_id)).toEqual([300, 300, 300])
      expect(result.files.map((f) => f.assignment_id)).toEqual([40, 40, 40])
      expect(result.files.map((f) => f.original_filename)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    })
  })
})
