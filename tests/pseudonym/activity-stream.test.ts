import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer, WITHHELD_AUTHOR_NAME } from '../../src/pseudonym/pseudonymizer'
import { applyFencing } from '../../src/provenance/apply'
import { MARKER_CLOSE, MARKER_OPEN_PREFIX } from '../../src/provenance/markers'
import {
  FIXTURE_CONTEXT_MESSAGE,
  FIXTURE_CONVERSATION,
  FIXTURE_COURSE_DISCUSSION,
  FIXTURE_DISCUSSION_ENTRY,
  FIXTURE_GROUP_DISCUSSION,
  FIXTURE_NO_CONTEXT_WITH_NAME,
  FIXTURE_SUBMISSION,
} from '../fixtures/activity-stream'

// BRU-2797 §6.2 / §9 AC-8, AC-10. Every assertion here is per-ARM: a single
// "no real names anywhere in the output" test would pass with three of the four
// PII arms unimplemented, which is the failure mode AC-8 exists to prevent.

const BASE_URL = 'https://school.instructure.com/api/v1'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'activity-stream-pseudonym-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function make(env: NodeJS.ProcessEnv = { CANVAS_PSEUDONYMIZE_STUDENTS: 'true' }) {
  return new Pseudonymizer({
    baseUrl: BASE_URL,
    rootDir: tmpRoot,
    env,
    auditLog: () => undefined,
  })
}

describe('anonymizeActivityStream — arm 1: root_discussion_entries[].user.user_name', () => {
  it('replaces the entry author name with a scope-stable pseudonym and keeps the user_id', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_COURSE_DISCUSSION])

    const entry = item!.root_discussion_entries![0]!
    expect(entry.user.user_name).toBe('Student 1')
    // Ids are never rewritten by any anonymize* method — `applyPseudonymToUser`
    // preserves `user.id` — so the key shape stays `{user_id, user_name}`.
    expect(entry.user.user_id).toBe('42')
    expect(JSON.stringify(item)).not.toContain('Dana Lin')
  })

  it('leaves the entry message text alone (that is the fence’s job, not the pseudonymizer’s)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_COURSE_DISCUSSION])

    expect(item!.root_discussion_entries![0]!.message).toBe(
      FIXTURE_COURSE_DISCUSSION.root_discussion_entries![0]!.message,
    )
  })
})

describe('anonymizeActivityStream — arm 2: author_name on a DiscussionEntry item', () => {
  it('withholds the name, because the item carries no identifier to key a pseudonym on', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_DISCUSSION_ENTRY])

    expect(item!.author_name).toBe(WITHHELD_AUTHOR_NAME)
    expect(JSON.stringify(item)).not.toContain('Kim Patel')
  })

  it('does not invent a Student N pseudonym for it', async () => {
    // A `Student N` here would imply the caller can correlate this author with
    // the same person elsewhere in the response. They cannot: there is no id.
    const [item] = await make().anonymizeActivityStream([FIXTURE_DISCUSSION_ENTRY])

    expect(item!.author_name).not.toMatch(/^Student \d+$/)
  })

  it('withholds the name even when no context key is present (fails closed)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_NO_CONTEXT_WITH_NAME])

    expect(item!.author_name).toBe(WITHHELD_AUTHOR_NAME)
    expect(JSON.stringify(item)).not.toContain('Robin Shaw')
  })
})

