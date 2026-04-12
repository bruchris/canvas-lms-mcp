// Canvas API types — built fresh, referencing Fjordbyte Canvas Integration as blueprint.
// Only fields each tool actually needs.

// --- Config ---

export interface CanvasClientConfig {
  token: string
  baseUrl: string
  maxPaginationPages?: number
}

// --- Error ---

export interface CanvasErrorResponse {
  errors?: Array<{ message: string }>
  message?: string
}

// --- Placeholder types for all domains ---
// These will be expanded as each canvas module is implemented.

export interface CanvasCourse {
  id: number
  name: string
  course_code: string
  workflow_state: string
  enrollment_term_id?: number
  total_students?: number
  syllabus_body?: string
  term?: CanvasTerm
  enrollments?: CanvasEnrollment[]
}

export interface CanvasTerm {
  id: number
  name: string
  start_at: string | null
  end_at: string | null
}

export interface CanvasEnrollment {
  id: number
  course_id: number
  user_id: number
  type: string
  role: string
  enrollment_state: string
}
