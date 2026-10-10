import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pseudonymizer, WITHHELD_AUTHOR_NAME } from '../../src/pseudonym/pseudonymizer'
import type { CanvasUser } from '../../src/canvas/types'
import { applyFencing } from '../../src/provenance/apply'
import { MARKER_CLOSE, MARKER_OPEN_PREFIX } from '../../src/provenance/markers'
import {
  ACTIVITY_STREAM_FIXTURES,
  ACTIVITY_STREAM_REAL_NAMES,
  FIXTURE_CONTEXT_MESSAGE,
  FIXTURE_CONVERSATION,
  FIXTURE_COURSE_DISCUSSION,
  FIXTURE_DISCUSSION_ENTRY,
  FIXTURE_GROUP_DISCUSSION,
  FIXTURE_NO_CONTEXT_WITH_NAME,
  FIXTURE_SUBMISSION,
  FIXTURE_SUBMISSION_DISCUSSION,
  FIXTURE_SUBMISSION_DISCUSSION_NO_ID,
  FIXTURE_SUBMISSION_PROXY,
  FIXTURE_SUBMISSION_PROXY_NO_ID,
  FIXTURE_SUBMISSION_UNREADABLE_AUTHOR,
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

// --- BRU-2863: the Submission arm's remaining name-bearing fields -----------
//
// `CanvasActivityStreamEntry` accepts the whole merged `submission_json` through
// an open index signature, so "the Submission arm" is as wide as Canvas's
// submission serializer. Audited key by key at the pinned SHA
// 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c, three name-bearing surfaces reach
// the stream beyond `user` and `submission_comments[].author_name`:
//
//   - `discussion_entries[]`     — `user_name`, `user.display_name`, recursive
//   - `proxy_submitter`          — a bare string, with a `proxy_submitter_id`
//   - `submission_comments[].author.display_name` — NOT in the original report
//
// Every assertion below is per-SURFACE for the same reason the arm tests above
// are per-arm: one "no real names anywhere" test passes with two of the three
// unimplemented.

type DiscussionEntry = {
  user_id?: string
  user_name?: string
  user?: { id?: string; display_name?: string; avatar_image_url?: unknown; pronouns?: unknown }
  recent_replies?: DiscussionEntry[]
  message?: string
  attachment?: unknown
  attachments?: unknown
}

function entriesOf(item: unknown): DiscussionEntry[] {
  return (item as { discussion_entries: DiscussionEntry[] }).discussion_entries
}

describe('anonymizeActivityStream — Submission arm: discussion_entries[]', () => {
  it('pseudonymizes user_name on a live entry and keeps the user_id', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const [root] = entriesOf(item)
    expect(root!.user_name).toBe('Student 1')
    expect(root!.user_id).toBe('42')
  })

  it('pseudonymizes the nested user.display_name, which spells the name under another key', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const [root] = entriesOf(item)
    expect(root!.user!.display_name).toBe('Student 1')
    expect(root!.user!.id).toBe('42')
  })

  it('nulls the avatar and pronouns beside a rewritten display_name', async () => {
    // Parity with `applyPseudonymToUser`, which already does `avatar_url =
    // undefined` / `pronouns = null`. A photograph and a pronoun set sitting
    // next to "Student 1" re-identify the student as surely as the name did.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const [root] = entriesOf(item)
    expect(root!.user!.avatar_image_url).toBeNull()
    expect(root!.user!.pronouns).toBeNull()
  })

  it('gives user_name and user.display_name the SAME pseudonym for one user_id', async () => {
    // They are two spellings of one person. Two different labels would imply
    // two participants in the thread, which is a correctness bug on top of a
    // privacy one.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const [root] = entriesOf(item)
    expect(root!.user_name).toBe(root!.user!.display_name)
  })

  it('recurses into recent_replies and pseudonymizes a different reply author distinctly', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const reply = entriesOf(item)[0]!.recent_replies![0]!
    expect(reply.user_name).toBe('Student 2')
    expect(reply.user!.display_name).toBe('Student 2')
    expect(reply.user_id).toBe('44')
    // Distinct from the root author: the reply is a different student, and the
    // reader must be able to tell them apart.
    expect(reply.user_name).not.toBe(entriesOf(item)[0]!.user_name)
  })

  it('masks a DELETED entry, whose only identity is user.display_name with no user_name', async () => {
    // `serialize_entry` drops `user_id` and `user_name` for a deleted entry but
    // emits `user` regardless — the `:display_user` guard has no `deleted?`
    // check. An implementation keyed on `user_name` leaves this name in place.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const deleted = entriesOf(item)[1]!
    expect(deleted.user_name).toBeUndefined()
    expect(deleted.user!.display_name).toBe('Student 1')
    // Same person as the live entry, so the same label — the deleted entry
    // resolves through `user.id` rather than the absent `user_id`.
    expect(deleted.user!.display_name).toBe(entriesOf(item)[0]!.user_name)
  })

  it('leaves the entry message text alone (the fence owns it, not the pseudonymizer)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const fixtureEntries = FIXTURE_SUBMISSION_DISCUSSION.discussion_entries as DiscussionEntry[]
    expect(entriesOf(item)[0]!.message).toBe(fixtureEntries[0]!.message)
    expect(entriesOf(item)[0]!.recent_replies![0]!.message).toBe(
      fixtureEntries[0]!.recent_replies![0]!.message,
    )
  })

  it('withholds a display name that has no id at all (fails closed)', async () => {
    // This test exists because the injection matrix for this change scored the
    // branch it covers at ZERO failing tests: every fixture happened to carry
    // an `id`, so the fail-closed path was unreachable and the guard was
    // decoration. A guard with no reachable test is not a guard.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION_NO_ID])

    const entry = entriesOf(item)[0]!
    expect(entry.user!.display_name).toBe(WITHHELD_AUTHOR_NAME)
    // Not a Student N: a pseudonym would imply this author can be correlated
    // with the same person elsewhere in the response, and without an id they
    // cannot be.
    expect(entry.user!.display_name).not.toMatch(/^Student \d+$/)
    expect(JSON.stringify(item)).not.toContain('Sasha Virk')
  })

  it('passes the entry attachments through untouched — the audit found no identity key', async () => {
    // `discussion_entry_attachment` calls `attachment_json(entry.attachment,
    // user, url_options)` with NO `include`, and `attachment_json` gates its
    // `user` key on `includes.include?("user")`. This asserts that audit
    // conclusion instead of leaving it in a comment: the day an attachment
    // starts carrying a user, this test stops matching the fixture.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])

    const fixtureEntries = FIXTURE_SUBMISSION_DISCUSSION.discussion_entries as DiscussionEntry[]
    expect(entriesOf(item)[0]!.attachment).toEqual(fixtureEntries[0]!.attachment)
    expect(entriesOf(item)[0]!.attachments).toEqual(fixtureEntries[0]!.attachments)
  })
})

