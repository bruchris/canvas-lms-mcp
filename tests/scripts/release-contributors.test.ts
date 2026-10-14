import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain .mjs with no declarations; tests are not type-checked by tsc
import {
  extractPullNumbers,
  fetchPullAuthors,
  buildContributorsSection,
  upsertContributorsSection,
  collectContributorsSection,
} from '../../scripts/release-contributors.mjs'

const repo = 'bruchris/canvas-lms-mcp'
const releaseBody = `### Features
* **rubrics:** add attach_rubric and delete_rubric ([#370](https://github.com/bruchris/canvas-lms-mcp/issues/370)) ([1624ffa](https://github.com/bruchris/canvas-lms-mcp/commit/1624ffa733e158aebc53ab38368f2c465d47e36e))
### Bug Fixes
* **rubrics:** expose rubric assignment associations on get_rubric ([#327](https://github.com/bruchris/canvas-lms-mcp/issues/327)) ([81b7da8](https://github.com/bruchris/canvas-lms-mcp/commit/81b7da869bddea3354376ba9a76790f387dc68b3))`
const genericSection = '## 👥 Contributors\n\nThanks to everyone who contributed to this release!'
const changelog = `**Full Changelog**: [v2.3.0...v2.4.0](https://github.com/${repo}/compare/v2.3.0...v2.4.0)`

afterEach(() => vi.restoreAllMocks())

describe('extractPullNumbers', () => {
  it('extracts and sorts PR numbers from the real release-please 2.4.0 notes', () => {
    expect(extractPullNumbers(releaseBody)).toEqual([327, 370])
  })

  it('deduplicates issues and pull links, ignoring bare references and other URLs', () => {
    expect(
      extractPullNumbers(`${releaseBody}
See #1, [#2], and ([#370](https://github.com/${repo}/pull/370)).
Fix ([#308](https://github.com/${repo}/pull/308)).
Ignore [#3](https://example.com/${repo}/issues/3),
[#4](https://github.com/${repo}/commit/4), and
[#5](https://github.com/${repo}/issues/6).`),
    ).toEqual([308, 327, 370])
    expect(extractPullNumbers('')).toEqual([])
  })
})

describe('buildContributorsSection', () => {
  it('excludes maintainers case-insensitively and bots by type or login suffix', () => {
    const authors = [
      { number: 1, login: 'BruChris', type: 'User' },
      { number: 2, login: 'other-maintainer', type: 'User' },
      { number: 3, login: 'automation', type: 'Bot' },
      { number: 4, login: 'dependabot[bot]', type: 'User' },
      { number: 308, login: 'roowus', type: 'User' },
    ]
    expect(
      buildContributorsSection(authors, { repo, maintainers: ['bruchris', 'OTHER-MAINTAINER'] }),
    ).toBe(
      `## 👥 Contributors\n\nThanks to the community contributors in this release:\n\n- @roowus ([#308](https://github.com/${repo}/pull/308))`,
    )
  })

  it('groups and deduplicates PRs and sorts logins case-insensitively and numbers ascending', () => {
    expect(
      buildContributorsSection(
        [
          { number: 308, login: 'roowus', type: 'User' },
          { number: 371, login: 'algorithm0r', type: 'User' },
          { number: 327, login: 'Chiptoe-svg', type: 'User' },
          { number: 368, login: 'algorithm0r', type: 'User' },
          { number: 371, login: 'ALGORITHM0R', type: 'User' },
        ],
        { repo, maintainers: [] },
      ),
    ).toBe(
      `## 👥 Contributors\n\nThanks to the community contributors in this release:\n\n- @algorithm0r ([#368](https://github.com/${repo}/pull/368), [#371](https://github.com/${repo}/pull/371))\n- @Chiptoe-svg ([#327](https://github.com/${repo}/pull/327))\n- @roowus ([#308](https://github.com/${repo}/pull/308))`,
    )
  })

  it('uses the generic thanks when no community contributors remain', () => {
    expect(buildContributorsSection([], { repo, maintainers: [] })).toBe(genericSection)
    expect(buildContributorsSection([{ number: 370, login: 'bruchris', type: 'User' }])).toBe(
      genericSection,
    )
  })
})

