# OAuth profile: host-visible login for Codex, ChatGPT, and other MCP hosts

The `oauth_brokered` profile turns `canvas-lms-mcp serve` into an OAuth 2.1 protected
MCP server. An MCP host that implements the MCP authorization specification (Codex,
ChatGPT, Claude, and others) shows the server as **Not logged in**, opens a browser on
`codex mcp login canvas-lms`, and afterwards calls Canvas tools on the user's behalf.
Nobody pastes a Canvas token into a config file, and the server never accepts a Canvas
token from the network.

This page covers what you need to run it, how to connect each host, and a checklist for
verifying the login states by hand.

## Which profile do I need?

| You are…                                                                 | Profile               | Command                                                        | Host shows                                   |
| ------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| one person on your own machine (Claude Desktop, Cursor, VS Code, Codex)  | `local_static_token`  | `npx canvas-lms-mcp` (default)                                 | `Auth Unsupported` in Codex, by design       |
| a developer poking an HTTP endpoint, or an app that already holds tokens | `remote_static_token` | `npx canvas-lms-mcp serve` (default)                           | no login state; `X-Canvas-Token` per request |
| connecting Codex/ChatGPT/Claude with a real login, or hosting for others | `oauth_brokered`      | `npx canvas-lms-mcp serve --auth-profile oauth_brokered`       | **Not logged in** → **Authenticate**         |

**stdio cannot show a login badge.** The MCP authorization specification applies to HTTP
transports only; stdio servers are expected to read credentials from the environment.
Codex therefore lists a stdio server as `Auth Unsupported`, and `codex mcp login` answers
"OAuth login is only supported for streamable HTTP servers". That is correct behaviour, not
a bug in this package. Use `npx canvas-lms-mcp doctor` to confirm a stdio setup has what it
needs without printing any secret.

**`remote_static_token` is self-managed only.** It is today's `serve` behaviour: the Canvas
token arrives in an `X-Canvas-Token` header or is the server's own configured token. It is
fine for a developer's experiments and for an application that already manages Canvas
tokens itself. It is the wrong choice for anything shared, because whoever can reach the
port can present any token, and Canvas's API policy forbids asking other users for
personal tokens. The OAuth profile never accepts `X-Canvas-Token`; it answers `400` to it.

## How it works

```text
Codex / MCP client
  -- MCP access token, audience = <issuer>/mcp -->
canvas-lms-mcp  (OAuth 2.1 authorization server + resource server)
  -- Canvas access token from your Developer Key, refreshed server-side -->
your Canvas institution
```

Two separate OAuth relationships, one process:

1. **MCP client ↔ this server.** The server is an OAuth 2.1 authorization server for MCP
   clients (metadata discovery, client registration, authorization code + PKCE S256,
   refresh, revocation) and the resource server for `/mcp`.
2. **This server ↔ Canvas.** Behind each login the server runs Canvas's official
   authorization-code flow with your institution's Developer Key, and stores, refreshes,
   and revokes the resulting Canvas token itself.

The MCP token and the Canvas token are different strings with different lifetimes. The
inbound MCP token is never forwarded to Canvas; the Canvas token is never returned to the
client. One login produces one Canvas token, so revoking the MCP grant revokes exactly that
Canvas token and nothing else.

## Prerequisites: a Canvas Developer Key

A Canvas admin creates one API Developer Key for the institution. Developer Keys are
account-scoped, which is why this profile serves one Canvas base URL per deployment.

1. In Canvas: **Admin → (your account) → Developer Keys → + Developer Key → + API Key**.
2. **Redirect URIs**: `<issuer>/oauth/canvas/callback`, where `<issuer>` is the public URL
   of this server. For a local run that is `http://127.0.0.1:3001/oauth/canvas/callback`;
   for a hosted deployment, `https://canvas-mcp.example.edu/oauth/canvas/callback`. Canvas
   requires the redirect's domain to match (or be a subdomain of) what the key lists.
