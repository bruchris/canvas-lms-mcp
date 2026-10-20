import { pathToFileURL } from 'node:url'

const HOUR = 60 * 60 * 1000
const TITLE = 'Maintainer SLA breach'
const LABEL = 'sla-breach'
const MAINTAINERS = ['bruchris']
export const DEFAULT_CONFIG = {
  maintainers: MAINTAINERS,
  firstResponseHours: 24,
  staleHours: 72,
  acceptedStaleDays: 14,
  prAgeDays: 7,
}

const MAINTAINER_EVENTS = new Set([
  'labeled',
  'assigned',
  'closed',
  'reopened',
  'merged',
  'head_ref_force_pushed',
  'review_requested',
])

function time(value) {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function latest(...values) {
  const dates = values.map(time).filter((value) => value !== null)
  return dates.length ? Math.max(...dates) : null
}

function isMaintainer(user, maintainers) {
  return maintainers.some((login) => login.toLowerCase() === user?.login?.toLowerCase())
}

function isRelease(item) {
  return (
    Boolean(item.pull_request) &&
    item.user?.login?.toLowerCase() === 'github-actions[bot]' &&
    item.title.startsWith('chore(main): release')
  )
}

function isAlarm(item) {
  return (
    !item.pull_request &&
    item.title === TITLE &&
    item.user?.login?.toLowerCase() === 'github-actions[bot]'
  )
}

function isOutside(item, maintainers) {
  return (
    !isAlarm(item) &&
    !isMaintainer(item.user, maintainers) &&
    item.user?.type !== 'Bot' &&
    !item.user?.login?.toLowerCase().endsWith('[bot]')
  )
}

export function readConfig(env = process.env) {
  const number = (value, fallback) => {
    const parsed = Number(value)
    return value?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  const maintainers = env.MAINTAINERS?.split(',')
    .map((login) => login.trim())
    .filter(Boolean)
  return {
    maintainers: maintainers?.length
      ? [...new Set(maintainers.map((s) => s.toLowerCase()))]
      : MAINTAINERS,
    firstResponseHours: number(env.FIRST_RESPONSE_HOURS, 24),
    staleHours: number(env.STALE_HOURS, 72),
    acceptedStaleDays: number(env.ACCEPTED_STALE_DAYS, 14),
    prAgeDays: number(env.PR_AGE_DAYS, 7),
  }
}

export function collectActivity(
  item,
  { comments = [], reviews = [], commits = [], timeline = [] } = {},
  maintainers = MAINTAINERS,
) {
  let lastMaintainerActivity = null
  let lastAuthorActivity = time(item.created_at)
  let lastActivity = latest(item.created_at, item.updated_at)
  const record = (user, date, countsAsMaintainer = true) => {
    lastActivity = latest(lastActivity, date)
    if (countsAsMaintainer && isMaintainer(user, maintainers)) {
      lastMaintainerActivity = latest(lastMaintainerActivity, date)
    }
    if (user?.login?.toLowerCase() === item.user?.login?.toLowerCase()) {
      lastAuthorActivity = latest(lastAuthorActivity, date)
    }
  }
  for (const comment of comments)
    record(comment.user, latest(comment.created_at, comment.updated_at))
  for (const review of reviews) record(review.user, review.submitted_at)
  for (const commit of commits) {
    const date = latest(commit.commit?.author?.date, commit.commit?.committer?.date)
    record(commit.author, date)
    record(commit.committer, date)
  }
  for (const event of timeline) {
    lastActivity = latest(lastActivity, event.created_at)
    if (MAINTAINER_EVENTS.has(event.event) && isMaintainer(event.actor, maintainers)) {
      lastMaintainerActivity = latest(lastMaintainerActivity, event.created_at)
    }
  }
  return { lastMaintainerActivity, lastAuthorActivity, lastActivity }
}

export function classifyItem(item, activity = {}, now = Date.now(), options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options }
  if (item.state !== 'open' || isAlarm(item)) return null
  const release = isRelease(item)
  if (!release && !isOutside(item, config.maintainers)) return null
  const ageHours = (time(now) - time(item.created_at)) / HOUR
  const lastMaintainerActivity = time(activity.lastMaintainerActivity)
  const lastAuthorActivity = time(activity.lastAuthorActivity) ?? time(item.created_at)
  const lastActivity = latest(
    item.created_at,
    item.updated_at,
    activity.lastActivity,
    lastMaintainerActivity,
    lastAuthorActivity,
  )
  const labels = new Set(
    (item.labels ?? []).map((label) =>
      (typeof label === 'string' ? label : label.name).toLowerCase(),
    ),
  )
  const rules = []
  if (release) {
    if (ageHours > 24) rules.push('Release PR open more than 24h')
  } else if (!item.pull_request && labels.has('accepted')) {
    if (
      time(now) - (lastMaintainerActivity ?? time(item.created_at)) >
        config.acceptedStaleDays * 24 * HOUR &&
      !labels.has('blocked-on-author') &&
      !labels.has('needs-info')
    ) {
      rules.push(`No maintainer activity on accepted issue for ${config.acceptedStaleDays} days`)
    }
  } else {
    if (ageHours > config.firstResponseHours && lastMaintainerActivity === null) {
      rules.push(`No maintainer response within ${config.firstResponseHours}h`)
    }
    if (
      lastMaintainerActivity !== null &&
      lastAuthorActivity > lastMaintainerActivity &&
      time(now) - lastMaintainerActivity > config.staleHours * HOUR
    ) {
      rules.push(`Author awaiting maintainer action for ${config.staleHours}h`)
    }
    if (
      time(now) - lastActivity > config.staleHours * HOUR &&
      !labels.has('blocked-on-author') &&
      !labels.has('needs-info')
    ) {
      rules.push(`No activity for ${config.staleHours}h`)
    }
    if (item.pull_request && ageHours > config.prAgeDays * 24 && !labels.has('board-decision')) {
      rules.push(`PR open more than ${config.prAgeDays} days`)
    }
  }
  if (!rules.length) return null
  return {
    number: item.number,
    url: item.html_url,
    kind: release ? 'release PR' : item.pull_request ? 'PR' : 'issue',
    author: item.user.login,
    ageHours,
    lastMaintainerActivity,
    rules,
  }
}

function breachNumbers(breaches) {
  return [...new Set(breaches.map(({ number }) => number))].sort((a, b) => a - b).join(',')
}

export function buildAlarmBody(breaches) {
  const cell = (value) =>
    String(value)
      .replaceAll('|', '\\|')
      .replace(/[\r\n]+/g, ' ')
  const rows = [...breaches]
    .sort((a, b) => a.number - b.number)
    .map((breach) => {
      const age =
        breach.ageHours < 48
          ? `${Math.floor(breach.ageHours)}h`
          : `${Math.floor(breach.ageHours / 24)}d`
      const last =
        breach.lastMaintainerActivity === null
          ? 'none'
          : new Date(breach.lastMaintainerActivity).toISOString()
      return `| [#${breach.number}](${breach.url}) | ${breach.kind} | @${cell(breach.author)} | ${age} | ${last} | ${cell(breach.rules.join('; '))} |`
    })
  return [
    'The following open contributions need maintainer attention.',
    '',
    '| Item | Kind | Author | Age | Last maintainer activity | Rule breached |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `<!-- maintainer-sla-items: ${breachNumbers(breaches)} -->`,
  ].join('\n')
}

export function createGitHubClient(token, fetchImpl = fetch) {
  async function request(path, { method = 'GET', body, allowNotFound = false } = {}) {
    const url = new URL(path, 'https://api.github.com')
    if (url.origin !== 'https://api.github.com')
      throw new Error('Invalid GitHub API pagination URL')
    const response = await fetchImpl(url.href, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    })
    if (allowNotFound && response.status === 404) return null
    if (!response.ok)
      throw new Error(`GitHub API ${method} ${url.pathname}: HTTP ${response.status}`)
    if (response.status === 204) return { data: null, next: null }
    return {
      data: await response.json(),
      next: /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null,
    }
  }
  return {
    async request(path, options) {
      const result = await request(path, options)
      return result?.data ?? null
    },
    async list(path) {
      const items = []
      const seen = new Set()
      let next = path
      while (next) {
        if (seen.has(next)) throw new Error('GitHub API repeated a pagination link')
        seen.add(next)
        const page = await request(next)
        if (!Array.isArray(page.data)) throw new Error('GitHub API list response is not an array')
        items.push(...page.data)
        next = page.next
      }
      return items
    },
  }
}