describe('upsertContributorsSection', () => {
  it.each(['## 👥 Contributors', '## Contributors'])(
    'replaces %s and its body, preserving the next level-two section',
    (heading) => {
      const notes = `Opening.\n\n\n${heading}\n\nOld thanks.\n- @old\n\n\n## Details\n\nKeep this.`
      expect(upsertContributorsSection(notes, genericSection)).toBe(
        `Opening.\n\n${genericSection}\n\n## Details\n\nKeep this.`,
      )
    },
  )

  it.each([`---\n\n${changelog}`, changelog])(
    'replaces an existing section without consuming the footer: %s',
    (footer) => {
      const notes = `Opening.\n\n## 👥 Contributors\n\nOld thanks.\n\n${footer}`
      expect(upsertContributorsSection(notes, genericSection)).toBe(
        `Opening.\n\n${genericSection}\n\n${footer}`,
      )
    },
  )

  it('inserts before the last separator preceding Full Changelog', () => {
    const notes = `Opening.\n\n---\n\nDetails.\n\n---\n\n${changelog}`
    expect(upsertContributorsSection(notes, genericSection)).toBe(
      `Opening.\n\n---\n\nDetails.\n\n${genericSection}\n\n---\n\n${changelog}`,
    )
  })

  it('inserts immediately before Full Changelog without a separator', () => {
    expect(upsertContributorsSection(`Opening.\n\n\n${changelog}`, genericSection)).toBe(
      `Opening.\n\n${genericSection}\n\n${changelog}`,
    )
  })

  it('appends when there is no Full Changelog, including empty notes', () => {
    expect(upsertContributorsSection('Opening.\n\n\n', genericSection)).toBe(
      `Opening.\n\n${genericSection}`,
    )
    expect(upsertContributorsSection('', genericSection)).toBe(genericSection)
  })

  it.each([
    'Opening.',
    '',
    `Opening.\n\n${changelog}`,
    `Opening.\n\n---\n\n${changelog}`,
    `Opening.\n\n## Contributors\n\nOld thanks.\n\n## Details\n\nKeep this.`,
    `## 👥 Contributors\n\nOld thanks.\n\n---\n\n${changelog}`,
  ])('is idempotent for %s', (notes) => {
    const once = upsertContributorsSection(notes, genericSection)
    expect(upsertContributorsSection(once, genericSection)).toBe(once)
  })
})

describe('fetchPullAuthors', () => {
  it('uses GitHub headers and skips a failed PR while continuing to subsequent authors', async () => {
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/368')) return new Response('', { status: 403 })
      return Response.json({ user: { login: 'algorithm0r', type: 'User' } })
    })
    expect(
      await fetchPullAuthors([367, 368, 371], { repo, token: 'test-token', fetchImpl }),
    ).toEqual([
      { number: 367, login: 'algorithm0r', type: 'User' },
      { number: 371, login: 'algorithm0r', type: 'User' },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/${repo}/pulls/367`,
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer test-token' },
      }),
    )
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('PR #368'))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('403'))
  })

  it('tries unauthenticated and skips network, JSON, and missing-author failures', async () => {
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/1')) throw new Error('Network unavailable')
      if (url.endsWith('/2')) return new Response('invalid JSON')
      if (url.endsWith('/3')) return Response.json({ user: null })
      return Response.json({ user: { login: 'roowus', type: 'User' } })
    })
    expect(await fetchPullAuthors([1, 2, 3, 308], { repo, fetchImpl })).toEqual([
      { number: 308, login: 'roowus', type: 'User' },
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/${repo}/pulls/308`,
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }),
    )
    expect(warning).toHaveBeenCalledTimes(3)
  })
})