3. **Enforce Scopes** is optional. If you turn it on, put the same scopes in
   `CANVAS_OAUTH_SCOPES` (space-separated) so the authorization request carries them.
   Without enforced scopes the token has the user's full API access, exactly like a
   personal token would.
4. Save, then set the key's state to **ON**. Note the **ID** (a long number, the
   `client_id`) and the **Key** (the `client_secret`).

Users will see Canvas's own "*App* is requesting access to your account" page on every
login, after this server's consent page.

## Configuration

All settings are server-side. None can be changed by a request.

| Variable / flag                       | Required | Meaning                                                                                                                                                                                                                                              |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANVAS_AUTH_PROFILE` / `--auth-profile` | yes   | `oauth_brokered`. (`local_static_token` and `remote_static_token` are the two static profiles.)                                                                                                                                                       |
| `CANVAS_BASE_URL` / `--base-url`      | yes      | The one Canvas institution, origin only (`https://school.instructure.com`).                                                                                                                                                                          |
| `CANVAS_MCP_ISSUER` / `--issuer`      | yes      | Public URL of this server, e.g. `http://127.0.0.1:3001` or `https://canvas-mcp.example.edu`. Must be `https` unless the host is loopback. May carry a path prefix (`https://apps.example.edu/canvas`).                                                 |
| `CANVAS_OAUTH_CLIENT_ID`              | yes      | Developer Key ID.                                                                                                                                                                                                                                    |
| `CANVAS_OAUTH_CLIENT_SECRET`          | yes      | Developer Key secret.                                                                                                                                                                                                                                |
| `CANVAS_OAUTH_SCOPES`                 | no       | Space-separated Canvas API scopes, for keys with *Enforce Scopes*.                                                                                                                                                                                   |
| `CANVAS_HTTP_HOST` / `--host`         | no       | Bind address. Defaults to `127.0.0.1` in this profile. A loopback issuer refuses a non-loopback bind.                                                                                                                                                 |
| `CANVAS_MCP_OAUTH_CLIENTS`            | no       | JSON array of pre-registered MCP clients: `[{"client_id":"…","client_name":"…","redirect_uris":["…"],"client_secret":"…"}]`. `client_secret` makes the client confidential.                                                                             |
| `CANVAS_MCP_OAUTH_DCR`                | no       | `true` (default) or `false`: dynamic client registration (RFC 7591).                                                                                                                                                                                 |
| `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS` | no       | Hostnames whose Client ID Metadata Documents are trusted. Default `chatgpt.com` (Codex). `*` trusts any `https` host; `none` disables CIMD.                                                                                                             |
| `CANVAS_MCP_OAUTH_STORE`              | no       | Path of the encrypted grant store. Unset = in-memory; every login is lost on restart.                                                                                                                                                                |
| `CANVAS_MCP_OAUTH_STORE_KEY`          | with store | Secret (16+ characters) that encrypts the store (AES-256-GCM, key derived with scrypt). Startup fails if it does not open an existing file.                                                                                                        |
| `CANVAS_API_TOKEN` / `--token`        | no       | **Ignored** in this profile, with a warning.                                                                                                                                                                                                         |
| `CANVAS_ROLE`, `CANVAS_DESTRUCTIVE_TOOLS`, FERPA settings, … | no | Work as in every other profile.                                                                                                                                                                                                                 |

Startup refuses to proceed when: the issuer is `http` on a non-loopback host; a loopback
issuer is combined with a non-loopback `--host`; a store path is set without a key, or the
key does not decrypt the file; a pre-registered client has a redirect URI that is neither
`https` nor loopback `http`.

## Running locally (Codex on the same machine)

```bash
export CANVAS_BASE_URL=https://school.instructure.com
export CANVAS_MCP_ISSUER=http://127.0.0.1:3001
export CANVAS_OAUTH_CLIENT_ID=10000000000001
export CANVAS_OAUTH_CLIENT_SECRET=…

npx canvas-lms-mcp serve --auth-profile oauth_brokered --port 3001
```