export async function runAlarm({
  repo = process.env.REPO,
  config = readConfig(),
  now = Date.now(),
  api = createGitHubClient(process.env.GITHUB_TOKEN),
} = {}) {
  const base = `/repos/${repo}`
  const items = await api.list(`${base}/issues?state=open&per_page=100`)
  const alarm = items.find(isAlarm)
  const breaches = []
  for (const item of items) {
    if (isAlarm(item) || (!isRelease(item) && !isOutside(item, config.maintainers))) continue
    let activity = {}
    // Young items cannot breach first-response/staleness defaults; avoid detail calls.
    if (time(now) - time(item.created_at) > config.firstResponseHours * HOUR) {
      const comments = await api.list(`${base}/issues/${item.number}/comments?per_page=100`)
      const timeline = await api.list(`${base}/issues/${item.number}/timeline?per_page=100`)
      const reviews = item.pull_request
        ? await api.list(`${base}/pulls/${item.number}/reviews?per_page=100`)
        : []
      const commits = item.pull_request
        ? await api.list(`${base}/pulls/${item.number}/commits?per_page=100`)
        : []
      activity = collectActivity(item, { comments, timeline, reviews, commits }, config.maintainers)
    }
    const breach = classifyItem(item, activity, now, config)
    if (breach) breaches.push(breach)
  }
  let action = 'no alarm needed'
  if (breaches.length) {
    if (!(await api.request(`${base}/labels/${LABEL}`, { allowNotFound: true }))) {
      await api.request(`${base}/labels`, {
        method: 'POST',
        body: { name: LABEL, color: 'b60205' },
      })
    }
    const body = buildAlarmBody(breaches)
    if (!alarm) {
      await api.request(`${base}/issues`, {
        method: 'POST',
        body: { title: TITLE, body, labels: [LABEL], assignees: config.maintainers },
      })
      action = 'alarm created'
    } else {
      const oldNumbers = /<!-- maintainer-sla-items: ([\d,]*) -->/.exec(alarm.body ?? '')?.[1] ?? ''
      if (oldNumbers !== breachNumbers(breaches)) {
        const mentions = [
          ...new Set(['bruchris', ...config.maintainers].map((s) => s.toLowerCase())),
        ]
          .map((login) => `@${login}`)
          .join(' ')
        await api.request(`${base}/issues/${alarm.number}/comments`, {
          method: 'POST',
          body: {
            body: `${mentions} The set of breaching items changed: ${breaches.map((b) => `#${b.number}`).join(', ')}.`,
          },
        })
      }
      await api.request(`${base}/issues/${alarm.number}`, {
        method: 'PATCH',
        body: {
          body,
          assignees: config.maintainers,
          labels: [
            ...new Set([
              ...(alarm.labels ?? []).map((label) =>
                typeof label === 'string' ? label : label.name,
              ),
              LABEL,
            ]),
          ],
        },
      })
      action = 'alarm updated'
    }
  } else if (alarm) {
    await api.request(`${base}/issues/${alarm.number}/comments`, {
      method: 'POST',
      body: { body: 'All clear.' },
    })
    await api.request(`${base}/issues/${alarm.number}`, {
      method: 'PATCH',
      body: { state: 'closed' },
    })
    action = 'alarm closed'
  }
  return `${breaches.length} maintainer SLA breach(es); ${action}.`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAlarm()
    .then((summary) => console.log(summary))
    .catch((error) => {
      console.error(`Maintainer SLA alarm failed: ${error.message}`)
      process.exitCode = 1
    })
}