describe('anonymizeActivityStream — Submission arm: proxy_submitter', () => {
  it('pseudonymizes the proxy submitter keyed by proxy_submitter_id and keeps the id', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_PROXY])

    // A proxy submitter is staff, but `classifyRole({id, name})` with no
    // enrollments is `'unknown'` and `shouldPseudonymize('unknown')` is true,
    // so the name is masked. Failing closed on an identity we cannot classify
    // is the rule; the alternative leaks a name on the strength of a guess.
    expect(item!.proxy_submitter).toBe('Student 2')
    expect(item!.proxy_submitter_id).toBe('12')
  })

  it('withholds the name outright when there is no proxy_submitter_id (fails closed)', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_PROXY_NO_ID])

    expect(item!.proxy_submitter).toBe(WITHHELD_AUTHOR_NAME)
    expect(item!.proxy_submitter).not.toMatch(/^Student \d+$/)
  })

  it('resolves the proxy submitter in the item’s own scope, not a shared one', async () => {
    // Same architecture as every other surface: per-item scope, so a group
    // item's proxy submitter lands in `_group_<id>` and never the course map.
    const inGroup: Record<string, unknown> = {
      ...FIXTURE_SUBMISSION_PROXY,
      context_type: 'Group',
      group_id: '7',
    }
    delete inGroup.course_id

    await make().anonymizeActivityStream([inGroup as unknown as typeof FIXTURE_SUBMISSION_PROXY])

    const { mapFilePath } = await import('../../src/pseudonym/paths')
    const { readFile } = await import('node:fs/promises')
    const groupMap = JSON.parse(
      await readFile(mapFilePath(tmpRoot, 'school.instructure.com', '_group_7'), 'utf8'),
    ) as { students: Record<string, unknown> }

    expect(Object.keys(groupMap.students).sort()).toEqual(['12', '42'])
    await expect(
      readFile(mapFilePath(tmpRoot, 'school.instructure.com', '101'), 'utf8'),
    ).rejects.toThrow()
  })
})

