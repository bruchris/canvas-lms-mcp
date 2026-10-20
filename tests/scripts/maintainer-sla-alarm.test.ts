import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain .mjs with no declarations; tests are not type-checked by tsc
import {
  classifyItem,
  collectActivity,
  buildAlarmBody,
  readConfig,
  createGitHubClient,
  runAlarm,
} from '../../.github/scripts/maintainer-sla-alarm.mjs'

const now = Date.parse('2026-10-20T12:00:00Z')
const hour = 60 * 60 * 1000
const ago = (hours: number) => new Date(now - hours * hour).toISOString()
const repo = 'bruchris/canvas-lms-mcp'

function outside(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: 'An outside contribution',
    state: 'open',
    user: { login: 'contributor', type: 'User' },
    created_at: ago(25),
    updated_at: ago(1),
    html_url: `https://github.com/${repo}/issues/42`,
    labels: [],
    ...overrides,
  }
}

describe('classifyItem', () => {
  it('flags an unanswered outside issue after 24h', () => {
    expect(classifyItem(outside(), {}, now)).toMatchObject({
      number: 42,
      kind: 'issue',
      lastMaintainerActivity: null,
      rules: ['No maintainer response within 24h'],
    })
  })

  it.each([1, 24])('does not flag an unanswered item aged %sh', (age) => {
    expect(classifyItem(outside({ created_at: ago(age) }), {}, now)).toBeNull()
  })

  it('counts any maintainer response, even if it was not the most recent activity', () => {
    expect(classifyItem(outside(), { lastMaintainerActivity: ago(20) }, now)).toBeNull()
  })

  it('flags an author reply after the last maintainer action, even if the reply is recent', () => {
    expect(
      classifyItem(
        outside({ created_at: ago(100) }),
        {
          lastMaintainerActivity: ago(80),
          lastAuthorActivity: ago(1),
        },
        now,
      ).rules,
    ).toEqual(['Author awaiting maintainer action for 72h'])
  })

  it('does not treat an older author action as an unanswered reply', () => {
    expect(
      classifyItem(
        outside({ created_at: ago(100) }),
        {
          lastMaintainerActivity: ago(80),
          lastAuthorActivity: ago(90),
        },
        now,
      ),
    ).toBeNull()
  })

  it('flags inactivity even when the maintainer was the last person to act', () => {
    expect(
      classifyItem(
        outside({ created_at: ago(100), updated_at: ago(80) }),
        {
          lastMaintainerActivity: ago(80),
          lastAuthorActivity: ago(100),
        },
        now,
      ).rules,
    ).toEqual(['No activity for 72h'])
  })

  it.each(['blocked-on-author', 'needs-info'])('exempts idle items labeled %s', (label) => {
    expect(
      classifyItem(
        outside({
          created_at: ago(100),
          updated_at: ago(80),
          labels: [{ name: label }],
        }),
        { lastMaintainerActivity: ago(80) },
        now,
      ),
    ).toBeNull()
  })

  it('does not let waiting-on-author labels waive an unanswered first response', () => {
    expect(classifyItem(outside({ labels: ['needs-info'] }), {}, now).rules).toEqual([
      'No maintainer response within 24h',
    ])
  })

  it('does not flag inactivity at exactly the threshold or after someone else acts', () => {
    for (const updatedAt of [ago(72), ago(1)]) {
      expect(
        classifyItem(
          outside({ created_at: ago(100), updated_at: updatedAt }),
          {
            lastMaintainerActivity: ago(90),
            lastAuthorActivity: ago(100),
          },
          now,
        ),
      ).toBeNull()
    }
  })

  it('flags PR age independently of recent maintainer activity', () => {
    expect(
      classifyItem(
        outside({ pull_request: {}, created_at: ago(169) }),
        {
          lastMaintainerActivity: ago(1),
        },
        now,
      ),
    ).toMatchObject({ kind: 'PR', rules: ['PR open more than 7 days'] })
  })

  it('waives only the age rule for board-decision and never applies it to issues', () => {
    const old = outside({ created_at: ago(200) })
    expect(classifyItem(old, { lastMaintainerActivity: ago(1) }, now)).toBeNull()
    expect(
      classifyItem(
        { ...old, pull_request: {}, labels: ['board-decision'] },
        {
          lastMaintainerActivity: ago(1),
        },
        now,
      ),
    ).toBeNull()
    expect(
      classifyItem({ ...old, pull_request: {}, labels: ['board-decision'] }, {}, now).rules,
    ).toEqual(['No maintainer response within 24h'])
  })

  it.each([
    { user: { login: 'BRUCHRIS', type: 'User' } },
    { user: { login: 'automation', type: 'Bot' } },
    { user: { login: 'renovate[bot]', type: 'User' } },
    { title: 'Maintainer SLA breach', user: { login: 'GitHub-Actions[BOT]', type: 'Bot' } },
    { state: 'closed' },
  ])('ignores maintainers, bots, the alarm, and closed items: %j', (overrides) => {
    expect(classifyItem(outside(overrides), {}, now)).toBeNull()
  })

  it('classifies a contributor issue with the alarm title as an ordinary outside item', () => {
    expect(classifyItem(outside({ title: 'Maintainer SLA breach' }), {}, now)).toMatchObject({
      kind: 'issue',
      rules: ['No maintainer response within 24h'],
    })
    expect(
      classifyItem(
        outside({ title: 'Maintainer SLA breach', user: { login: 'BRUCHRIS', type: 'User' } }),
        {},
        now,
      ),
    ).toBeNull()
  })

  it.each([25, 100, 14 * 24])(
    'accepted issues aged %sh with no maintainer activity wait for the accepted threshold',
    (hours) => {
      expect(
        classifyItem(
          outside({
            created_at: ago(hours),
            updated_at: ago(hours),
            labels: [{ name: 'AcCePtEd' }],
          }),
          {},
          now,
        ),
      ).toBeNull()
    },
  )

  it('uses only the accepted-issue threshold, measured from maintainer activity', () => {
    const accepted = outside({ created_at: ago(40 * 24), labels: ['ACCEPTED'] })
    expect(
      classifyItem(
        accepted,
        { lastMaintainerActivity: ago(14 * 24), lastAuthorActivity: ago(1) },
        now,
      ),
    ).toBeNull()
    expect(
      classifyItem(
        accepted,
        {
          lastMaintainerActivity: ago(14 * 24 + 1),
          lastAuthorActivity: ago(1),
          lastActivity: ago(1),
        },
        now,
      ).rules,
    ).toEqual(['No maintainer activity on accepted issue for 14 days'])
  })

  it('falls back to creation time when an accepted issue has no maintainer activity', () => {
    expect(
      classifyItem(outside({ created_at: ago(14 * 24 + 1), labels: ['accepted'] }), {}, now).rules,
    ).toEqual(['No maintainer activity on accepted issue for 14 days'])
  })

  it.each(['blocked-on-author', 'needs-info'])(
    'keeps the %s exemption for accepted issues',
    (label) => {
      expect(
        classifyItem(
          outside({
            created_at: ago(40 * 24),
            updated_at: ago(20 * 24),
            labels: ['accepted', label],
          }),
          { lastMaintainerActivity: ago(20 * 24) },
          now,
        ),
      ).toBeNull()
    },
  )

  it('keeps the normal inactivity rule for PRs even if labeled accepted', () => {
    expect(
      classifyItem(
        outside({
          pull_request: {},
          created_at: ago(100),
          updated_at: ago(80),
          labels: ['accepted'],
        }),
        { lastMaintainerActivity: ago(80), lastAuthorActivity: ago(100) },
        now,
      ).rules,
    ).toEqual(['No activity for 72h'])
  })

  it('honors the accepted-issue threshold override and rejects invalid settings', () => {
    const config = readConfig({ ACCEPTED_STALE_DAYS: '3' })
    expect(config.acceptedStaleDays).toBe(3)
    const accepted = outside({ created_at: ago(200), labels: ['accepted'] })
    expect(classifyItem(accepted, { lastMaintainerActivity: ago(73) }, now, config).rules).toEqual([
      'No maintainer activity on accepted issue for 3 days',
    ])
    expect(classifyItem(accepted, { lastMaintainerActivity: ago(72) }, now, config)).toBeNull()
    expect(readConfig({ ACCEPTED_STALE_DAYS: '-1' }).acceptedStaleDays).toBe(14)
    expect(readConfig({ ACCEPTED_STALE_DAYS: 'invalid' }).acceptedStaleDays).toBe(14)
  })

  it('handles release-please PRs separately with a fixed 24h threshold', () => {
    const release = outside({
      pull_request: {},
      title: 'chore(main): release 2.5.0',
      user: { login: 'github-actions[bot]', type: 'Bot' },
    })
    expect(
      classifyItem(release, { lastMaintainerActivity: ago(1) }, now, {
        firstResponseHours: 48,
      }),
    ).toMatchObject({ kind: 'release PR', rules: ['Release PR open more than 24h'] })
    expect(classifyItem({ ...release, created_at: ago(24) }, {}, now)).toBeNull()
    expect(classifyItem({ ...release, title: 'An unrelated bot PR' }, {}, now)).toBeNull()
  })

  it('honors custom maintainers and thresholds', () => {
    expect(
      readConfig({
        MAINTAINERS: 'Owner, other, OWNER',
        FIRST_RESPONSE_HOURS: '48',
        STALE_HOURS: '96',
        PR_AGE_DAYS: '10',
        ACCEPTED_STALE_DAYS: '21',
      }),
    ).toEqual({
      maintainers: ['owner', 'other'],
      firstResponseHours: 48,
      staleHours: 96,
      acceptedStaleDays: 21,
      prAgeDays: 10,
    })
    const config = readConfig({ FIRST_RESPONSE_HOURS: '48', STALE_HOURS: '96', PR_AGE_DAYS: '10' })
    expect(classifyItem(outside(), {}, now, config)).toBeNull()
    expect(
      classifyItem(
        outside({ pull_request: {}, created_at: ago(200) }),
        {
          lastMaintainerActivity: ago(80),
          lastAuthorActivity: ago(1),
        },
        now,
        config,
      ),
    ).toBeNull()
    expect(
      classifyItem(outside({ user: { login: 'OWNER', type: 'User' } }), {}, now, {
        maintainers: ['owner'],
      }),
    ).toBeNull()
    expect(
      readConfig({ FIRST_RESPONSE_HOURS: 'invalid', STALE_HOURS: '-1', MAINTAINERS: ',' }),
    ).toEqual({
      maintainers: ['bruchris'],
      firstResponseHours: 24,
      staleHours: 72,
      acceptedStaleDays: 14,
      prAgeDays: 7,
    })
  })
})

