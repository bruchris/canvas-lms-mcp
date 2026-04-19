# Hosted-Service Feasibility for `canvas-lms-mcp`

Date: 2026-04-19
Status: Proposed post-v1.0 architecture note
Related: `docs/superpowers/specs/2026-04-12-canvas-lms-mcp-design.md`

## Executive Summary

`canvas-lms-mcp` is already structurally close to a hosted deployment because it has:

- a standalone Canvas client layer
- a transport-independent MCP server factory
- an HTTP transport that accepts per-request credentials

That does **not** mean a public hosted service is "free" or "just packaging." The main gap is not MCP transport. The main gap is product and security infrastructure around credential custody, tenant isolation, observability, abuse prevention, and operational support.

## Recommendation

**Go** on hosted-service exploration after v1.0, but **do not include a public hosted service in v1.0 scope**.

Preferred path:

1. Keep v1.0 focused on npm package, self-hosted HTTP transport, and library usage.
2. After v1.0, harden the HTTP mode for production and pilot a **single-tenant managed deployment** for one institution or trusted partner.
3. Only pursue a **public multi-tenant managed service** after real demand proves that hosted convenience is worth the added security and support burden.

This recommendation preserves the current architecture, avoids premature token custody at scale, and produces a credible path to hosted usage without turning the v1.0 release into a SaaS platform project.

## Current Baseline

The current repo supports three useful deployment patterns already:

- `stdio` for local desktop MCP clients
- HTTP transport for self-hosted remote use
- library import for embedding in another Node.js service

The HTTP transport is the key enabler for hosted feasibility, but it is currently optimized for **stateless pass-through requests**, not for a production hosted product. Notable current constraints:

- base URL is server-configured, not tenant-configured
- request auth assumes the caller can provide a Canvas token directly
- there is no tenant registry, user auth, audit model, rate limiting, or billing layer
- there is no secrets vault or token lifecycle management
- there is no production observability or incident workflow beyond basic logs and health checks

## Decision Drivers

Any hosted option must satisfy these constraints:

1. **Canvas token safety**
   A hosted service cannot blur the boundary between "the user can do this in Canvas" and "the service can do this on behalf of many users." Token handling is the core risk.

2. **Tenant isolation**
   The system must prevent cross-tenant data leakage through logs, traces, cached responses, memory, or transport state.

3. **Transport compatibility**
   MCP over HTTP is enough for hosted delivery, but transport alone does not solve user identity, token refresh, or per-tenant authorization.

4. **Operational blast radius**
   The more centralized the service, the larger the support burden for outages, abuse, and incident response.

5. **Cost and support model**
   The hosted model should not force a support organization or compliance posture that is disproportionate to an open-source v1.0 package.

## Option A: Single-Tenant Hosted Proxy

Run a dedicated deployment per institution, department, or customer. Each deployment is isolated at the process, environment, and credential boundary.

### Shape

- one deployment per customer
- one configured Canvas base URL per deployment
- customer brings its own domain, environment, and secret store
- users authenticate to the customer-specific service
- Canvas tokens are either passed through per request or stored in that tenant's encrypted secret store

### Advantages

- lowest architecture change from the current HTTP mode
- strongest isolation without inventing a full multi-tenant control plane
- operational incidents stay scoped to one customer
- easier to explain permission boundaries and data residency
- aligns well with institutions that already centralize Canvas administration

### Disadvantages

- not a mass-market self-serve product
- onboarding and deployment automation matter more than core MCP logic
- higher ops overhead per customer than a shared control plane
- revenue depends on managed-service contracts, not low-touch signup

### Auth and token handling

- best initial model: customer-managed Canvas developer key or personal access tokens, encrypted at rest
- safer than a public shared vault because secrets are segmented per deployment
- still requires secret rotation, revocation, and audit logging

### Transport implications

- reuse existing HTTP transport as the base
- add deployment-level auth in front of MCP
- likely keep MCP endpoint private behind a thin customer-facing gateway

### Operational profile

- moderate complexity
- moderate cost
- lower shared blast radius