The server binds `127.0.0.1` only. Codex does not launch URL-based servers, so keep this
process running yourself (a terminal, a `launchd`/systemd user service, or a
`docker run -p 127.0.0.1:3001:3001 …`). `npx canvas-lms-mcp doctor serve --auth-profile oauth_brokered`
lists what is missing without printing any value.

## Running hosted (many users, one institution)

- Terminate TLS in front of the process (nginx, Caddy, a cloud load balancer) and set
  `CANVAS_MCP_ISSUER` to the public `https` URL. Pass the path through unchanged if the
  issuer has a prefix; the well-known documents are served in both the path-inserted and
  root forms.
- Bind the process where the proxy can reach it: `--host 127.0.0.1` behind a local proxy,
  or `--host 0.0.0.0` inside a container.
- Set `CANVAS_MCP_OAUTH_STORE` (a path on persistent storage) and
  `CANVAS_MCP_OAUTH_STORE_KEY` so logins survive restarts. The file holds Canvas refresh
  tokens; it is encrypted, mode `0600`, and written atomically. Keep the key in your secret
  manager, not in the compose file.
- Set `--allowed-origin` to the origin of any browser-based client you expect. Requests
  carrying any other `Origin` header are refused with `403`.
- Register the Developer Key's redirect URI as `https://<issuer host>/oauth/canvas/callback`.

```bash
docker run -d --name canvas-mcp \
  -p 127.0.0.1:3001:3001 \
  -v canvas-mcp-oauth:/var/lib/canvas-mcp \
  -e CANVAS_BASE_URL=https://school.instructure.com \
  -e CANVAS_AUTH_PROFILE=oauth_brokered \
  -e CANVAS_MCP_ISSUER=https://canvas-mcp.example.edu \
  -e CANVAS_HTTP_HOST=0.0.0.0 \
  -e CANVAS_OAUTH_CLIENT_ID=10000000000001 \
  -e CANVAS_OAUTH_CLIENT_SECRET=… \
  -e CANVAS_MCP_OAUTH_STORE=/var/lib/canvas-mcp/oauth-store.enc \
  -e CANVAS_MCP_OAUTH_STORE_KEY=… \
  canvas-lms-mcp
```

## Connecting Codex

Codex supports OAuth for streamable HTTP servers, including Client ID Metadata Documents
(CIMD) and Dynamic Client Registration (DCR); both are enabled here by default.

`~/.codex/config.toml`:

```toml
[mcp_servers.canvas-lms]
url = "https://canvas-mcp.example.edu/mcp"   # or http://127.0.0.1:3001/mcp locally
default_tools_approval_mode = "prompt"
```

Codex defaults to OAuth for URL servers, so `auth = "oauth"` may be added for clarity but
is not required. Then:

```bash
codex mcp list                  # canvas-lms … enabled  Not logged in
codex mcp login canvas-lms      # opens the browser
codex mcp logout canvas-lms     # back to Not logged in
```

The browser flow is: this server's consent page (naming the client and its redirect) →
Canvas sign-in and Canvas's own approval page → back to Codex. Codex then lists only the
tools the resolved role and scopes allow.

If your Codex build fails on CIMD, force dynamic registration:

```bash
codex mcp login canvas-lms --oauth-client-registration dcr
```

## Connecting ChatGPT and other hosts

Any host that implements the MCP authorization specification works the same way: give it
`<issuer>/mcp`, choose OAuth, and complete the browser login. ChatGPT (Developer mode →
Connectors → Create) discovers the authorization server from the `401` challenge and
registers dynamically. Claude Desktop and Claude Code remote MCP connections do the same.
Hosts that do not support OAuth cannot use this profile; give them a stdio configuration
instead.

## Endpoints