describe('collectActivity', () => {
  it('finds latest maintainer/author comments and any-person activity, including edits', () => {
    expect(
      collectActivity(outside(), {
        comments: [
          { user: { login: 'BruChris' }, created_at: ago(20), updated_at: ago(10) },
          { user: { login: 'contributor' }, created_at: ago(5) },
          { user: { login: 'someone-else' }, created_at: ago(0.5) },
        ],
      }),
    ).toEqual({
      lastMaintainerActivity: now - 10 * hour,
      lastAuthorActivity: now - 5 * hour,
      lastActivity: now - 0.5 * hour,
    })
  })

  it.each(['author', 'committer'])(
    'counts maintainer commit %s logins and author commits',
    (role) => {
      const activity = collectActivity(outside({ created_at: ago(100) }), {
        reviews: [{ user: { login: 'bruchris' }, submitted_at: ago(50) }],
        commits: [
          { [role]: { login: 'bruchris' }, commit: { committer: { date: ago(30) } } },
          { author: { login: 'contributor' }, commit: { author: { date: ago(20) } } },
        ],
      })
      expect(activity.lastMaintainerActivity).toBe(now - 30 * hour)
      expect(activity.lastAuthorActivity).toBe(now - 20 * hour)
    },
  )

  it('counts submitted maintainer reviews, but not pending reviews or email-only commit identities', () => {
    expect(
      collectActivity(outside(), {
        reviews: [
          { user: { login: 'bruchris' }, submitted_at: ago(10) },
          { user: { login: 'bruchris' }, submitted_at: null },
        ],
        commits: [
          { author: null, committer: null, commit: { author: { name: 'bruchris', date: ago(1) } } },
        ],
      }).lastMaintainerActivity,
    ).toBe(now - 10 * hour)
  })

  it('includes the selected maintainer timeline actions', () => {
    expect(
      collectActivity(outside(), {
        timeline: [
          { actor: { login: 'bruchris' }, event: 'labeled', created_at: ago(5) },
          { actor: { login: 'someone-else' }, event: 'assigned', created_at: ago(4) },
          { actor: { login: 'bruchris' }, event: 'unlabeled', created_at: ago(2) },
        ],
      }).lastMaintainerActivity,
    ).toBe(now - 5 * hour)
  })
})

