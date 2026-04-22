# Alternative Canvas Authentication Modes Beyond Personal Access Tokens

**Date**: 2026-04-22  
**Issue**: `BRU-530`  
**Status**: Proposed design, not yet implemented

## Goal

Define which Canvas authentication modes this repo should support beyond personal access tokens (PATs), which modes should be rejected, and how auth posture should differ across:

- local `stdio`
- self-hosted or managed HTTP
- ChatGPT-connected remote MCP

This document is design-only. It does not change current implementation.

## Why This Matters

The repo currently has a clear v1.0 story:

- local usage: PAT via CLI/env vars
- remote HTTP: per-request token passthrough
- library usage: token supplied by the embedding application

That is good for developer ergonomics, but it leaves real adoption gaps:

- some schools restrict manual token generation
- OpenAI now recommends OAuth for remote MCP servers connected to ChatGPT
- competitors are experimenting with session reuse and mobile-app-style token capture

The question is not only "what is technically possible." It is "what is supportable, defensible, and aligned with an open-source public npm package."

## Current Repo Constraints

The current architecture is favorable for adding more auth modes without rewriting the Canvas client:

- `src/canvas/` is a pure Canvas REST client that only needs a bearer token and base URL
- `src/server.ts` already centralizes server construction
- `src/http.ts` already distinguishes remote transport from local `stdio`
- the April 20 ChatGPT compatibility design ([`2026-04-20-chatgpt-app-compatibility-mode.md`](./2026-04-20-chatgpt-app-compatibility-mode.md)) already argues for profile-specific auth posture

That means new auth work belongs at the transport/server boundary, not inside the Canvas domain modules.

## External Constraints

Current official guidance from Canvas and OpenAI materially narrows what is reasonable:

- Canvas documents manual token generation as suitable for testing, but says multi-user applications must use OAuth.
- Canvas supports OAuth 2.0 authorization code flow for Canvas REST API access via developer keys, with refresh tokens and optional scopes.
- Canvas developer keys are institution-scoped unless the vendor obtains a global key, and administrators can enable/disable keys and scopes per account.
- Canvas also supports OAuth client-credentials flows for LTI Advantage services, but those access tokens are not general Canvas REST API user tokens.
- OpenAI recommends OAuth and dynamic client registration for remote MCP servers connected in ChatGPT.

Sources:

- Canvas OAuth2 docs: https://canvas.instructure.com/doc/api/file.oauth.html
- Canvas developer keys docs: https://canvas.instructure.com/doc/api/file.developer_keys.html
- Canvas token scopes docs: https://canvas.instructure.com/doc/api/api_token_scopes.html
- OpenAI MCP docs: https://platform.openai.com/docs/mcp
- OpenAI ChatGPT developer mode docs: https://platform.openai.com/docs/guides/developer-mode

## Evaluation Criteria

Each auth mode is evaluated on:

1. Security and privacy posture for a public npm package
2. Operational support burden
3. Compatibility with Canvas's official model
4. Fit for local `stdio`
5. Fit for generic remote HTTP
6. Fit for ChatGPT-connected remote MCP
7. Fit with the existing repo architecture

## Auth Modes Considered

### 1. Personal access tokens

Definition:

- user manually generates a Canvas token and gives it to the local MCP config, HTTP caller, or embedding application

Assessment:

- technically simple
- already implemented
- appropriate for single-user local setups and developer workflows
- weak for broader end-user adoption
- Canvas explicitly does not position manual token entry as the right path for multi-user applications

Conclusion:

- **Keep**
- but narrow its recommended scope to local/self-managed usage, not the primary long-term story for remote productized deployments

### 2. Host-application-managed OAuth (institution-specific developer key)

Definition:

- a host application owns the OAuth flow with a Canvas institution's developer key
- the host stores refreshable user tokens securely
- the MCP server receives resolved bearer tokens server-side or at construction time

Assessment:

