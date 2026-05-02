# skills.sh Publication Path

> Research findings for [BRU-802](/BRU/issues/BRU-802). Last updated: 2026-05-01.

## Summary

There is no explicit submission step. Skills appear on [skills.sh](https://skills.sh) automatically via install telemetry when users run `npx skills add bruchris/canvas-lms-mcp`. Our SKILL.md format is already compatible. No CI changes are needed.

## 1. Submission Process

**skills.sh is fully telemetry-driven.** When a user runs:

```bash
npx skills add bruchris/canvas-lms-mcp
```

the CLI records the install and the package appears/climbs the skills.sh directory. There is no:
- Registration form
- `skills publish` command
- Submit endpoint (`skills.sh/submit` returns 404)
- Manual listing process

*Source: [Vercel KB — Agent Skills](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context), [vercel-labs/skills](https://github.com/vercel-labs/skills)*

## 2. SKILL.md Format Requirements

| Field | Required | Constraint |
|---|---|---|
| `name` | ✅ Yes | Must match parent directory name; lowercase, hyphens only |
| `description` | ✅ Yes | What the skill does and when to trigger it |
| `license` | Optional | — |
| `compatibility` | Optional | — |
| `metadata` | Optional | Can carry semver etc. |
| `allowed-tools` | Optional | — |

### Compatibility check

All three of our skills pass:

| Skill | Directory | `name` field | Match |
|---|---|---|---|
| At-Risk Students | `skills/canvas-at-risk-students/` | `canvas-at-risk-students` | ✅ |
| Gradebook Audit | `skills/canvas-gradebook-audit/` | `canvas-gradebook-audit` | ✅ |
| Outcome Tracker | `skills/canvas-outcome-tracker/` | `canvas-outcome-tracker` | ✅ |

No frontmatter changes are needed. Our format mirrors the minimal `name` + `description` pattern used by `vishalsachdev/canvas-mcp` (535 installs on skills.sh as of 2026-05-01).

## 3. CI Integration

**Nothing to add to CI.** There is no `skills publish` command. The CLI telemetry that feeds skills.sh disables itself automatically in CI environments:

- `DISABLE_TELEMETRY=1`
- `DO_NOT_TRACK=1`

No modifications to `.github/workflows/` are needed.

## 4. Discoverability Tradeoffs

| Path | Today | What it provides |
|---|---|---|
| GitHub-direct (`npx skills add bruchris/canvas-lms-mcp`) | ✅ Works — README promotes it | Anyone who has the repo link can install |
| skills.sh listing | ❌ 404 (0 installs) | Discovery via `npx skills find canvas`; leaderboard; social proof |
| Competitor (`vishalsachdev/canvas-mcp`) | 535 installs, appears on skills.sh | — |

**What skills.sh adds:** users who run `npx skills find canvas` or browse the directory can discover us without knowing the repo. The leaderboard also provides social proof (install count visible). The install command works with or without a skills.sh listing — skills.sh is a discovery amplifier, not a gate.

**The limitation:** there is no way to "bootstrap" our listing. Only real user installs via the CLI create telemetry. Self-installs count (e.g., the CTO running the install command) but only fractionally build the count.

## 5. Recommendation

**Proceed now — no blocking actions.** Skills.sh registration is already "done by default" — our format is correct and our README promotes the install command. We will appear on skills.sh as users install the skills.

### Runbook (no PR needed)

1. ✅ `skills/` directory with compatible `SKILL.md` files — **already done**
2. ✅ README promotes `npx skills add bruchris/canvas-lms-mcp` — **already done**
3. 🔲 Add GitHub topic `skills-sh` to the repo (Settings → Topics on GitHub) — matches competitor, improves GitHub searchability; 2-minute action for CTO/board
4. 🔲 Promote `npx skills add bruchris/canvas-lms-mcp` in the v1.0 npm release announcement

**On timing (wait vs. now):** The expanded skill catalog from [BRU-801](/BRU/issues/BRU-801) will make the bundle more compelling to install. But since there is no submission step to time, there is nothing to delay — the more the README is promoted, the sooner installs accumulate. Recommend shipping the BRU-801 skills first (more catalog = stronger install motivation), then making the GitHub topic + release-announcement push as part of the v1.0 launch on 2026-05-09.

## References

- [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)
- [Vercel KB — Creating, Installing, and Sharing Skills](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context)
- [vercel-labs/skills (GitHub)](https://github.com/vercel-labs/skills)
- [skills.sh directory](https://skills.sh)
- [vishalsachdev/canvas-mcp on skills.sh](https://skills.sh/vishalsachdev/canvas-mcp) — 535 installs reference
- [Vercel Changelog — Introducing skills](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)
