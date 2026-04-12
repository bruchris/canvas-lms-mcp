#!/usr/bin/env node
/**
 * enrich-release-notes.mjs
 *
 * Calls Claude Haiku to rewrite release-please-generated notes in a
 * more engaging, human-readable voice, then prints the result to stdout.
 *
 * Environment variables:
 *   RELEASE_BODY        — raw release notes markdown (required)
 *   VERSION_TAG         — release version tag, e.g. "canvas-lms-mcp-v0.2.0"
 *   ANTHROPIC_API_KEY   — Anthropic API key (if absent, exits 0 with warning)
 *   SKIP_AI_RELEASE_NOTES — set to "true" to skip enrichment entirely
 */

const {
  ANTHROPIC_API_KEY,
  RELEASE_BODY,
  VERSION_TAG = 'unknown',
  SKIP_AI_RELEASE_NOTES,
} = process.env;

if (SKIP_AI_RELEASE_NOTES === 'true') {
  process.stderr.write('[enrich-release-notes] SKIP_AI_RELEASE_NOTES is set — skipping enrichment.\n');
  process.exit(0);
}

if (!ANTHROPIC_API_KEY) {
  process.stderr.write('[enrich-release-notes] ANTHROPIC_API_KEY is not set — skipping enrichment.\n');
  process.exit(0);
}

if (!RELEASE_BODY || !RELEASE_BODY.trim()) {
  process.stderr.write('[enrich-release-notes] RELEASE_BODY is empty — nothing to enrich.\n');
  process.exit(0);
}

const SYSTEM_PROMPT = `You are a technical writer helping improve software release notes.
Your job is to enrich auto-generated release notes so they are more readable and informative for developers and end users.

Rules you MUST follow:
- Rewrite the bullet points in an engaging, human-tone voice
- Add a short "Highlights" summary at the top (2–4 sentences) capturing what this release is about
- Group related changes when it makes sense
- Add context where commit messages are cryptic or terse
- Preserve ALL technical details — enrichment is additive, never replacement
- DO NOT invent features or changes not present in the original notes
- DO NOT use marketing fluff ("blazing fast", "game-changing", "revolutionary", etc.)
- DO NOT remove attribution to commit authors or PR links
- DO NOT change version numbers, dates, or any factual details
- Output valid markdown only — no preamble, no explanation, no code fences around the full output`;

const USER_PROMPT = `Please enrich the following release notes for version ${VERSION_TAG}:

---
${RELEASE_BODY}
---`;

async function enrichReleaseNotes() {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: USER_PROMPT },
        ],
      }),
    });
  } catch (err) {
    process.stderr.write(`[enrich-release-notes] Network error calling Anthropic API: ${err.message}\n`);
    process.exit(0);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    process.stderr.write(`[enrich-release-notes] Anthropic API returned ${response.status}: ${text}\n`);
    process.exit(0);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    process.stderr.write(`[enrich-release-notes] Failed to parse Anthropic API response: ${err.message}\n`);
    process.exit(0);
  }

  if (data?.stop_reason === 'max_tokens') {
    process.stderr.write('[enrich-release-notes] Response truncated (hit max_tokens) — skipping.\n');
    process.exit(0);
  }

  const enriched = data?.content?.[0]?.text;
  if (!enriched) {
    process.stderr.write('[enrich-release-notes] Unexpected response shape from Anthropic API — skipping.\n');
    process.exit(0);
  }

  if (enriched.trim().length < RELEASE_BODY.trim().length * 0.5) {
    process.stderr.write('[enrich-release-notes] Enriched content suspiciously short — skipping.\n');
    process.exit(0);
  }

  process.stdout.write(enriched);
}

enrichReleaseNotes().catch((err) => {
  process.stderr.write(`[enrich-release-notes] Unexpected error: ${err.message}\n`);
  process.exit(0);
});