- matches Canvas's official REST API model
- fits existing `createCanvasMCPServer({ token, baseUrl })` library usage well
- works for a single institution or a known institution set
- reasonable for self-hosted products and school-specific integrations
- does require OAuth callback handling, token storage, refresh logic, and institution binding outside or adjacent to this package

Conclusion:

- **Recommended**
- this should be the primary supported alternative to PATs

### 3. Multi-institution OAuth broker with allowlisted institution bindings

Definition:

- an application or hosted deployment supports multiple institutions
- each institution has its own developer key or approved global key relationship
- the broker resolves the correct Canvas base URL and client credentials for each user

Assessment:

- viable, but materially more complex than single-institution OAuth
- Canvas developer keys are institution-scoped by default, which makes key lookup and tenant binding first-class product concerns
- manageable only with strong institution allowlisting and admin onboarding
- not appropriate as a "just point it anywhere" open remote mode

Conclusion:

- **Recommended later, with constraints**
- acceptable only through an explicit brokered deployment model

### 4. First-party OAuth plus dynamic client registration for arbitrary institutions

Definition:

- the package or its default hosted mode would attempt to dynamically register against arbitrary Canvas institutions on demand

Assessment:

- OpenAI recommends dynamic client registration for remote MCP servers when appropriate, but Canvas institution-level auth still depends on Canvas-side developer key realities
- in practice, arbitrary-institution onboarding remains operationally messy because Canvas admin approval and institution trust are still required
- dynamic registration does not remove the need for tenant control, safe callback handling, secure secret storage, or institution trust establishment
- for this repo, the phrase "dynamic client registration" is best understood as a possible enhancement to an OAuth broker, not a reason to support arbitrary user-provided institutions by default

Conclusion:

- **Do not make this a core repo promise**
- acceptable only as an implementation detail of a future brokered hosted product

### 5. Cookie/session reuse

Definition:

- reuse a user's browser Canvas session cookie, scrape an existing session, or proxy browser-authenticated traffic to Canvas

Assessment:

- fragile and likely to break across Canvas deployments, security settings, browser policies, and MFA/session changes
- significantly worse security posture than OAuth or explicit token-based auth
- encourages capturing or relaying credentials/session material that the package should never handle
- difficult to document safely in a public npm package
- very hard to defend operationally if schools or users experience account compromise or session leakage

Conclusion:

- **Reject**

### 6. Mobile-app emulation or undocumented token capture

Definition:

- emulate Canvas mobile-app auth flows, intercept mobile-style tokens, or rely on non-public/auth-adjacent reverse engineering

Assessment:

- brittle by design
- likely to drift as Canvas changes mobile clients and auth behavior
- high support burden and poor trust story
- weak legal and policy posture for an open-source package intended for broad adoption

Conclusion:

- **Reject explicitly**

### 7. Username/password credential capture

Definition:

- ask users to enter Canvas credentials directly into this package or a deployment built on it

Assessment:

- directly opposed to the repo's security posture
- unnecessary given official OAuth support
- unacceptable for an open-source public npm package

Conclusion:

- **Reject explicitly**

### 8. LTI client-credentials as a general REST auth substitute

Definition:

- use LTI Advantage client-credentials tokens as the primary auth model for the package's general REST API access

Assessment:

- Canvas supports client-credentials for LTI services
- Canvas's own docs distinguish those tokens from general REST API user access
- useful for LTI-specific adjunct workflows, but not a replacement for user-authorized REST access

Conclusion:

- **Not a primary auth mode for this repo**
- potentially relevant only for future LTI-specific integrations outside the core MCP auth story

## Recommendation

### Preferred path

Support three auth postures, each matched to a deployment shape:

1. **Local/self-managed**: PAT remains supported and documented as the simplest option.
2. **Embedded app / institution deployment**: OAuth 2.0 authorization code flow with host-managed token storage becomes the recommended alternative to PATs.
3. **ChatGPT-connected remote MCP / future hosted service**: brokered OAuth only, with server-side credential resolution and institution binding.

