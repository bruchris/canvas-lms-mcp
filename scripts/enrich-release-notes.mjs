#!/usr/bin/env node
/**
 * enrich-release-notes.mjs
 *
 * Calls Claude Sonnet to enrich release-please-generated notes in a
 * HeroUI-style voice, then prints the result to stdout.
 *
 * Environment variables:
 *   RELEASE_BODY        — raw release notes markdown (required)
 *   VERSION_TAG         — release version tag, e.g. "canvas-lms-mcp-v1.3.0"
 *   ANTHROPIC_API_KEY   — Anthropic API key (if absent, skips AI with warning)
 *   SKIP_AI_RELEASE_NOTES — set to "true" to skip AI enrichment
 *   RELEASE_NOTES_MAINTAINERS — comma-separated logins (default: bruchris)
 *   GITHUB_REPOSITORY   — owner/repo (default: bruchris/canvas-lms-mcp)
 *   GH_TOKEN / GITHUB_TOKEN — optional token for PR author lookup
 */

import { collectContributorsSection, upsertContributorsSection } from './release-contributors.mjs'

const {
  ANTHROPIC_API_KEY,
  RELEASE_BODY,
  VERSION_TAG = 'unknown',
  SKIP_AI_RELEASE_NOTES,
} = process.env

async function enrichReleaseNotes() {
  if (SKIP_AI_RELEASE_NOTES === 'true') {
    process.stderr.write(
      '[enrich-release-notes] SKIP_AI_RELEASE_NOTES is set — skipping enrichment.\n',
    )
    return null
  }

  if (!ANTHROPIC_API_KEY) {
    process.stderr.write(
      '[enrich-release-notes] ANTHROPIC_API_KEY is not set — skipping enrichment.\n',
    )
    return null
  }

  if (!RELEASE_BODY || !RELEASE_BODY.trim()) {
    process.stderr.write('[enrich-release-notes] RELEASE_BODY is empty — nothing to enrich.\n')
    return null
  }

  const SYSTEM_PROMPT = `You are a developer-experience writer producing GitHub release notes for canvas-lms-mcp, a Model Context Protocol (MCP) server that connects Canvas LMS to LLM clients such as Claude Desktop, Cursor, and ChatGPT. Your audience is developers building integrations between Canvas LMS and AI tools — NOT Canvas LMS instructors or students.

Rules you MUST follow:
- Do NOT invent features, fixes, or improvements not present in the raw notes
- Do NOT remove PR links, commit links, or other attribution
- Do NOT change version numbers, dates, or factual details
- Output markdown only — no preamble, no explanation, no code fences wrapping the entire output`

  const USER_PROMPT = `Rewrite the following raw release-please changelog for ${VERSION_TAG} into engaging, scannable release notes.

Required structure (omit any section that has no entries from the raw notes):

1. **Opening paragraph** (no heading): 2-3 sentences. Lead with developer/integrator impact — how this release improves the experience of someone building with this MCP server. Mention the 1-2 most significant changes and why they matter.

2. **## ✨ Highlights** — 3-5 bullets of the most impactful changes. Each bullet: emoji prefix, **bold lead-in**, one sentence explaining *why it matters* to integrators. End each bullet with the PR link (#NNN).

3. **Emoji-prefixed detail sections** (include all entries from the raw notes; add brief context where non-obvious; omit sections with no entries):
   - ## 🚀 New Features
   - ## 🎨 Improvements
   - ## 🐛 Bug Fixes
   - ## ⚡ Performance
   - ## 🔧 Code Refactoring
   - ## 🧪 Tests
   - ## 🚢 CI & Release Pipeline
   - ## 📚 Documentation
   - ## ⏪ Reverts

4. Do NOT write a Contributors section — the script adds it separately using GitHub PR authors.

5. **Full Changelog** — preserve the compare URL link verbatim if release-please included it; otherwise omit this section.

Raw release notes:

---
${RELEASE_BODY}
---`

  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: USER_PROMPT }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    process.stderr.write(
      `[enrich-release-notes] Network error calling Anthropic API: ${err?.message ?? String(err)}\n`,
    )
    return null
  }

  if (!response.ok) {
    const text = await response.text().catch((e) => {
      process.stderr.write(
        `[enrich-release-notes] Failed to read error body: ${e?.message ?? String(e)}\n`,
      )
      return ''
    })
    process.stderr.write(
      `[enrich-release-notes] Anthropic API returned ${response.status}: ${text}\n`,
    )
    return null
  }

  let data
  try {
    data = await response.json()
  } catch (err) {
    process.stderr.write(
      `[enrich-release-notes] Failed to parse Anthropic API response: ${err.message}\n`,
    )
    return null
  }

  if (data?.stop_reason !== 'end_turn') {
    process.stderr.write(
      `[enrich-release-notes] Unexpected stop_reason "${data?.stop_reason}" — skipping.\n`,
    )
    return null
  }

  const enriched = data?.content?.[0]?.text
  if (!enriched) {
    process.stderr.write(
      '[enrich-release-notes] Unexpected response shape from Anthropic API — skipping.\n',
    )
    return null
  }

  // HeroUI-style prompt reorganises content rather than expanding it, so allow output
  // down to 40% of raw length before flagging as suspiciously short.
  if (enriched.trim().length < RELEASE_BODY.trim().length * 0.4) {
    process.stderr.write('[enrich-release-notes] Enriched content suspiciously short — skipping.\n')
    return null
  }

  return enriched
}

async function main() {
  const enriched = await enrichReleaseNotes().catch((err) => {
    process.stderr.write(
      `[enrich-release-notes] Unexpected error: ${err?.message ?? String(err)}\n`,
    )
    return null
  })
  if (!RELEASE_BODY || !RELEASE_BODY.trim()) return

  const contributors = await collectContributorsSection(RELEASE_BODY, {
    repo: process.env.GITHUB_REPOSITORY || 'bruchris/canvas-lms-mcp',
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    maintainers: (process.env.RELEASE_NOTES_MAINTAINERS || 'bruchris')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean),
  }).catch((err) => {
    process.stderr.write(
      `[enrich-release-notes] Contributor lookup failed: ${err?.message ?? String(err)}\n`,
    )
    return null
  })

  if (enriched) {
    process.stdout.write(
      contributors ? upsertContributorsSection(enriched, contributors.section) : enriched,
    )
  } else if (contributors?.external) {
    process.stdout.write(upsertContributorsSection(RELEASE_BODY, contributors.section))
  }
}

main().catch((err) => {
  process.stderr.write(`[enrich-release-notes] Unexpected error: ${err?.message ?? String(err)}\n`)
  process.exit(0)
})