describe('anonymizeActivityStream — Submission arm: submission_comments[].author', () => {
  it('rewrites a peer reviewer’s nested author.display_name, not only author_name', async () => {
    // The leak the original report did not name. `submission_comment_json`
    // emits `author` = `user_display_json(...)` beside `author_name`, so
    // masking `author_name` alone leaves the real name one key over on the one
    // arm PR #406 claimed to cover.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    const peer = item!.submission_comments![1]!
    expect(peer.author_name).toBe('Student 2')
    expect(peer.author!.display_name).toBe('Student 2')
    expect(peer.author!.display_name).toBe(peer.author_name)
    expect(peer.author!.id).toBe('43')
  })

  it('nulls the peer reviewer’s avatar and pronouns too', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    const peer = item!.submission_comments![1]!
    expect(peer.author!.avatar_image_url).toBeNull()
    expect(peer.author!.pronouns).toBeNull()
  })

  it('leaves the recorded grader’s nested author object intact (AC-9 parity)', async () => {
    // grader_id is 9, so staff feedback stays attributable — and the nested
    // object must follow the SAME rule as `author_name`, or the two keys
    // disagree about who wrote the comment.
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    const grader = item!.submission_comments![0]!
    expect(grader.author_name).toBe('Prof. Amara Okoro')
    expect(grader.author).toEqual(FIXTURE_SUBMISSION.submission_comments![0]!.author)
  })
})

describe('anonymizeActivityStream — Submission arm: an author the viewer may not read', () => {
  // BRU-2864. `submission_comment_json` takes its `else` branch when
  // `:read_author` is not granted and sets `author: {}`, `author_id: nil` and
  // `author_name: "Anonymous User"` TOGETHER
  // (lib/api/v1/submission_comment.rb:68-72 at the pinned SHA
  // 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c), so Canvas has already
  // anonymized the comment and leaves no id anywhere on it — not a flat
  // `author_id`, and not a nested `author.id` either.
  it('keeps Canvas’s own “Anonymous User” byline and invents no display name', async () => {
    const [item] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_UNREADABLE_AUTHOR])

    const unreadable = item!.submission_comments![1]!
    expect(unreadable.author_name).toBe('Anonymous User')
    expect(unreadable.author_name).not.toMatch(/^Student \d+$/)
    // `applyPseudonymToDisplay` ADDS a `display_name` to whatever it is given,
    // so a pseudonym reaching here would invent an author byline on an object
    // the serializer deliberately emptied.
    expect(unreadable.author).toEqual({})
  })

  it('spends no pseudonym on it and writes no junk key to the course map', async () => {
    await make().anonymizeActivityStream([FIXTURE_SUBMISSION_UNREADABLE_AUTHOR])

    const { mapFilePath } = await import('../../src/pseudonym/paths')
    const { readFile } = await import('node:fs/promises')
    const map = JSON.parse(
      await readFile(mapFilePath(tmpRoot, 'school.instructure.com', '101'), 'utf8'),
    ) as { students: Record<string, unknown>; next_pseudonym_index: number }

    // The submitting student and nobody else: the recorded grader (9) is
    // excluded by `grader_id`, and an author with no id contributes nothing. A
    // `"null"` key here would mean the pre-warm loop keyed the map on
    // `String(comment.author_id)` regardless — which both spends an index on a
    // non-person and makes the byline above rewritable.
    expect(Object.keys(map.students).sort()).toEqual(['42'])
    expect(map.next_pseudonym_index).toBe(2)
  })

  it('still rewrites a readable peer author on the same payload shape (control)', async () => {
    // Not a blanket “comments are left alone”: the ordinary `:read_author`
    // shape differs from the fixture above only in carrying an id, and it is
    // still pseudonymized.
    const [plain] = await make().anonymizeActivityStream([FIXTURE_SUBMISSION])

    expect(plain!.submission_comments![1]!.author_name).toBe('Student 2')
  })
})

