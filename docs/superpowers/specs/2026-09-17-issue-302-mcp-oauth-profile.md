# MCP OAuth profile with a host-visible "Not logged in" state

- **Issue**: [#302](https://github.com/bruchris/canvas-lms-mcp/issues/302)
- **Date**: 2026-09-17
- **Status**: Implemented in the same PR as this document
- **Base**: `origin/main` @ `db2c5e2` (v1.29.3), 165 tools, `@modelcontextprotocol/sdk` 1.29.0
- **Builds on**: [`2026-04-22-canvas-authentication-modes.md`](./2026-04-22-canvas-authentication-modes.md) (auth ladder, profile names) and [`2026-04-20-chatgpt-app-compatibility-mode.md`](./2026-04-20-chatgpt-app-compatibility-mode.md) (profile-specific auth posture)

---

## 1. Goal

Let an MCP host that implements the MCP authorization specification (Codex, ChatGPT, Claude, and others) connect to a running `canvas-lms-mcp` HTTP server, show it as **Not logged in**, complete a browser login with `codex mcp login canvas-lms`, and afterwards call Canvas tools on behalf of the user — without the user ever pasting a Canvas token into any config file, and without the server ever accepting a Canvas token from the network.

Everything that exists today keeps working unchanged. The stdio transport is still PAT-based, and the existing `serve` command still accepts `X-Canvas-Token`. Both now have explicit names.

## 2. Non-goals (from the issue, restated as design constraints)

- No native OAuth state for a stdio server. Codex correctly shows `Auth Unsupported` there; the `doctor` command is the diagnostic substitute.
- No Canvas token is ever accepted as the inbound MCP bearer token, and no inbound MCP token is ever sent to Canvas.
- No password capture, cookie reuse, or mobile-app emulation.
- No arbitrary-institution onboarding. One Developer Key, one Canvas base URL, fixed at startup.
- PAT support is not removed from any existing surface.

## 3. Profiles

Every process resolves to exactly one auth profile at startup. The names come from the April 22 spec.

| Profile               | Transport | Canvas credential                                                | Inbound auth                                  | Default for |
| --------------------- | --------- | ---------------------------------------------------------------- | --------------------------------------------- | ----------- |
| `local_static_token`  | stdio     | `CANVAS_API_TOKEN` / `--token`                                   | none (process-local)                          | stdio       |
| `remote_static_token` | HTTP      | `X-Canvas-Token` per request, or the configured default token    | none beyond the Canvas token itself           | `serve`     |
| `oauth_brokered`      | HTTP      | Canvas OAuth token obtained via the institution's Developer Key, stored server-side per grant | MCP OAuth 2.1 bearer token issued by this server | —           |

Selection: `--auth-profile <name>` or `CANVAS_AUTH_PROFILE`. The flag wins. Profile/transport mismatches (`local_static_token` with `serve`, `oauth_brokered` without `serve`) are startup errors. An unknown value is a startup error — a typo must not fall back to a more permissive profile.

`CANVAS_API_TOKEN` is required by the two static profiles only. In `oauth_brokered` it is ignored with a warning, because a leftover PAT in a hosted environment is a misconfiguration worth surfacing, not a fatal one.

`remote_static_token` is documented as **self-managed only**: it is the right tool for a developer's own HTTP experiments and for embedding applications that already hold a Canvas token, and the wrong tool for anything shared. Its behaviour does not change in this PR except for the `Origin` check in §7.

## 4. The two OAuth domains

```text
Codex / MCP client
  -- MCP access token, audience = <issuer>/mcp -->
canvas-lms-mcp  (OAuth 2.1 authorization server + resource server)
  -- Canvas access token from the Developer Key, refreshed server-side -->
the one configured Canvas institution
```

The server plays three roles, all within one process:

1. **Authorization server** for MCP clients (metadata, registration, authorize, token, revoke).
2. **Resource server** for `/mcp` (bearer validation, audience check, scope check).
3. **OAuth client** toward Canvas (authorization-code flow with the institution's Developer Key).

The inbound MCP token and the outbound Canvas token are different strings, minted by different parties, stored in different places, with different lifetimes. The only link between them is the **grant** record (§6).

## 5. Configuration

All OAuth settings are server-side environment variables (plus two convenience flags). None of them is ever read from a request.

| Variable                              | Required in `oauth_brokered` | Meaning                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANVAS_BASE_URL`                     | yes                          | The one Canvas institution. Origin only, as today.                                                                                                                                                                          |
| `CANVAS_MCP_ISSUER` / `--issuer`      | yes                          | Public URL of this server, e.g. `http://127.0.0.1:3001` or `https://canvas-mcp.example.edu`. Also the OAuth issuer and the prefix of the resource identifier. Must be `https` unless the host is loopback. No query/fragment. Trailing slash stripped. |
| `CANVAS_OAUTH_CLIENT_ID`              | yes                          | Canvas Developer Key ID.                                                                                                                                                                                                    |
| `CANVAS_OAUTH_CLIENT_SECRET`          | yes                          | Canvas Developer Key secret.                                                                                                                                                                                                |
| `CANVAS_OAUTH_SCOPES`                 | no                           | Space-separated Canvas API scopes, for Developer Keys with *Enforce Scopes* enabled. Omitted = the key's default (full user access).                                                                                        |
| `CANVAS_MCP_OAUTH_CLIENTS`            | no                           | JSON array of pre-registered MCP clients: `[{"client_id":"…","client_name":"…","redirect_uris":["…"],"client_secret":"…"?}]`.                                                                                             |
| `CANVAS_MCP_OAUTH_DCR`                | no (default `true`)          | Set to `false` to disable dynamic client registration (RFC 7591).                                                                                                                                                           |
| `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS` | no (default `chatgpt.com`)   | Comma-separated hostnames whose Client ID Metadata Documents are trusted. `*` = any `https` host. Empty or `none` = CIMD disabled and not advertised.                                                                        |
| `CANVAS_MCP_OAUTH_STORE`              | no                           | Path of the encrypted grant/token store. Unset = in-memory (grants do not survive restart).                                                                                                                                 |
| `CANVAS_MCP_OAUTH_STORE_KEY`          | iff `CANVAS_MCP_OAUTH_STORE` | Secret from which the AES-256-GCM key is derived (scrypt). Startup fails if the store exists and the key does not open it.                                                                                                   |
| `CANVAS_HTTP_HOST` / `--host`         | no                           | Bind address. `oauth_brokered` defaults to `127.0.0.1`; `remote_static_token` keeps binding all interfaces (Docker relies on it). A loopback issuer with a non-loopback bind is a startup error.                              |

Startup rules, all enforced in `src/auth/oauth/config.ts` before anything listens:

- non-loopback issuer ⇒ `https` (acceptance: "hosted authorization endpoints require HTTPS");
- loopback issuer ⇒ loopback bind (acceptance: "localhost mode binds only to loopback by default");
- store path without key, or key that does not decrypt an existing store ⇒ refuse to start;
- pre-registered client redirect URIs must be `https` or loopback `http` (OAuth 2.1 §1.5 as adopted by MCP).

## 6. Data model

All records live behind an `OAuthStore` interface (`src/auth/oauth/store.ts`) so an embedder can supply a database-backed one. Two implementations ship: `MemoryOAuthStore`, and `FileOAuthStore`, which wraps the memory store and persists the whole state as one AES-256-GCM blob after every mutation (atomic `tmp` + `rename`, file mode `0600`).

| Record                 | Key                          | Lifetime                       | Notes                                                                                                                         |
| ---------------------- | ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `RegisteredClient`     | `client_id`                  | until evicted (DCR cap 1000)   | Pre-registered, DCR, or a cached CIMD document. Confidential clients store a **hash** of the secret.                          |
| `PendingAuthorization` | random id (= Canvas `state`) | 10 minutes, single use         | The client's authorize request, the consent decision, and a hash of the browser cookie nonce that must return on the callback. |
| `AuthorizationCode`    | SHA-256 of the code          | 5 minutes, single use          | Bound to client, redirect URI, PKCE challenge, scopes, resource, grant. A second redemption **revokes the grant** (OAuth 2.1 §4.1.2). |
| `Grant`                | random id                    | until revoked                  | The Canvas connection: Canvas access token, refresh token, expiry, Canvas user id. One grant per completed login, one Canvas token per grant. Nothing is shared between clients. |
| `TokenRecord`          | SHA-256 of the token         | access 1 h, refresh 30 d       | Type, grant, client, scopes, audience. Only hashes are stored; the token itself exists only in the response that minted it.   |

Tokens are opaque: 32 random bytes, base64url, with a type prefix (`mcpat_`, `mcprt_`, `mcpac_`) so leaked strings are recognisable to secret scanners. No JWTs, so no signing keys to manage and revocation is a delete.

## 7. HTTP surface in `oauth_brokered`

All paths are relative to the issuer. If the issuer carries a path (`https://host/canvas`), the well-known documents are served in the RFC 8414 / RFC 9728 path-inserted form (`/.well-known/oauth-authorization-server/canvas`, `/.well-known/oauth-protected-resource/canvas/mcp`) and the plain root forms only when the issuer has no path.

| Method + path                              | Auth                            | Purpose                                                                                                      |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /health`                              | none                            | unchanged                                                                                                    |
| `GET /.well-known/oauth-protected-resource[/mcp]` | none                     | RFC 9728: `resource`, `authorization_servers: [issuer]`, `bearer_methods_supported: ["header"]`, `scopes_supported` |
| `GET /.well-known/oauth-authorization-server` | none                         | RFC 8414: endpoints, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported`   |
| `POST /oauth/register`                     | none (DCR)                      | RFC 7591. Public clients by default; `client_secret_*` methods get a generated secret. Redirect URIs must be `https` or loopback `http`. |
| `GET /oauth/authorize`                     | browser                         | Validates client + redirect URI first (errors here render an HTML page, never a redirect), then PKCE/scope/resource (errors here redirect with `error=`), then renders the consent page. |
| `POST /oauth/authorize/continue`           | browser + CSRF nonce + `Origin` | Allow ⇒ set the flow cookie and redirect to Canvas `/login/oauth2/auth`. Deny ⇒ redirect to the client with `access_denied`. |
| `GET /oauth/canvas/callback`               | browser + flow cookie           | Exchanges the Canvas code, creates the grant, mints the MCP authorization code, redirects to the client's redirect URI with `code` + the client's original `state`. |
| `POST /oauth/token`                        | client (`none` / `client_secret_basic` / `client_secret_post`) | `authorization_code` (PKCE S256 verified, exact redirect URI, resource match) and `refresh_token` (rotating). `Cache-Control: no-store`. |
| `POST /oauth/revoke`                       | client                          | RFC 7009. Either token type revokes the **whole grant**, deletes every token for it, and calls Canvas `DELETE /login/oauth2/token`. Always 200. |
| `POST /mcp`                                | `Authorization: Bearer <MCP token>` | The MCP endpoint. See §8.                                                                                |

Cross-cutting, applied in every HTTP profile: if an `Origin` header is present and is not the configured allowed origin (or, in `oauth_brokered`, the issuer's own origin), the request is refused with 403 before routing. Browsers on any other origin were already blocked by CORS preflight, so this only closes DNS-rebinding, and the consent form's own POST is covered by the issuer origin.

### 7.1 Redirect URI matching

Exact string match against the registered value, with the single exception RFC 8252 §7.3 requires: for `http` redirect URIs whose host is `127.0.0.1`, `[::1]` or `localhost`, the port is not compared, because native clients (Codex included: `http://127.0.0.1:<random>/callback`) bind an ephemeral port per login. Scheme, host, path and query must still match exactly.

### 7.2 Consent page and the confused-deputy problem

This server holds a static Canvas client id and forwards to a third-party authorization server, which is precisely the arrangement the MCP security guidance flags. Two controls:

1. **Per-client consent.** Before any redirect to Canvas, the user sees the client name, the client id (for CIMD clients, the document URL), the full redirect URI with its host highlighted, and the requested scopes, and must click *Continue to Canvas*. Canvas then shows its own consent page as well.
2. **Cookie-bound flow.** The consent POST sets an `HttpOnly`, `SameSite=Lax` (`Secure` when the issuer is `https`) cookie holding a random nonce; only its hash is stored on the pending authorization. The Canvas callback is accepted only when the returning browser presents the cookie that started the flow. This defeats the login-CSRF variant where an attacker starts a flow with their own client and tricks a victim into completing the Canvas half of it.

### 7.3 Client registration

Codex tries CIMD first when the AS advertises it, then DCR, then pre-registered credentials. All three are supported:

- **CIMD**: the `client_id` is an `https` URL. The server fetches it only if the host is on `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS` (default `chatgpt.com`, which is where Codex hosts `…/oauth/codex/<id>/client.json`), requires `application/json`, a 64 KiB cap, a `client_id` field that equals the URL exactly, and a `redirect_uris` array; the document is cached in the client store for `max-age` (bounded to one hour). The allowlist is the SSRF control: no request is ever made to a host the operator did not name.
- **DCR**: open registration capped at 1000 clients with oldest-first eviction, so an unauthenticated writer cannot grow the store without bound.
- **Pre-registered**: `CANVAS_MCP_OAUTH_CLIENTS`.

### 7.4 Scopes

Two MCP scopes: `canvas:read` and `canvas:write`. A request without `scope` gets both (the MCP client default). `/mcp` requires `canvas:read`; a token without it gets `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="canvas:read canvas:write"`. A token without `canvas:write` gets a server on which only tools with `readOnlyHint: true` are registered, so write tools are neither listed nor callable. These are MCP scopes, not Canvas scopes; Canvas scopes are `CANVAS_OAUTH_SCOPES` and are decided by the operator, never by the client.

## 8. Resource-server behaviour on `/mcp`

Order of checks, each with the response the MCP spec requires:

1. `OPTIONS` ⇒ 204 (CORS preflight, before any auth).
2. `X-Canvas-Token` present ⇒ **400** `invalid_request`. The header is refused, not ignored, so a client configured for the legacy profile fails loudly instead of being silently downgraded.
3. No `Authorization: Bearer` ⇒ **401** with `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource[/path]/mcp", scope="canvas:read canvas:write"`. This is what makes Codex show **Not logged in** / **Authenticate**.
4. Token unknown, wrong type, expired, or audience ≠ `<issuer>/mcp` ⇒ **401** `error="invalid_token"`.
5. Grant missing or revoked ⇒ **401** `error="invalid_token"`.
6. Missing `canvas:read` ⇒ **403** `error="insufficient_scope"`.
7. Non-`POST` ⇒ 405 (unchanged stateless behaviour).
8. Canvas access token expiring within 60 s ⇒ refresh via `POST /login/oauth2/token` (`grant_type=refresh_token`), deduplicated per grant so concurrent requests share one refresh. Canvas answers 4xx ⇒ the Canvas authorization is gone: the grant is revoked, its tokens deleted, and the client gets **401** `invalid_token` — the "revoked at Canvas" path. Any other failure ⇒ **503** `temporarily_unavailable`, grant untouched.
9. Build a fresh `McpServer` with the **Canvas** access token, the configured base URL, the shared pseudonymizer, the configured role (with the existing `X-Canvas-Role` UX override), and `readOnly` when `canvas:write` is absent; hand the request to `StreamableHTTPServerTransport`.

The MCP token never reaches step 9. The Canvas token never leaves it.

## 9. Canvas connection

Canvas endpoints, per the Canvas OAuth2 documentation (verified 2026-09-17 against `developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints`):

| Step      | Request                                                                                                             | Notes                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| authorize | `GET {base}/login/oauth2/auth?client_id&response_type=code&redirect_uri={issuer}/oauth/canvas/callback&state&scope` | `state` = pending authorization id. `scope` only when `CANVAS_OAUTH_SCOPES` is set.        |
| exchange  | `POST {base}/login/oauth2/token` form `grant_type=authorization_code&client_id&client_secret&redirect_uri&code`     | Response: `access_token`, `refresh_token`, `expires_in` (3600), `user.id`.                  |
| refresh   | `POST {base}/login/oauth2/token` form `grant_type=refresh_token&client_id&client_secret&redirect_uri&refresh_token` | Canvas does **not** rotate refresh tokens; the same one is reused.                           |
| revoke    | `DELETE {base}/login/oauth2/token` with `Authorization: Bearer <canvas access token>`                                | Called on MCP revocation. A failure is logged and does not block the local revocation.       |

Only the Canvas user id is stored with the grant; the user's name from the token response is discarded.

Admin prerequisite (documented in `docs/oauth-profile.md`): an account-level Developer Key with redirect URI `<issuer>/oauth/canvas/callback`, state **ON**. Developer Keys are institution-scoped, which is why this profile is single-institution by construction.

## 10. Secrets discipline

- Stored: hashes of MCP tokens, codes and client secrets; Canvas tokens (encrypted at rest when the file store is used).
- Logged: grant ids, client ids, error *classes*. Never a token, code, verifier, secret, or the `Authorization` header.
- Returned to clients: OAuth error codes with generic descriptions. A Canvas exchange failure is `server_error`, not the Canvas response body.
- URLs: the MCP authorization code is the only secret ever placed in a URL, and only in the redirect the protocol requires; it is single-use and expires in five minutes.

## 11. `doctor`

`canvas-lms-mcp doctor` (alias `canvas-lms-mcp auth status`) prints the resolved profile and, for each required input, whether it is present and where it came from — never the value. It flags a base URL ending in `/api/v1` and, on stdio, states that a host OAuth badge is unavailable by design. Exit code 0 when the profile could start, 1 otherwise. The missing-token startup error now points at it.

## 12. Files

```text
src/auth/profile.ts                  AuthProfile type, parse, transport compatibility
src/auth/doctor.ts                   identity-safe diagnostics (pure) + entry
src/auth/oauth/config.ts             env → OAuthProfileConfig, all startup validation
src/auth/oauth/store.ts              OAuthStore interface, records, MemoryOAuthStore
src/auth/oauth/file-store.ts         FileOAuthStore (AES-256-GCM, atomic writes)
src/auth/oauth/crypto.ts             token minting, hashing, PKCE S256, constant-time compare
src/auth/oauth/redirect-uri.ts       registration rules + RFC 8252 loopback matching
src/auth/oauth/clients.ts            client resolution: pre-registered, DCR, CIMD
src/auth/oauth/canvas-oauth.ts       Canvas Developer Key client (authorize URL, exchange, refresh, revoke)
src/auth/oauth/authorization-server.ts  metadata, register, authorize, continue, callback, token, revoke
src/auth/oauth/resource-server.ts    bearer validation, challenges, Canvas token resolution + refresh
src/auth/oauth/html.ts               consent + error pages, escaping
src/auth/oauth/http-util.ts          form/JSON body parsing, cookies, small helpers
src/http.ts                          profile dispatch, Origin check, host binding
src/cli.ts                           --auth-profile, --host, --issuer, conditional token requirement
src/server.ts                        readOnly option
bin/canvas-lms-mcp.js                doctor / auth status dispatch
docs/oauth-profile.md                setup (Canvas admin, localhost, hosted), Codex, ChatGPT, verification matrix
```

## 13. Testing

Mocked throughout; nothing touches a real Canvas or a real host. Coverage maps one-to-one onto the acceptance criteria:

- profile parsing and transport compatibility; token optional only in `oauth_brokered`;
- issuer rules (https off-loopback, loopback bind), store key rules, client JSON rules;
- PKCE S256 verify, verifier length, `plain` rejected;
- store: single-use take, expiry purge, DCR cap, file store round trip, wrong key refuses, ciphertext contains no token;
- authorization server: every error branch listed in §7, consent page escaping, cookie binding, code reuse revoking the grant, refresh rotation, expired refresh, confidential client auth, revoke of either token type revoking the grant and calling Canvas;
- resource server: 401 challenge format for missing / invalid / expired / wrong-audience / revoked tokens, 403 insufficient scope, `X-Canvas-Token` refused, refresh on expiry, dedup, Canvas-revoked ⇒ 401, read-only server without `canvas:write`;
- end-to-end: a scripted client walks 401 → metadata → DCR → authorize → consent → Canvas → callback → token → `/mcp` → refresh → revoke → 401, asserting that `createCanvasMCPServer` only ever receives the Canvas token;
- `Origin` refusal in both HTTP profiles; `remote_static_token` regression suite unchanged;
- `doctor` output contains no configured value.

What cannot be proven here and is left to the manual matrix in `docs/oauth-profile.md`: the literal Codex UI strings and that `codex mcp login` completes against a live deployment. The end-to-end test exercises the same wire sequence Codex performs.