## Option B: Multi-Tenant Managed Service

Run one shared service for many institutions and users, with a central account system, tenant model, and encrypted credential vault.

### Shape

- shared control plane and shared worker/runtime fleet
- per-tenant config for Canvas base URLs and institution metadata
- stored encrypted tokens or OAuth grants per user
- centralized metering, billing, support, and abuse controls

### Advantages

- best end-user convenience
- cleanest SaaS story
- best long-term monetization potential if usage is broad
- enables richer platform features such as audit logs, usage insights, and policy controls

### Disadvantages

- highest security and compliance burden
- largest incident surface
- requires user auth, tenant admin UX, token vaulting, key rotation, auditability, and support tooling
- materially changes the project from "MCP server package" to "SaaS product"
- hardest option to justify before demand is proven

### Auth and token handling

- requires either Canvas OAuth or long-lived token storage
- personal access token storage at multi-tenant scale is high-risk and support-heavy
- OAuth is preferable, but institution support will vary and adds product complexity

### Transport implications

- MCP HTTP remains the runtime protocol
- service also needs non-MCP product surfaces: login, tenant provisioning, token management, admin APIs
- MCP transport becomes one slice of a larger platform rather than the primary engineering challenge

### Operational profile

- highest complexity
- highest cost
- highest shared blast radius

## Option C: Hybrid Hosted Bridge

Provide a hosted control plane and UX, but keep Canvas credentials in a local bridge process or customer-side connector. The hosted service orchestrates sessions instead of directly storing user Canvas secrets.

### Shape

- hosted dashboard, connection broker, and optional policy layer
- local bridge or customer-side connector establishes an outbound session to the hosted control plane
- Canvas API calls run through the bridge with credentials that remain local to the user or institution

### Advantages

- sharply reduces central token-custody risk
- good fit for security-sensitive institutions
- preserves a hosted UX for discovery, routing, and management
- can evolve from the existing local and self-hosted patterns

### Disadvantages

- not truly "no-install" for end users
- bridge reliability, upgrade flow, and support become new concerns
- harder mental model than either pure local or pure hosted
- weaker fit for consumer-grade self-serve onboarding

### Auth and token handling

- preferred model if token locality is a hard requirement
- hosted service stores connection metadata, not Canvas tokens
- still requires secure tunnel/session management and strong broker auth

### Transport implications

- MCP may run between client and hosted control plane, or between hosted control plane and bridge
- requires an additional bridging protocol or tunnel, not just the current HTTP entry point

### Operational profile

- medium-high complexity
- medium cost
- lower credential risk than Option B

## Decision Matrix

| Criterion | Option A: Single-Tenant Hosted Proxy | Option B: Multi-Tenant Managed Service | Option C: Hybrid Hosted Bridge |
| --- | --- | --- | --- |
| End-user convenience | Medium | High | Medium |
| Security risk from token custody | Medium | High | Low |
| Tenant isolation | High | Medium | High |
| Reuse of current architecture | High | Medium | Medium |
| Operational complexity | Medium | High | Medium-High |
| Support burden | Medium | High | Medium-High |
| Near-term feasibility | High | Low-Medium | Medium |
| Fit for v1.0 | No | No | No |
| Best post-v1.0 pilot | **Yes** | No | Maybe |

## Why Option A Is the Preferred Path

Option A is the best first hosted step because it matches the actual maturity of the codebase and product:

- The repo already has the right technical seam: a stateless HTTP transport layered on a reusable Canvas client.
- The missing work is mostly production hardening and deployment packaging, not a rewrite.
- Isolation is easier to reason about because the deployment boundary is also the tenant boundary.
- The service can be sold or piloted as "managed hosting for a specific institution" without immediately taking on public-SaaS scale risk.

Option B should remain a later-stage decision. It only becomes rational if:

- adoption proves real demand for zero-infra hosted access
- there is a supported Canvas OAuth story for target institutions
- there is willingness to fund a real ops and support surface

Option C is valuable as a safety-oriented fallback if institutions reject hosted token custody, but it should not be the first path because it introduces bridge orchestration before demand is validated.