describe('anonymizeActivityStream — Submission arm: a "null" key written by another tool', () => {
  // BRU-2863. The pre-warm guard above stops THIS path from writing a `"null"`
  // key, but it is only one of two writers. The course map is shared per
  // (host, course) and persisted to disk, and the read side keyed on
  // `String(c.author_id)` unguarded — so `String(null) === 'null'` found any
  // `"null"` entry another caller had left there.
  //
  // `get_my_submission_feedback` is such a caller: `classifyCommentAuthor`
  // (src/tools/student.ts:62-68) returns 'peer' for a comment whose
  // `author_id` is nil, because nil matches neither `submission.user_id` nor
  // `grader_id`, and the warm call at :271-276 passes that nil straight into
  // `anonymizeUser`. The stream's output must not depend on another tool's
  // hygiene, so the guard belongs on the read as well as the write.
  it('keeps Canvas’s “Anonymous User” byline when the map already holds a "null" key', async () => {
    const p = make()
    // Exactly the call student.ts:271-276 makes for an unreadable author.
    await p.anonymizeUser('101', {
      id: null,
      name: 'Anonymous User',
    } as unknown as CanvasUser)

    const [item] = await p.anonymizeActivityStream([FIXTURE_SUBMISSION_UNREADABLE_AUTHOR])

    const unreadable = item!.submission_comments![1]!
    expect(unreadable.author_name).toBe('Anonymous User')
    expect(unreadable.author_name).not.toMatch(/^Student \d+$/)
    expect(unreadable.author).toEqual({})
  })

  it('still rewrites a readable peer author while a "null" key is present (control)', async () => {
    // Not a blanket “stop reading the map”: the same run, same poisoned map,
    // and an ordinary readable author is still pseudonymized.
    const p = make()
    await p.anonymizeUser('101', {
      id: null,
      name: 'Anonymous User',
    } as unknown as CanvasUser)

    const [item] = await p.anonymizeActivityStream([FIXTURE_SUBMISSION])

    expect(item!.submission_comments![1]!.author_name).toMatch(/^Student \d+$/)
  })
})

describe('anonymizeActivityStream — negative sweep over every fixture (AC-8)', () => {
  it('leaves no real student name anywhere in the serialized output', async () => {
    const items = await make().anonymizeActivityStream([
      ...ACTIVITY_STREAM_FIXTURES,
      FIXTURE_SUBMISSION_PROXY_NO_ID,
      FIXTURE_SUBMISSION_DISCUSSION_NO_ID,
      FIXTURE_NO_CONTEXT_WITH_NAME,
      FIXTURE_SUBMISSION_UNREADABLE_AUTHOR,
    ])
    const json = JSON.stringify(items)

    // Anti-vacuity, two ways. The sweep must be searching a payload that still
    // contains the deliberately-preserved staff name, or an empty/undefined
    // result would pass every assertion below.
    expect(json).toContain('Prof. Amara Okoro')
    expect(items).toHaveLength(ACTIVITY_STREAM_FIXTURES.length + 4)

    for (const name of ACTIVITY_STREAM_REAL_NAMES) {
      expect(json).not.toContain(name)
    }
  })

  it('still leaks every one of those names when the flag is off, proving the sweep can fail', async () => {
    // The control for the test above: same sweep, same fixtures, flag off. If
    // this does not find the names, the sweep is not looking where it claims.
    const items = await make({}).anonymizeActivityStream([
      ...ACTIVITY_STREAM_FIXTURES,
      FIXTURE_SUBMISSION_PROXY_NO_ID,
      FIXTURE_SUBMISSION_DISCUSSION_NO_ID,
      FIXTURE_NO_CONTEXT_WITH_NAME,
      FIXTURE_SUBMISSION_UNREADABLE_AUTHOR,
    ])
    const json = JSON.stringify(items)

    for (const name of ACTIVITY_STREAM_REAL_NAMES) {
      expect(json).toContain(name)
    }
  })
})