This means the project should move from:

- "PAT-first everywhere"

to:

- "PAT for local/self-managed usage"
- "OAuth for productized or shared remote usage"

### Explicit non-support

The repo should explicitly reject:

- cookie/session reuse
- username/password capture
- mobile-app emulation or undocumented token scraping
- arbitrary user-supplied institution auth in ChatGPT-facing remote mode

## Deployment-Specific Auth Posture

### Local `stdio`

Recommended:

- PAT
- host-app-supplied OAuth token when embedded into another local workflow

Why:

- local agent tooling is developer-operated
- secrets stay under the user's own environment/config management
- this is the least risky place to tolerate manual token configuration

Documentation posture:

- PAT remains the default quickstart
- add a short note that embedded applications may pass OAuth-derived tokens instead

### Generic remote HTTP

Recommended:

- current per-request PAT passthrough is acceptable for self-managed developer use
- for shared or managed deployments, move toward brokered server-side OAuth resolution

Why:

- remote transport increases the risk of unsafe credential handling
- allowing arbitrary runtime base URLs plus runtime tokens is acceptable only for explicitly self-managed scenarios
- once a deployment is shared across users, PAT passthrough becomes a weak trust and support model

Documentation posture:

- split docs between `self-hosted developer HTTP` and `shared/managed HTTP`
- state that shared deployments should prefer OAuth-backed credential resolution and fixed or allowlisted institutions

### ChatGPT-connected remote MCP

Recommended:

- OAuth-backed broker only
- no user-supplied Canvas tokens in normal connector usage
- single-institution config first, then allowlisted multi-institution support later

Why:

- aligns with the April 20 BRU-467 design
- aligns with OpenAI's current recommendation for remote MCP auth
- reduces SSRF, tenant confusion, and secret-handling risk
- avoids telling users to paste Canvas secrets into ChatGPT-adjacent flows

Documentation posture:

- treat this as a distinct profile with stricter deployment requirements
- document that ChatGPT compatibility does not imply arbitrary-institution bring-your-own-token support

## Acceptability for a Public Open-Source npm Package

The package can responsibly support:

- PATs for local/self-managed use
- OAuth integration points for embedding applications and institution deployments
- brokered OAuth for remote/ChatGPT-facing deployments

The package should not ship official documentation that normalizes:

- credential scraping
- cookie harvesting
- reverse-engineered mobile auth workarounds
- direct password collection

The key principle is that the open-source package may enable secure integrations, but it should not become a toolkit for bypassing institution policy or relying on brittle unofficial auth behavior.

## Architectural Implications

The auth boundary should stay outside `src/canvas/`.

Recommended shape:

```text
src/canvas/      Pure Canvas REST access with bearer token input
src/auth/        Auth adapters / policy interfaces / broker integration points
src/server.ts    Server creation with explicit auth posture/profile
src/http.ts      Remote transport rules, profile selection, request auth policy
src/cli.ts       Flags for local vs remote auth modes
```

Key design rule:

- the Canvas client should continue to accept a resolved bearer token and base URL
- auth acquisition, refresh, broker lookup, and institution binding should happen before the client is constructed

That keeps the current modular architecture intact and matches the existing BRU-467 recommendation that ChatGPT-specific auth logic belong at the transport/server composition layer.

## Proposed Repo-Level Positioning Changes

### Current story

- PAT is the visible primary setup path everywhere

### Recommended story

- `stdio` quickstart stays PAT-first
- library integrations prominently document OAuth-derived token support
- remote HTTP docs distinguish developer/self-hosted passthrough mode from production/shared OAuth-backed mode
- ChatGPT-facing docs require OAuth-backed deployment guidance

## User-Facing Setup and Documentation Impact

### If PAT-only remained the story

Needed changes:

- almost none

Problems:

- leaves the repo weak for institutions and ChatGPT-connected remote deployments
- does not answer the adoption gap raised in BRU-530

### If institution-specific OAuth is added

Needed docs:

- developer key prerequisites
- redirect URI requirements
- token storage and refresh expectations
- how a host app passes resolved tokens into `createCanvasMCPServer`
- single-institution deployment guidance

### If brokered multi-institution OAuth is added later

Needed docs:

- institution onboarding flow
- allowlist and tenant-binding model
- secure storage expectations
- how base URL selection works outside per-request headers

### If ChatGPT-facing remote mode is shipped

Needed docs:

- explicit remote profile selection
- OAuth requirement
- connector/admin setup steps
- why arbitrary runtime base URLs and token headers are not accepted in that mode

## Risks

### OAuth complexity

- adds callback, refresh, and secret-management complexity
- mitigation: keep OAuth outside the Canvas client and behind explicit auth adapters

### Institution onboarding burden

- schools may require admin approval for developer keys/scopes
- mitigation: document single-institution first, do not promise zero-friction arbitrary-institution onboarding

### Product confusion

- users may expect one auth mode to work everywhere
- mitigation: document auth by deployment shape, not as one flat matrix

### Security drift

- pressure may emerge to support brittle but convenient unofficial auth shortcuts
- mitigation: reject those paths explicitly in docs and implementation boundaries

## Rollout Order

### Phase 0: now

- land this design
- do not change current v1.x behavior yet

### Phase 1: clarify docs

- keep PAT quickstart for local usage
- revise docs to state that PAT is not the preferred long-term model for shared remote deployments
- cross-link BRU-467 ChatGPT auth posture

### Phase 2: add auth abstraction points

- introduce explicit auth/profile concepts in `src/server.ts`, `src/http.ts`, and `src/cli.ts`
- no full OAuth implementation required yet

### Phase 3: institution-specific OAuth support

- support host-managed authorization code flow
- support token refresh handling outside or adjacent to the package
- document embedding patterns for apps using `canvas-lms-mcp` as a library

### Phase 4: brokered remote OAuth

- single-institution remote deployment first
- allowlisted multi-institution deployments later
- use this as the basis for ChatGPT-compatible remote MCP

### Phase 5: optional DCR enhancements

- evaluate dynamic client registration only where it materially improves broker onboarding
- do not treat DCR as a substitute for institution trust and safe tenant binding

## Concrete Follow-Up Tasks

1. Add an auth architecture spec that defines package-level auth profiles:
   - `local_static_token`
   - `remote_static_token`
   - `oauth_embedded`
   - `oauth_brokered`

2. Update the April 12 main design spec so its auth section becomes deployment-specific rather than globally PAT-first.

3. Update the April 20 BRU-467 ChatGPT design to reference this decision explicitly:
   - ChatGPT remote mode must use brokered OAuth
   - PAT passthrough is not the default ChatGPT auth story

4. Add documentation split:
   - local quickstart
   - self-hosted remote developer mode
   - institution/embedded OAuth mode
   - ChatGPT remote mode

5. Design server configuration changes before implementation:
   - explicit profile selection
   - explicit auth mode selection
   - remote base URL policy options: fixed, allowlisted, or request-supplied

6. If implementation is approved later, create separate tasks for:
   - CLI/server config refactor
   - auth adapter interfaces
   - embedded OAuth integration docs/examples
   - brokered remote auth design
   - ChatGPT remote profile hardening

## Final Recommendation

The repo should **not** broaden support by adopting unofficial auth workarounds.

It should instead formalize a narrower, defensible ladder:

- **PAT** for local and self-managed use
- **institution-specific OAuth** as the primary supported alternative
- **brokered OAuth** for shared remote and ChatGPT-connected deployments
- **explicit rejection** of cookie/session reuse, password capture, and mobile-app emulation

That path addresses the adoption gap raised in BRU-530 without contaminating the core architecture or weakening the security posture of a public npm package.
