import { z } from 'zod'
import type { Pseudonymizer } from '../pseudonym/pseudonymizer'
import type { ToolDefinition } from './types'

/**
 * Tools that depend on the pseudonymizer. Currently the single conditional
 * `resolve_pseudonym` reverse-lookup tool.
 *
 * Registration is conditional on env vars:
 *  - `CANVAS_PSEUDONYMIZE_STUDENTS=true` AND
 *  - `CANVAS_PSEUDONYMIZE_REVERSE_LOOKUP=true`
 *
 * When either is unset, the tool is NOT registered — it is absent from
 * `tools/list` entirely. That is stronger than "registered but errors out":
 * the MCP protocol layer refuses the call before it reaches us.
 */
export function pseudonymTools(pseudonymizer: Pseudonymizer): ToolDefinition[] {
  if (!pseudonymizer.isReverseLookupEnabled()) return []

  return [
    {
      name: 'resolve_pseudonym',
      audience: 'educator',
      description:
        'Resolve a stable pseudonym (e.g. "Student 7") back to a Canvas user_id within a course. Use only when a teacher has explicitly asked to identify a specific student in an artifact. Every call is audit-logged.',
      inputSchema: {
        course_id: z.number().describe('The Canvas course ID the pseudonym was assigned in'),
        pseudonym: z.string().describe('The pseudonym to resolve, e.g. "Student 7"'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (params) => {
        const courseId = params.course_id as number
        const pseudonym = params.pseudonym as string
        const result = await pseudonymizer.reverseLookup(courseId, pseudonym)
        if (!result) {
          return {
            found: false,
            note: 'No pseudonym matched in the course map. Check the course_id and the exact pseudonym spelling.',
          }
        }
        return {
          found: true,
          user_id: result.user_id,
          pseudonym: result.pseudonym,
          status: result.status,
          note: 'Reverse lookup is audit-logged. Use the returned user_id only for the explicit identification the teacher asked for.',
        }
      },
    },
  ]
}