| Method + path                                   | Purpose                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /mcp`                                     | MCP endpoint. `Authorization: Bearer <MCP access token>` required; `X-Canvas-Token` refused with `400`.      |
| `GET /health`                                   | Liveness, unauthenticated.                                                                                  |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 protected-resource metadata.                                                                     |
| `GET /.well-known/oauth-authorization-server`   | RFC 8414 authorization-server metadata (`code_challenge_methods_supported: ["S256"]`).                      |
| `POST /oauth/register`                          | RFC 7591 dynamic client registration.                                                                       |
| `GET /oauth/authorize`                          | Consent page, then redirect to Canvas.                                                                      |
| `POST /oauth/authorize/continue`                | Consent decision (CSRF-protected form).                                                                     |
| `GET /oauth/canvas/callback`                    | Canvas redirect target; issues the MCP authorization code.                                                  |
| `POST /oauth/token`                             | `authorization_code` (PKCE S256, exact redirect URI, `resource` check) and `refresh_token` (rotating).       |
| `POST /oauth/revoke`                            | RFC 7009. Either token revokes the whole grant and the Canvas token behind it.                              |

Unauthenticated requests to `/mcp` receive:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://canvas-mcp.example.edu/.well-known/oauth-protected-resource/mcp", scope="canvas:read canvas:write"
```

## Scopes and tool visibility

| MCP scope      | Effect                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| `canvas:read`  | Required for `/mcp`. Without it: `403` with `error="insufficient_scope"`.                    |
| `canvas:write` | Without it the server registers only tools with `readOnlyHint: true`; write tools are neither listed nor callable. |

A client that requests no scope gets both. These are MCP scopes; Canvas scopes are set by
the operator in `CANVAS_OAUTH_SCOPES` and never chosen by a client. `CANVAS_ROLE` (and the
`X-Canvas-Role` header, a UX filter) narrow the list further, as in every profile.

## Token lifetimes and revocation

| Credential              | Lifetime                                | Notes                                                                  |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| MCP authorization code  | 5 minutes, single use                   | A second redemption revokes the grant (OAuth 2.1 §4.1.2).              |
| MCP access token        | 1 hour                                  | Opaque; only its SHA-256 is stored.                                    |
| MCP refresh token       | 30 days, rotated on every refresh       | Only its SHA-256 is stored.                                            |
| Canvas access token     | 1 hour (Canvas)                         | Refreshed server-side 60 s before expiry; concurrent requests share one refresh. |
| Canvas refresh token    | until revoked (Canvas does not rotate)  | Revoked via `DELETE /login/oauth2/token` when the MCP grant is revoked. |