describe('anonymizeActivityStream — arm 3: the Submission arm (user + submission_comments)', () => {
  it('pseudonymizes the submitting student and scrubs their sis_user_id', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    expect(item!.user!.name).toBe('Student 1')
    expect(item!.user!.sis_user_id).toBeNull()
    expect(JSON.stringify(item)).not.toContain('SIS-42')
  })

  it('pseudonymizes a peer reviewer’s comment author_name but keeps the recorded grader’s', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    const [graderComment, peerComment] = item!.submission_comments!
    // grader_id is 9, so staff feedback stays attributable — the same rule
    // get_my_submission_feedback applies to this payload shape.
    expect(graderComment!.author_name).toBe('Prof. Amara Okoro')
    expect(peerComment!.author_name).toMatch(/^Student \d+$/)
    expect(JSON.stringify(item)).not.toContain('Jamie Fox')
  })

  it('leaves the submission body and comment text alone', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    expect(item!.body).toBe(FIXTURE_SUBMISSION.body)
    expect(item!.submission_comments![1]!.comment).toBe(
      FIXTURE_SUBMISSION.submission_comments![1]!.comment,
    )
  })
})

describe('anonymizeActivityStream — arm 4: the Conversation arm carries no name at all', () => {
  // A CHARACTERIZATION test, not a dispatch test, and deliberately so.
  //
  // BRU-2797 §6.1 lists `latest_messages` as a PII arm and §9 AC-8 asks for a
  // pseudonymization test for it. Measured against
  // `StreamItem#prepare_conversation`, each entry is `{id, created_at,
  // author_id, message, participating_user_ids}` — identifiers and text, no
  // name — and `stream_item_json`'s Conversation arm never emits the
  // `participants` array that `prepare_conversation` also builds. So there is
  // nothing for the pseudonymizer to rewrite: ids are preserved by every
  // existing anonymize* method, and the message text is provenance-fenced.
  //
  // This test is what keeps that decision honest. The day Canvas adds a name to
  // the conversation arm, it fails.
  it('round-trips byte-identically', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_CONVERSATION])

    expect(item).toEqual(FIXTURE_CONVERSATION)
  })

  it('carries no name-shaped key anywhere in the arm', () => {
    const keys = new Set<string>()
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) {
          keys.add(k)
          walk(v)
        }
      }
    }
    walk(FIXTURE_CONVERSATION)

    // Anti-vacuity: the walk really did reach the nested message objects.
    expect(keys).toContain('participating_user_ids')
    for (const nameKey of ['name', 'user_name', 'author_name', 'short_name', 'display_name']) {
      expect(keys).not.toContain(nameKey)
    }
  })
})

describe('anonymizeActivityStream — scope', () => {
  it('resolves the same user_id independently per scope, allocating from each scope’s own counter', async () => {
    // Per-item scoping is the §6.2 recommendation: the stream then agrees with
    // list_submissions on the same student in the same course, at the cost of an
    // honest per-context split. A single cross-course scope would disagree with
    // every other tool.
    //
    // §8 asks for "a cross-course fixture proving two courses give two
    // pseudonyms for one user_id". Measured, that is NOT what comparing the two
    // LABELS shows: each scope's `next_pseudonym_index` starts at 1, so user 42
    // alone in two scopes is `Student 1` in BOTH. The property that actually
    // holds is independence of allocation, asserted here and structurally in the
    // map-file test below; the next test shows what the labels do and do not mean.
    const [groupItem, courseItem] = await make().anonymizeActivityStream([
      FIXTURE_GROUP_DISCUSSION,
      FIXTURE_COURSE_DISCUSSION,
    ])

    expect(groupItem!.root_discussion_entries![0]!.user.user_name).toBe('Student 1')
    expect(courseItem!.root_discussion_entries![0]!.user.user_name).toBe('Student 1')
    expect(groupItem!.root_discussion_entries![0]!.user.user_id).toBe('42')
    expect(courseItem!.root_discussion_entries![0]!.user.user_id).toBe('42')
  })

  it('makes one label mean different people in different scopes', async () => {
    // The consequence of the per-scope counter, and the reason an agent must
    // never join on the pseudonym across contexts: two DIFFERENT users, one in a
    // group and one in a course, both come back as `Student 1`.
    const otherUserInGroup = {
      ...FIXTURE_GROUP_DISCUSSION,
      root_discussion_entries: [
        { user: { user_id: '99', user_name: 'Lee Nakamura' }, message: '<p>On it.</p>' },
      ],
    }

    const [groupItem, courseItem] = await make().anonymizeActivityStream([
      otherUserInGroup,
      FIXTURE_COURSE_DISCUSSION,
    ])

    expect(groupItem!.root_discussion_entries![0]!.user.user_name).toBe('Student 1')
    expect(courseItem!.root_discussion_entries![0]!.user.user_name).toBe('Student 1')
    expect(groupItem!.root_discussion_entries![0]!.user.user_id).not.toBe(
      courseItem!.root_discussion_entries![0]!.user.user_id,
    )
  })

  it('writes the group-context map under an isolated _group_<id> scope, never the course map', async () => {
    await make().anonymizeActivityStream([FIXTURE_GROUP_DISCUSSION, FIXTURE_COURSE_DISCUSSION])

    const { mapFilePath } = await import('../../src/pseudonym/paths')
    const groupPath = mapFilePath(tmpRoot, 'school.instructure.com', '_group_7')
    const coursePath = mapFilePath(tmpRoot, 'school.instructure.com', '101')
    expect(groupPath).not.toBe(coursePath)

    const { readFile } = await import('node:fs/promises')
    const groupMap = JSON.parse(await readFile(groupPath, 'utf8')) as {
      students: Record<string, { pseudonym: string }>
    }
    const courseMap = JSON.parse(await readFile(coursePath, 'utf8')) as {
      students: Record<string, { pseudonym: string }>
    }
    // One entry each: the maps were not merged.
    expect(Object.keys(groupMap.students)).toEqual(['42'])
    expect(Object.keys(courseMap.students)).toEqual(['42'])
  })
})

