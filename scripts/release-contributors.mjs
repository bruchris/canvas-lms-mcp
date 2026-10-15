/** Deterministic community attribution from release-please's PR links. */

const DEFAULT_REPO = 'bruchris/canvas-lms-mcp'
const DEFAULT_MAINTAINERS = ['bruchris']

export function extractPullNumbers(body) {
  const links = body.matchAll(
    /\[#(\d+)\]\(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\1\)/g,
  )
  return [...new Set(Array.from(links, (match) => Number(match[1])))].sort((a, b) => a - b)
}

export async function fetchPullAuthors(
  numbers,
  { repo = DEFAULT_REPO, token, fetchImpl = fetch } = {},
) {
  const headers = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const authors = []
  for (const number of numbers) {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${number}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`)
      const { user } = await response.json()
      if (typeof user?.login !== 'string' || !user.login) {
        throw new Error('GitHub API response has no author login')
      }
      authors.push({ number, login: user.login, type: user.type })
    } catch (err) {
      process.stderr.write(
        `[release-contributors] Failed to fetch PR #${number}: ${err?.message ?? String(err)}\n`,
      )
    }
  }
  return authors
}

function communityAuthors(authors, maintainers) {
  const excluded = new Set(maintainers.map((login) => login.toLowerCase()))
  return authors.filter(
    ({ login, type }) =>
      !excluded.has(login.toLowerCase()) &&
      type !== 'Bot' &&
      !login.toLowerCase().endsWith('[bot]'),
  )
}

export function buildContributorsSection(
  authors,
  { repo = DEFAULT_REPO, maintainers = DEFAULT_MAINTAINERS } = {},
) {
  const grouped = new Map()
  for (const { number, login } of communityAuthors(authors, maintainers)) {
    const key = login.toLowerCase()
    if (!grouped.has(key)) grouped.set(key, { login, numbers: new Set() })
    grouped.get(key).numbers.add(number)
  }

  const heading = '## 👥 Contributors'
  if (!grouped.size) return `${heading}\n\nThanks to everyone who contributed to this release!`

  const entries = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { login, numbers }]) => {
      const links = [...numbers]
        .sort((a, b) => a - b)
        .map((number) => `[#${number}](https://github.com/${repo}/pull/${number})`)
      return `- @${login} (${links.join(', ')})`
    })
  return `${heading}\n\nThanks to the community contributors in this release:\n\n${entries.join('\n')}`
}

export function upsertContributorsSection(notes, section) {
  const lines = notes.split(/\r?\n/)
  const start = lines.findIndex((line) => /^## (?:👥 )?Contributors[ \t]*$/.test(line))
  let insertAt = start
  let end = start

  if (start !== -1) {
    end = start + 1
    while (
      end < lines.length &&
      !lines[end].startsWith('## ') &&
      lines[end] !== '---' &&
      !lines[end].startsWith('**Full Changelog')
    ) {
      end++
    }
  } else {
    const changelog = lines.findIndex((line) => line.startsWith('**Full Changelog'))
    insertAt = changelog === -1 ? lines.length : changelog
    if (changelog !== -1) {
      for (let i = changelog - 1; i >= 0; i--) {
        if (lines[i] === '---') {
          insertAt = i
          break
        }
      }
    }
    end = insertAt
  }

  const before = lines.slice(0, insertAt).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').trimStart()
  return [before, section.trim(), after].filter(Boolean).join('\n\n')
}

export async function collectContributorsSection(
  body,
  { repo = DEFAULT_REPO, token, maintainers = DEFAULT_MAINTAINERS, fetchImpl = fetch } = {},
) {
  const authors = await fetchPullAuthors(extractPullNumbers(body), { repo, token, fetchImpl })
  return {
    section: buildContributorsSection(authors, { repo, maintainers }),
    external: communityAuthors(authors, maintainers).length > 0,
  }
}
