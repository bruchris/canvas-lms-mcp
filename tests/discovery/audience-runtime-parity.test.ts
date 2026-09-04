import { describe, expect, it } from 'vitest'
import type { CanvasClient } from '../../src/canvas'
import { buildToolManifest } from '../../src/discovery/manifests'
import { getAllTools } from '../../src/tools'
import type { CanvasRole, ToolAudience, ToolFeatureFlags } from '../../src/tools/types'

// Gate for BRU-2440: the published manifest's `primaryAudience` must equal
// the audience a tool ACTUALLY resolves to at runtime — the audience implied
// by which of {student, teacher, admin} the server registers the tool for.
//
// This deliberately does NOT re-derive "runtime truth" from the same
// `toolDomainCatalog` data the manifest itself is built from (that is exactly
// how the bug this gate exists to catch went undetected — see
// tests/docs/tool-count-consistency.test.ts's comment on this file's prior
// self-consistent-but-wrong role counts). Instead it exercises `getAllTools`,
// the same function `registerAllTools`/`createCanvasMCPServer` calls at
// runtime, once per role, and inverts `ROLE_VISIBILITY` from the result.

const ALL_FEATURES: ToolFeatureFlags = { assignmentSubmission: true }
const ROLES: readonly CanvasRole[] = ['student', 'teacher', 'admin']

function mockCanvas(): CanvasClient {
  const deep: unknown = new Proxy(function () {}, {
    get: () => deep,
    apply: () => deep,
  })
  return deep as CanvasClient
}

/** Tool names visible to each role, exactly as `registerAllTools` would register them. */
function visibleNamesByRole(): Record<CanvasRole, Set<string>> {
  const result = {} as Record<CanvasRole, Set<string>>
  for (const role of ROLES) {
    const names = getAllTools(mockCanvas(), undefined, role, ALL_FEATURES).map((t) => t.name)
    result[role] = new Set(names)
  }
  return result
}

/**
 * Invert which roles can see a tool into the `ToolAudience` that would produce
 * that visibility pattern under `ROLE_VISIBILITY`, or `undefined` if the
 * pattern doesn't correspond to any audience (a structurally impossible
 * combination given `ROLE_VISIBILITY`'s student ⊂ teacher ⊂ admin nesting).
 */
function inferAudience(visibleTo: {
  student: boolean
  teacher: boolean
  admin: boolean
}): ToolAudience | undefined {
  if (visibleTo.student && visibleTo.teacher && visibleTo.admin) return 'shared'
  if (visibleTo.student && !visibleTo.teacher && !visibleTo.admin) return 'student'
  if (!visibleTo.student && visibleTo.teacher && visibleTo.admin) return 'educator'
  if (!visibleTo.student && !visibleTo.teacher && visibleTo.admin) return 'admin'
  return undefined
}

describe('manifest/runtime audience parity gate', () => {
  const manifest = buildToolManifest()
  const byRole = visibleNamesByRole()

  it('compares all 165 tools (anti-vacuity guard)', () => {
    expect(manifest.tools.length).toBe(165)

    // Union of everything registered under any role must equal the manifest's
    // 165 tools too — otherwise this gate would be silently comparing against
    // an empty or truncated runtime side.
    const unionOfRoles = new Set([...byRole.student, ...byRole.teacher, ...byRole.admin])
    expect(unionOfRoles.size).toBe(165)
  })

  it('every tool visibility pattern maps to exactly one known audience (anti-vacuity guard)', () => {
    const unexpected = manifest.tools
      .map((tool) => ({
        name: tool.name,
        pattern: {
          student: byRole.student.has(tool.name),
          teacher: byRole.teacher.has(tool.name),
          admin: byRole.admin.has(tool.name),
        },
      }))
      .filter(({ pattern }) => inferAudience(pattern) === undefined)

    expect(unexpected).toEqual([])
  })

  it.each(
    // Snapshot the manifest's tool list once so a divergent audience on any
    // single tool (injected via a fresh manifest build in the test below)
    // doesn't change which test cases this suite runs.
    buildToolManifest().tools.map((t) => t.name),
  )('%s: manifest primaryAudience matches runtime role visibility', (name) => {
    const tool = manifest.tools.find((t) => t.name === name)
    if (!tool) throw new Error(`unreachable: ${name} came from the manifest itself`)

    const runtimeAudience = inferAudience({
      student: byRole.student.has(name),
      teacher: byRole.teacher.has(name),
      admin: byRole.admin.has(name),
    })

    expect(
      tool.primaryAudience,
      `manifest says "${name}" is audience="${tool.primaryAudience}" but at runtime it is only ` +
        `registered for {student: ${byRole.student.has(name)}, teacher: ${byRole.teacher.has(name)}, ` +
        `admin: ${byRole.admin.has(name)}} (audience="${runtimeAudience}")`,
    ).toBe(runtimeAudience)
  })

  it('catches an injected divergence (proves this gate is not vacuously green)', () => {
    // get_todo_items is domain 'dashboard' (default audience 'student') and
    // has no inline `audience`, so it currently resolves to 'student' on both
    // sides. Force the manifest side to disagree without touching runtime
    // registration, mirroring exactly the class of bug BRU-2440 found.
    const divergent = buildToolManifest({
      toolCatalog: [
        {
          domain: 'dashboard',
          defaultPrimaryAudience: 'admin',
          getTools: () => [
            {
              name: 'get_todo_items',
              description: 'test',
              inputSchema: {},
              annotations: { readOnlyHint: true },
              handler: async () => undefined,
            },
          ],
        },
      ],
      workflowCatalog: [],
    })

    const tool = divergent.tools.find((t) => t.name === 'get_todo_items')
    expect(tool?.primaryAudience).toBe('admin')
    expect(tool?.primaryAudience).not.toBe(
      inferAudience({
        student: byRole.student.has('get_todo_items'),
        teacher: byRole.teacher.has('get_todo_items'),
        admin: byRole.admin.has('get_todo_items'),
      }),
    )
  })
})