describe('collectContributorsSection', () => {
  it('extracts links, fetches authors, and reports external attribution', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ user: { login: 'algorithm0r', type: 'User' } }),
    )
    const result = await collectContributorsSection(releaseBody, { repo, fetchImpl })
    expect(result.external).toBe(true)
    expect(result.section).toBe(
      buildContributorsSection([
        { number: 327, login: 'algorithm0r', type: 'User' },
        { number: 370, login: 'algorithm0r', type: 'User' },
      ]),
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    { login: 'BruChris', type: 'User' },
    { login: 'automation', type: 'Bot' },
  ])('reports no external author for $login', async (user) => {
    expect(
      await collectContributorsSection(releaseBody, {
        fetchImpl: async () => Response.json({ user }),
      }),
    ).toEqual({ section: genericSection, external: false })
  })

  it('does not fetch when no PR links are present', async () => {
    const fetchImpl = vi.fn()
    expect(await collectContributorsSection('No PRs.', { fetchImpl })).toEqual({
      section: genericSection,
      external: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// Run the actual entry point in an isolated worker with fetch replaced before import.
// This checks skip/failure fallbacks without making any network requests.
function runEnrichment(
  env: Record<string, string> = {},
  { login = 'algorithm0r', aiFails = false, githubFails = false } = {},
) {
  const enriched = `Opening.\n\n${releaseBody}\n\n## Contributors\n\nAI attribution.\n\n---\n\n${changelog}`
  const code = `
    globalThis.fetch = async (url, options) => {
      if (url.startsWith('https://api.github.com/')) {
        if (${githubFails}) throw new Error('GitHub unavailable');
        return Response.json({ user: { login: ${JSON.stringify(login)}, type: 'User' } });
      }
      if (${aiFails}) return new Response('Unavailable', { status: 503 });
      const prompt = JSON.parse(options.body).messages[0].content;
      if (!prompt.includes('Do NOT write a Contributors section')) throw new Error('Wrong prompt');
      return Response.json({ stop_reason: 'end_turn', content: [{ text: ${JSON.stringify(enriched)} }] });
    };
    import('./scripts/enrich-release-notes.mjs');
  `
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const worker = new Worker(code, {
      eval: true,
      stdout: true,
      stderr: true,
      env: {
        ...process.env,
        RELEASE_BODY: releaseBody,
        ANTHROPIC_API_KEY: '',
        SKIP_AI_RELEASE_NOTES: '',
        RELEASE_NOTES_MAINTAINERS: 'bruchris',
        GITHUB_REPOSITORY: repo,
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    worker.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    worker.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    worker.on('error', reject)
    worker.on('exit', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('enrich-release-notes entry point', () => {
  it.each([
    { env: {}, aiFails: false, warning: 'ANTHROPIC_API_KEY is not set' },
    {
      env: { SKIP_AI_RELEASE_NOTES: 'true' },
      aiFails: false,
      warning: 'SKIP_AI_RELEASE_NOTES is set',
    },
    {
      env: { ANTHROPIC_API_KEY: 'test-key' },
      aiFails: true,
      warning: 'Anthropic API returned 503',
    },
  ])(
    'credits external authors when AI is unavailable: $warning',
    async ({ env, aiFails, warning }) => {
      const result = await runEnrichment(env, { aiFails })
      expect(result.status).toBe(0)
      expect(result.stderr).toContain(warning)
      expect(result.stdout).toBe(
        upsertContributorsSection(
          releaseBody,
          buildContributorsSection([
            { number: 327, login: 'algorithm0r', type: 'User' },
            { number: 370, login: 'algorithm0r', type: 'User' },
          ]),
        ),
      )
    },
  )

  it('replaces AI attribution with the deterministic section', async () => {
    const result = await runEnrichment({ ANTHROPIC_API_KEY: 'test-key' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Opening.')
    expect(result.stdout).toContain('- @algorithm0r')
    expect(result.stdout).not.toContain('AI attribution')
    expect(result.stdout.match(/## 👥 Contributors/g)).toHaveLength(1)
    expect(result.stdout).toContain(changelog)
  })

  it('reads case-insensitive comma-separated maintainers from the environment', async () => {
    const result = await runEnrichment({ RELEASE_NOTES_MAINTAINERS: ' bruchris, ALGORITHM0R ' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints nothing when skipped AI has only maintainer contributions', async () => {
    const result = await runEnrichment({}, { login: 'bruchris' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints nothing and exits zero when both APIs fail', async () => {
    const result = await runEnrichment(
      { ANTHROPIC_API_KEY: 'test-key' },
      { aiFails: true, githubFails: true },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('GitHub unavailable')
  })

  it('keeps successful AI notes with generic thanks when GitHub fails', async () => {
    const result = await runEnrichment({ ANTHROPIC_API_KEY: 'test-key' }, { githubFails: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(genericSection)
    expect(result.stdout).toContain(changelog)
  })

  it.each(['', ' \n\t '])(
    'prints nothing and exits zero for empty RELEASE_BODY %j',
    async (body) => {
      const result = await runEnrichment({ RELEASE_BODY: body, ANTHROPIC_API_KEY: 'test-key' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('RELEASE_BODY is empty')
    },
  )
})