describe('buildAlarmBody', () => {
  it('renders sorted links, kinds, authors, ages, activity, rules, and a stable number set', () => {
    const issue = classifyItem(outside(), {}, now)
    const pr = classifyItem(
      outside({ number: 7, pull_request: {}, created_at: ago(200) }),
      {
        lastMaintainerActivity: ago(1),
      },
      now,
    )
    const body = buildAlarmBody([issue, pr])
    expect(body).toContain(
      `| [#42](https://github.com/${repo}/issues/42) | issue | @contributor | 25h | none | No maintainer response within 24h |`,
    )
    expect(body).toContain(`| PR | @contributor | 8d | ${ago(1)} | PR open more than 7 days |`)
    expect(body.indexOf('[#7]')).toBeLessThan(body.indexOf('[#42]'))
    expect(body).toContain('<!-- maintainer-sla-items: 7,42 -->')
    expect(buildAlarmBody([pr, issue])).toBe(body)
  })
})

function fakeApi(items: unknown[]) {
  return {
    list: vi.fn(async (path: string) =>
      path.endsWith('/issues?state=open&per_page=100') ? items : [],
    ),
    request: vi.fn(
      async (
        _path: string,
        _options?: Record<string, unknown>,
      ): Promise<{ name: string } | null> => ({ name: 'sla-breach' }),
    ),
  }
}