## Security Model by Option

### Shared principles

- Canvas authorization remains the source of truth; the service must never escalate beyond what the token already permits.
- All write tools remain destructive operations and should preserve the current MCP safety annotations.
- Tokens must be excluded from logs, traces, metrics labels, crash dumps, and error payloads.
- Per-request server instances or equivalent hard request scoping should remain the default to avoid tenant state bleed.

### Option-specific implications

#### Option A

- deployment-level isolation is the main control
- store secrets in a per-customer secret manager
- easiest model for customer-specific allowlists, SSO, and audit retention

#### Option B

- requires envelope encryption, key rotation, per-tenant access policies, audit trails, and support controls
- strongest need for formal incident response because one bug can affect many tenants

#### Option C

- central service handles broker trust and metadata
- local bridge holds the Canvas secret boundary
- main risk shifts from stored-token compromise to tunnel/session compromise

## Operational Requirements

Regardless of option, a hosted offering needs more than today's HTTP server:

- structured logs with token redaction
- request correlation and tenant-aware tracing
- rate limiting and abuse protection
- explicit timeouts and circuit breaking for Canvas API calls
- deployment health, alerting, and rollback strategy
- version compatibility policy for MCP clients
- security patch and dependency response process
- support playbooks for revoked tokens, Canvas outages, and misconfigured base URLs

Additional requirements by maturity:

- **Pilot**: health checks, request metrics, token redaction, on-call ownership, per-tenant config management
- **Managed GA**: audit logs, secret rotation workflows, SLOs, billing, compliance review, incident communications

## Cost Model

### Option A

- costs scale mostly per customer deployment
- predictable infrastructure shape
- easier to price as managed hosting or enterprise support

### Option B

- better gross margin at scale if usage is large
- poor economics early because platform, support, and security work dominate

### Option C

- moderate infrastructure cost
- added engineering/support cost for bridge distribution and connectivity debugging

## Phased Rollout

### Phase 0: v1.0 ship

Goal: keep hosted support out of scope, but leave the package ready for self-hosted production use.

Scope:

- ship npm package and documented HTTP mode
- document hosted mode as future work, not supported product scope
- avoid adding secret storage, tenant state, or hosted auth flows

Complexity: Low

### Phase 1: Production-hardening for managed pilots

Goal: make HTTP mode safe enough for one managed deployment.

Scope:

- log redaction
- request IDs and structured telemetry
- stronger rate limiting and origin controls
- explicit deployment guidance for reverse proxy, TLS, and secrets
- deployment automation for customer-isolated environments

Complexity: Medium

### Phase 2: Single-tenant pilot

Goal: run one isolated hosted deployment for a trusted institution or partner.

Scope:

- tenant-specific auth in front of MCP
- secret storage and rotation
- operational dashboards and alerting
- documented support and incident process

Complexity: Medium-High

### Phase 3: Re-evaluate public managed service

Goal: decide whether usage justifies building Option B or Option C.

Entry criteria:

- pilot demand is real
- token model is validated
- support load is understood
- there is appetite to own an ongoing hosted product

Complexity: High

## Go / No-Go Decision

### v1.0

**No-go** for a public hosted service in v1.0.

Reason:

- it adds SaaS-grade security and support requirements that are not necessary to ship the package
- it dilutes focus from the stated v1.0 goal: a reliable open-source MCP server and library
- the current architecture supports future hosting, but production hosting still needs meaningful platform work

### Post-v1.0

**Go** for a narrowly scoped hosted pilot, starting with Option A.

Reason:

- technical reuse is high
- security posture is easier to reason about
- pilot feedback can validate whether deeper platform investment is justified

## Practical Next Steps

1. Treat hosted service as a roadmap item, not a launch requirement.
2. Keep the current HTTP transport stateless and tenant-agnostic.
3. After v1.0, create a hardening backlog specifically for hosted readiness.
4. Pilot a single-tenant managed deployment before committing to a public multi-tenant service.
5. Revisit hybrid bridge only if institutions reject centralized token custody.