describe('anonymizeActivityStream — pass-through cases', () => {
  it('returns every item unchanged when the flag is off', async () => {
    const off = make({})
    expect(off.isEnabled()).toBe(false)

    const items = await off.anonymizeActivityStream([FIXTURE_SUBMISSION, FIXTURE_DISCUSSION_ENTRY])

    expect(items).toEqual([FIXTURE_SUBMISSION, FIXTURE_DISCUSSION_ENTRY])
  })

  it('round-trips the common-prefix-only ContextMessage item (fixture 1)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_CONTEXT_MESSAGE])

    expect(item).toEqual(FIXTURE_CONTEXT_MESSAGE)
  })

  it('does not add a course_id to a group-context item (AC-7)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_GROUP_DISCUSSION])

    expect(Object.keys(item!)).not.toContain('course_id')
    expect(item!.group_id).toBe('7')
  })
})

describe('pseudonymizer and fence do not both rewrite a name (AC-10)', () => {
  it('leaves no provenance marker inside any pseudonymized or withheld name', async () => {
    const pseudonymized = await make().anonymizeActivityStream([
      FIXTURE_COURSE_DISCUSSION,
      FIXTURE_DISCUSSION_ENTRY,
      FIXTURE_SUBMISSION,
    ])
    const { value, fencedFields } = applyFencing('get_my_activity_stream', {
      items: pseudonymized,
    })
    const items = (value as { items: Record<string, unknown>[] }).items

    // Anti-vacuity: the fence really did run over this payload.
    expect(fencedFields).toEqual(['body', 'comment', 'message'])

    const names = [
      (items[0]!.root_discussion_entries as { user: { user_name: string } }[])[0]!.user.user_name,
      items[1]!.author_name as string,
      (items[2]!.user as { name: string }).name,
      ...(items[2]!.submission_comments as { author_name: string }[]).map((c) => c.author_name),
    ]

    expect(names).toEqual([
      'Student 1',
      WITHHELD_AUTHOR_NAME,
      'Student 1',
      'Prof. Amara Okoro',
      'Student 2',
    ])
    for (const name of names) {
      expect(name).not.toContain(MARKER_OPEN_PREFIX)
      expect(name).not.toContain(MARKER_CLOSE)
    }
  })
})