Logout paths: `codex mcp logout` (the host drops its tokens; the server's copy expires),
`POST /oauth/revoke` with either token (immediate, and revokes at Canvas), or the user
removing the integration in Canvas (**Account → Settings → Approved Integrations**), after
which the next refresh fails and the server answers `401 invalid_token` so the host asks
for a new login.

## Security notes

- **Audience binding.** Access tokens carry the resource `<issuer>/mcp`; a token minted
  for anything else is refused. Clients send `resource=` on both authorize and token
  requests (RFC 8707).
- **PKCE S256 only.** `plain` and missing challenges are rejected.
- **Exact redirect URIs**, with the one exception RFC 8252 §7.3 requires: a loopback
  `http` redirect may present a different port than it registered, because native clients
  (Codex included) listen on an ephemeral port per login.
- **Consent per client, bound to the browser.** The consent page names the client, its
  redirect host, and the scopes; the browser that clicks *Continue* receives an `HttpOnly`
  cookie that must return on the Canvas callback. A login started by one party cannot be
  completed by another.
- **CIMD fetches are allowlisted.** The server fetches a client metadata URL only when its
  host is in `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS`; redirects are not followed and
  documents are capped at 64 KiB.
- **Nothing sensitive is logged or echoed.** Logs carry grant ids, client ids and error
  classes. Canvas error bodies are never forwarded to clients.
- **Origin check.** Any request with an `Origin` header not equal to `--allowed-origin` or
  the issuer's own origin is refused.
- Dynamic registration is open but capped (1000 clients, oldest evicted).

## Manual verification matrix

Run these against a local deployment (`http://127.0.0.1:3001`) or a hosted one. The
automated suite (`tests/http-oauth.test.ts`, `tests/auth/**`) proves the wire sequence
with a mocked Canvas; this matrix proves what a host actually shows.

| #  | Step                                                                        | Expected                                                                                          | Codex | ChatGPT | Claude |
| -- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| 1  | Start the server with no `CANVAS_API_TOKEN`                                 | Starts; log shows `Auth profile: oauth_brokered`                                                  | ☐     | ☐       | ☐      |
| 2  | `curl -i -X POST <issuer>/mcp`                                              | `401`, `WWW-Authenticate: Bearer resource_metadata=…`                                             | ☐     | ☐       | ☐      |
| 3  | `curl <issuer>/.well-known/oauth-protected-resource/mcp`                    | JSON with `authorization_servers: ["<issuer>"]`                                                   | ☐     | ☐       | ☐      |
| 4  | Add the server to the host, before any login                                | Host lists it as enabled and **Not logged in** (Codex: `codex mcp list`)                          | ☐     | ☐       | ☐      |
| 5  | `codex mcp login canvas-lms` (or the host's Authenticate action)            | Browser opens on this server's consent page naming the client and redirect                        | ☐     | ☐       | ☐      |
| 6  | Continue                                                                    | Canvas sign-in, then Canvas's approval page for the Developer Key                                 | ☐     | ☐       | ☐      |
| 7  | Approve                                                                     | Browser lands on the host's callback; host shows logged in                                        | ☐     | ☐       | ☐      |
| 8  | Ask the host to list courses                                                | Tools listed per role/scope; a Canvas call succeeds                                               | ☐     | ☐       | ☐      |
| 9  | Wait > 1 hour, call again                                                   | Still works (MCP refresh + Canvas refresh happen without user interaction)                        | ☐     | ☐       | ☐      |
| 10 | Log out from the host (`codex mcp logout canvas-lms`)                       | Host shows **Not logged in**; no project config was edited                                        | ☐     | ☐       | ☐      |
| 11 | Log in again, then remove the integration in Canvas (Approved Integrations) | Next call fails with `401 invalid_token`; host offers to authenticate again                       | ☐     | ☐       | ☐      |
| 12 | `curl -i -X POST <issuer>/mcp -H 'X-Canvas-Token: x' -H 'Authorization: Bearer …'` | `400 invalid_request`                                                                      | ☐     | ☐       | ☐      |
| 13 | stdio configuration of the same package                                     | Codex shows `Auth Unsupported`; `codex mcp login` refuses; tools still work with the PAT          | ☐     | n/a     | n/a    |

Record the host version next to each column when you run it.

## Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CANVAS_MCP_ISSUER … must use https`                                 | Non-loopback issuers require TLS. Put a TLS proxy in front, or use `127.0.0.1` for a local run.                |
| `must bind a loopback host too`                                      | A loopback issuer cannot be exposed on the network. Use an `https` issuer to host it.                          |
| Consent page says *Unknown client*                                   | The host's CIMD host is not allowlisted, or DCR is off. Add the host to `CANVAS_MCP_OAUTH_CIMD_ALLOWED_HOSTS`, or retry with DCR. |
| Canvas shows *invalid redirect_uri*                                  | The Developer Key's redirect URI must be exactly `<issuer>/oauth/canvas/callback`.                             |
| Login ends with `error=access_denied`                                | The user declined on the consent page or in Canvas, or Canvas rejected the code (key OFF, wrong secret).       |
| `This login was started in a different browser session`             | The Canvas callback arrived without the consent cookie: a different browser, or a blocked cookie. Start again. |
| Everything works until the process restarts                          | In-memory store. Set `CANVAS_MCP_OAUTH_STORE` + `CANVAS_MCP_OAUTH_STORE_KEY`.                                  |
| `403 forbidden … Origin not allowed`                                 | A browser client on an origin other than `--allowed-origin`. Set it to that origin.                            |
| Codex shows `Auth Unsupported`                                       | The entry is a stdio (`command = …`) server. Only `url = …` servers can show a login state.                    |