describe('runAlarm with an in-memory API (no network)', () => {
  const breached = outside()
  const alarm = () =>
    outside({
      number: 100,
      title: 'Maintainer SLA breach',
      user: { login: 'GitHub-Actions[BOT]', type: 'Bot' },
      labels: [{ name: 'keep-label' }],
      body: buildAlarmBody([classifyItem(breached, {}, now)]),
    })

  it('skips detail calls for young items and ignores maintainers and bots', async () => {
    const api = fakeApi([
      outside({ created_at: ago(1) }),
      outside({ user: { login: 'bruchris' } }),
      outside({ user: { login: 'robot', type: 'Bot' } }),
    ])
    expect(await runAlarm({ repo, now, api })).toBe('0 maintainer SLA breach(es); no alarm needed.')
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(api.request).not.toHaveBeenCalled()
  })

  it('creates a missing label and assigns a new alarm to all maintainers', async () => {
    const api = fakeApi([breached])
    api.request.mockResolvedValueOnce(null)
    expect(await runAlarm({ repo, now, api })).toContain('alarm created')
    expect(api.request).toHaveBeenCalledWith(`/repos/${repo}/labels`, {
      method: 'POST',
      body: { name: 'sla-breach', color: 'b60205' },
    })
    expect(api.request).toHaveBeenCalledWith(`/repos/${repo}/issues`, {
      method: 'POST',
      body: {
        title: 'Maintainer SLA breach',
        labels: ['sla-breach'],
        assignees: ['bruchris'],
        body: buildAlarmBody([classifyItem(breached, {}, now)]),
      },
    })
  })

  it('updates the alarm without commenting for an unchanged set, preserving other labels', async () => {
    const api = fakeApi([breached, alarm()])
    expect(await runAlarm({ repo, now, api })).toContain('alarm updated')
    expect(api.request.mock.calls.some(([path]) => path.endsWith('/comments'))).toBe(false)
    expect(api.request).toHaveBeenCalledWith(`/repos/${repo}/issues/100`, {
      method: 'PATCH',
      body: expect.objectContaining({
        labels: ['keep-label', 'sla-breach'],
        assignees: ['bruchris'],
      }),
    })
  })

  it('adds exactly one owner mention when the breaching number set changes', async () => {
    const api = fakeApi([outside({ number: 43 }), alarm()])
    await runAlarm({ repo, now, api })
    const comments = api.request.mock.calls.filter(([path]) => path.endsWith('/comments'))
    expect(comments).toHaveLength(1)
    expect(comments[0][1]).toEqual({
      method: 'POST',
      body: { body: '@bruchris The set of breaching items changed: #43.' },
    })
  })

  it('creates a genuine alarm instead of updating a contributor issue with the same title', async () => {
    const spoof = outside({ number: 13, title: 'Maintainer SLA breach' })
    const api = fakeApi([spoof])
    expect(await runAlarm({ repo, now, api })).toBe('1 maintainer SLA breach(es); alarm created.')
    expect(api.request).toHaveBeenCalledWith(`/repos/${repo}/issues`, {
      method: 'POST',
      body: expect.objectContaining({
        title: 'Maintainer SLA breach',
        body: buildAlarmBody([classifyItem(spoof, {}, now)]),
      }),
    })
    expect(api.request.mock.calls.some(([path]) => path.includes('/issues/13'))).toBe(false)
  })

  it('does not edit or close a maintainer issue that shares the alarm title', async () => {
    const api = fakeApi([
      outside({ title: 'Maintainer SLA breach', user: { login: 'bruchris', type: 'User' } }),
    ])
    expect(await runAlarm({ repo, now, api })).toBe('0 maintainer SLA breach(es); no alarm needed.')
    expect(api.request).not.toHaveBeenCalled()
  })

  it('finds the genuine bot alarm even when a contributor issue with the same title comes first', async () => {
    const api = fakeApi([outside({ number: 13, title: 'Maintainer SLA breach' }), alarm()])
    expect(await runAlarm({ repo, now, api })).toBe('1 maintainer SLA breach(es); alarm updated.')
    expect(api.request).toHaveBeenCalledWith(`/repos/${repo}/issues/100`, {
      method: 'PATCH',
      body: expect.objectContaining({
        body: expect.stringContaining('<!-- maintainer-sla-items: 13 -->'),
      }),
    })
    expect(api.request.mock.calls.some(([path]) => path.includes('/issues/13'))).toBe(false)
  })

  it('comments All clear. and closes the open alarm when no items breach', async () => {
    const api = fakeApi([alarm()])
    expect(await runAlarm({ repo, now, api })).toContain('alarm closed')
    expect(api.request.mock.calls).toEqual([
      [`/repos/${repo}/issues/100/comments`, { method: 'POST', body: { body: 'All clear.' } }],
      [`/repos/${repo}/issues/100`, { method: 'PATCH', body: { state: 'closed' } }],
    ])
  })
})

describe('GitHub REST pagination and errors with mocked fetch', () => {
  it('follows next links and authenticates every page', async () => {
    const next = `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=2`
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([outside()], {
          headers: { link: `<${next}>; rel="next"` },
        }),
      )
      .mockResolvedValueOnce(Response.json([outside({ number: 43 })]))
    const api = createGitHubClient('test-token', fetchImpl)
    expect(await api.list(`/repos/${repo}/issues?state=open&per_page=100`)).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenLastCalledWith(
      next,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          Accept: 'application/vnd.github+json',
        }),
      }),
    )
  })

  it('rejects API failures instead of treating a partial scan as all clear', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    await expect(
      createGitHubClient('test-token', fetchImpl).list(`/repos/${repo}/issues`),
    ).rejects.toThrow('HTTP 403')
  })
})