describe('fencing reaches the Submission arm’s nested discussion_entries (AC-9 / AC-10)', () => {
  // The audit concluded that `src/provenance/fields.ts` needs NO change for the
  // three newly-covered surfaces: fencing is a deep by-name walk and
  // `get_my_activity_stream` already registers `message`, so
  // `discussion_entries[].message` and `recent_replies[].message` are already
  // in scope; and `user_name` / `display_name` / `proxy_submitter` are names,
  // which are the pseudonymizer's job alone. Both halves of that conclusion are
  // asserted here rather than left in a comment — "no change needed" is a
  // claim about behaviour, so it owes a test.
  it('fences the nested entry messages at BOTH depths', async () => {
    const pseudonymized = await make().anonymizeActivityStream([FIXTURE_SUBMISSION_DISCUSSION])
    const { value, fencedFields } = applyFencing('get_my_activity_stream', {
      items: pseudonymized,
    })
    const entries = entriesOf((value as { items: unknown[] }).items[0])

    expect(fencedFields).toContain('message')
    // Depth 1: discussion_entries[].message
    expect(entries[0]!.message).toContain(MARKER_OPEN_PREFIX)
    expect(entries[0]!.message).toContain(MARKER_CLOSE)
    // Depth 2: recent_replies[].message — the recursion the fence had never
    // been exercised against, because no fixture reached this deep before.
    expect(entries[0]!.recent_replies![0]!.message).toContain(MARKER_OPEN_PREFIX)
    expect(entries[0]!.recent_replies![0]!.message).toContain(MARKER_CLOSE)
  })

  it('leaves no provenance marker inside any name the pseudonymizer rewrote', async () => {
    const pseudonymized = await make().anonymizeActivityStream([
      FIXTURE_SUBMISSION_DISCUSSION,
      FIXTURE_SUBMISSION_PROXY,
      FIXTURE_SUBMISSION_PROXY_NO_ID,
    ])
    const { value } = applyFencing('get_my_activity_stream', { items: pseudonymized })
    const items = (value as { items: Record<string, unknown>[] }).items
    const entries = entriesOf(items[0])

    const names = [
      entries[0]!.user_name!,
      entries[0]!.user!.display_name!,
      entries[0]!.recent_replies![0]!.user_name!,
      entries[0]!.recent_replies![0]!.user!.display_name!,
      entries[1]!.user!.display_name!,
      items[1]!.proxy_submitter as string,
      items[2]!.proxy_submitter as string,
    ]

    // Anti-vacuity: the names really were resolved, so this is not seven
    // undefineds trivially satisfying the loop below.
    //
    // The proxy submitter is `Student 3`, not `Student 2`, and that is the
    // correct answer rather than an off-by-one: both items are in course 101,
    // so they share one scope and one counter, and the discussion item has
    // already taken 1 (user 42) and 2 (user 44) by the time user 12 is
    // resolved. Indices are allocated per scope in first-seen order across the
    // whole response, not per item.
    expect(names).toEqual([
      'Student 1',
      'Student 1',
      'Student 2',
      'Student 2',
      'Student 1',
      'Student 3',
      WITHHELD_AUTHOR_NAME,
    ])
    for (const name of names) {
      expect(name).not.toContain(MARKER_OPEN_PREFIX)
      expect(name).not.toContain(MARKER_CLOSE)
    }
  })
})
