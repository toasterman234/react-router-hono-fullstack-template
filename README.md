# Agent Inbox / Task App

A Cloudflare Worker (Hono + React Router) that gives Ben a web UI over two
things: an **mcp-agent-mail** mailbox running on a Hetzner VPS, and open
**GitHub issues** treated as a task queue. Originally scaffolded from
Cloudflare's `react-router-hono-fullstack-template`; the template's default
welcome page has been replaced with real functionality.

**Live app:** https://react-router-hono-fullstack-template.bencharney234.workers.dev
**Upstream mailbox UI (human-facing, richer than this Worker's pages):**
https://agentmail.goobnut.com/mail — gated by Cloudflare Access, see §1.
**Repo:** `toasterman234/react-router-hono-fullstack-template`

This doc exists so a different agent (or Ben, later) can pick this up without
re-deriving any of the infrastructure decisions below. See also `HANDOFF.md`
for the short version / where things were left off.

---

## System map

```
Cloudflare Worker (edge)                    Hetzner VPS  root@5.78.219.175
react-router-hono-fullstack-template        (hostname: hermes-usw-cpx21-01)

  /        (inbox page)                     systemd services:
  /tasks   (tasks page)                       - agent-mail.service    :8765
                                                 (mcp-agent-mail, Rust,
  GET /api/inbox  ───────HTTPS tunnel────▶       --no-auth, see §1)
                         (agentmail.            - cloudflared.service
                          goobnut.com,             (tunnel: agent-mail-vps)
                          Access-gated)         - sh.executor.daemon.service :4789
                                                 (executor.sh, own instance,
  GET /api/tasks  ───────HTTPS───────▶        separate from Ben's Mac one)
        │
        ▼
  api.github.com

Human browser ──HTTPS──▶ Cloudflare Access (login) ──▶ agentmail.goobnut.com/mail
                          (email OTP or Google OAuth,
                           policy "ben only")
```

The Worker never talks to the VPS directly on a raw IP/port — it goes through
a public hostname (`agentmail.goobnut.com`) backed by a Cloudflare Tunnel,
because Workers run on Cloudflare's edge, not near the VPS, and mail-mail is
bound to `127.0.0.1` for security. The Worker's own two REST proxy routes
(`/api/inbox`, `/api/projects/:project/agents`) and a human clicking around
the upstream `/mail` UI in a browser are two **separate** paths into the same
tunnel — see §1 for how each is authenticated.

---

## 1. Hetzner VPS (`root@5.78.219.175`)

This is the same VPS that already ran **Hermes** (a separate long-running
agent, Discord-facing — see `context/hermes.md` in ben-agents3 if you have
access to that repo). Do not touch Hermes' own service (`hermes-gateway`)
while working here.

### Removed
- **Aithy** (`aithy.service`, was on Tailscale `100.71.242.6:3000`) — fully
  deleted: service file, `/opt/aithy`, `/root/.config/aithy`, tmp settings
  dirs. Nothing to restore; this was intentional and irreversible.

### `mcp-agent-mail` (Rust) — the mailbox
- Installed via the official prebuilt-binary installer (no Rust toolchain
  needed): `curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/mcp_agent_mail_rust/main/install.sh | bash -s -- --system --verify`
- Binaries: `/usr/local/bin/am` (CLI) and `/usr/local/bin/mcp-agent-mail`
- Runs as a **system-level** systemd unit (not the installer's default
  per-user unit — we rewrote it): `/etc/systemd/system/agent-mail.service`
  - `ExecStart`: `am serve-http --host 127.0.0.1 --port 8765 --no-tui --no-auth`
  - **`--no-auth` was added after Cloudflare Access went live in front of the
    tunnel (see below).** The unit's `HTTP_BEARER_TOKEN=` env var is still
    set but is now **vestigial** — `--no-auth` disables the app's own bearer
    check entirely, so that value isn't enforced anymore. This is safe only
    because: (a) the port is bound to `127.0.0.1`, unreachable except
    through the tunnel, and (b) the tunnel's public hostname is now gated by
    Cloudflare Access (Google/email-OTP login), which is the sole remaining
    auth layer. If Access is ever removed, re-add the bearer token
    (drop `--no-auth`) before that happens, not after.
  - `HTTP_ALLOWED_HOSTS=agentmail.goobnut.com,127.0.0.1,localhost` — **required**,
    otherwise requests arriving via the tunnel get a 421 (mail-mail rejects
    unrecognized `Host` headers by default)
  - Storage: SQLite + git-backed archive at
    `/root/.local/share/mcp-agent-mail/git_mailbox_repo/`
- Manage it: `systemctl {status,restart,stop} agent-mail.service`,
  `journalctl -u agent-mail.service`
- **Current state: no longer empty.** One real project/agent were registered
  to prove the pipeline end-to-end:
  - Project: `root-ben-agents3` (human_key `/root/ben-agents3`, slug
    `root-ben-agents3`, id `1`)
  - Agent: `CreamAnchor` (program `claude-code`, model `claude-sonnet-4-6`,
    id `1`) — registered via `am macros start-session`, which is the
    "boot a session" macro (ensures the project exists, registers the
    agent, optionally reserves files, fetches inbox — all in one call).
    **Agent names are auto-generated adjective+noun pairs by design** (the
    CLI rejects descriptive names like `--agent-name BenTest` on purpose —
    don't try to force a custom name).
  - One test message was sent and delivered (`am mail send`, subject
    "setup check") confirming register → send → deliver works end-to-end.
  - This is still just a smoke test, not real usage — no coding harness is
    actually registering/sending through this mailbox day-to-day yet (see
    §4 next steps).
- Gotcha we hit: the installer's own auto-generated systemd **user** unit
  failed (`systemctl --user`), and separately left an orphaned background
  process holding the port. We killed the orphan and replaced it with a
  proper system unit. If you ever re-run the installer, expect it to try the
  same thing again — check `ps aux | grep serve-http` for orphans before
  restarting the systemd unit.

### `executor.sh` — tool-call gateway (Rhys Sullivan / YC, NOT Anthropic)
- Installed via `npm install -g executor` (Node 22 already on the VPS)
- Runs as a systemd **user** unit (this one wasn't converted to system-level):
  `sh.executor.daemon.service`, installed via `executor install --port 4789`
  — for this to survive reboot without an active login session,
  `loginctl enable-linger root` was run (confirmed `Linger=yes`)
- Data dir: `/root/.executor/` (own SQLite DB, own secrets — **completely
  separate** from Ben's Mac executor instance at `~/.executor/`; they do not
  share connections, and we deliberately did not clone one into the other)
- Web UI: reachable by tunneling `ssh -L 4790:127.0.0.1:4789 root@5.78.219.175`
  then opening `http://localhost:4790`. The UI's own access token lives at
  `/root/.executor/server-control/auth.json` on the VPS.
- **Connections configured** (both verified with live API calls, not just
  saved-and-untested):
  - `cloudflare_api` (integration slug), connection name `hetznervps`,
    auth via **Bearer Token** method (a scoped Cloudflare API token — NOT
    the legacy Global API Key/email scheme). Token permissions: Workers
    Scripts Edit, Workers KV Edit, Pages Edit, Cloudflare Tunnel Edit,
    Zone DNS Edit (scoped to the `goobnut.com` zone + this Cloudflare
    account only).
  - `github_v3_rest_api`, connection name `github`, auth via Bearer Token
    (a GitHub PAT). REST, not GraphQL.
  - Health-check on both connections was set to **"None"** — the default
    health-check op (`user.userUserDetails` / `GET /user`) fails for scoped
    tokens that lack user-level permissions; this is expected, not a real
    problem, and doesn't affect the connection's actual usability.
- Call tools from the VPS shell: `executor call <path> '<json args>'`,
  or search first: `executor tools search "<query>"`.

### Cloudflare Tunnel — `agent-mail-vps`
- Created via the Cloudflare Zero Trust dashboard (Networks → Tunnels), not
  the API — tunnel creation requires **Zero Trust to be enabled on the
  account**, which was a one-time prerequisite we had to walk through first
  (Cloudflare dashboard → Zero Trust → Enable → pick a plan/team name).
  Without that, the Tunnel API returns a generic, misleading
  `10000: Authentication error` no matter what token permissions you have —
  if you see that error again on a *different* Cloudflare account, check
  Zero Trust enablement before assuming it's a token/scope problem.
- Connector runs as a systemd service on the VPS: `cloudflared.service`
  (installed via `cloudflared service install <tunnel-token>`)
- **Public Hostname route**: `agentmail.goobnut.com` → `http://127.0.0.1:8765`
  (published application, not private hostname — Workers run on Cloudflare's
  edge, not as a WARP-connected device, so private hostnames wouldn't be
  reachable from a Worker)
- DNS: CNAME `agentmail.goobnut.com` → `<tunnel-id>.cfargotunnel.com`
  (auto-created by the dashboard flow)
- Zone: `goobnut.com` is the only zone on this Cloudflare account (also hosts
  the separate `daemon` Pages project — unrelated to this app)

### Cloudflare Access — human login for `/mail`
Added so a human (Ben) can browse the upstream mail-mail UI directly, instead
of only reading it through the Worker's thin REST proxy.

- **Team domain:** `crimson-cake-7134.cloudflareaccess.com`
- **Application:** self-hosted app for hostname `agentmail.goobnut.com`
  (Zero Trust dashboard → Access → Applications). **This must be a real
  Access "Application," not just a saved policy** — a policy with no
  application attached (`Used by applications: --`) does nothing; this bit
  us once, see gotcha below.
- **Policy:** `ben only` — Action: Allow, Include: Emails
  = `bencharney234@gmail.com`. Login can go through email OTP or "Sign in
  with Google" (both satisfy the email-match rule); no MFA/device posture
  configured beyond that.
- **Why `--no-auth` on the origin (above):** Access authenticates the human
  at the edge and forwards the request on; it does **not** know or forward
  mail-mail's own bearer token. With both layers on, a logged-in human still
  hit the app's internal 401 page after passing Access — so the origin's own
  check had to come off once Access became the real gate.
- **Gotcha — query-param token auth before Access existed:** mail-mail's
  browser pages support `?token=<bearer>` in the URL as a login mechanism,
  and the page's own JS rewrites internal `<a href>` clicks to carry that
  token forward. But that JS rewrite only fires on same-tab clicks — opening
  a link in a new tab (cmd/ctrl-click) uses the raw `href` with no token and
  404s into the app's 401 page. This is why we moved to Access instead of
  just handing out a `?token=...` link.
- **Gotcha — policy vs. application:** creating an Access *policy* by itself
  (Zero Trust → Access → Policies → Add) does not protect anything on its
  own. It must be attached to an *Application* (Zero Trust → Access →
  Applications → Add an application → Self-hosted → pick the existing policy
  on the policy step). If you ever see Access seemingly "not working" (origin
  serves requests unauthenticated, or you get straight to the app's own
  401 instead of a Cloudflare login redirect), check the policy's
  "Used by applications" field first — if it says `--`, that's the bug.
- **Also do NOT** use the tunnel's own "Networks → Tunnels → Public
  Hostname → Add" screen to try to add Access-style protection — that
  screen creates/edits a *tunnel route* (which `agentmail.goobnut.com`
  already has), not an Access application. It looks superficially similar
  (asks for subdomain/domain/path) but has a "Service URL" field Access
  applications don't, and using it risks creating a duplicate/conflicting
  route for the same hostname.

---

## 2. This Worker app

### Routes (`app/routes.ts`)
- `/` → `app/routes/inbox.tsx` — unified inbox across all mail-mail projects
- `/tasks` → `app/routes/tasks.tsx` — open GitHub issues as a task list

### Backend API (`workers/app.ts`, Hono)
- `GET /api/inbox` — proxies `${AGENT_MAIL_URL}/mail/api/unified-inbox` with
  the bearer token attached server-side (token never reaches the client).
  Note: this token is sent to the *origin*, which now runs `--no-auth` (see
  §1) so the origin ignores it — harmless to keep sending, but it is no
  longer doing any gating. The Worker's own secret rotation story (below)
  is unaffected either way.
- `GET /api/projects/:project/agents` — proxies
  `${AGENT_MAIL_URL}/mail/api/projects/{project}/agents` (defined, not yet
  used by any page — available for a future per-project view)
- `GET /api/tasks` — fetches open issues (non-PR) from each repo listed in
  `GITHUB_REPOS`, directly against `api.github.com` using `GITHUB_TOKEN`
- `GET *` — falls through to React Router SSR (the original template behavior)

### Config (`wrangler.jsonc`)
- `vars.AGENT_MAIL_URL` = `https://agentmail.goobnut.com`
- `vars.GITHUB_REPOS` = `toasterman234/react-router-hono-fullstack-template`
  (comma-separated if you want to track more repos — **this is almost
  certainly the first thing to change**, since right now it only tracks its
  own repo, which has no open issues)

### Secrets (set via `wrangler secret put`, not in any file)
- `AGENT_MAIL_TOKEN` — same bearer token as the VPS's `agent-mail.service`
  unit file. No longer enforced by the origin (`--no-auth`, see §1) but the
  Worker still sends it; leave as-is unless you also revert `--no-auth`.
- `GITHUB_TOKEN` — a **separate**, narrowly-scoped GitHub fine-grained PAT
  (Issues: Read-only). This is intentionally NOT the same credential as the
  VPS executor's GitHub connection — different trust boundary, different
  purpose (this one is public-edge-reachable code, so it's scoped minimally).

To rotate/inspect secrets: `npx wrangler secret list` (names only, values are
never retrievable — re-run `wrangler secret put NAME` to rotate).

### Deploying
```bash
npm install
npm run typecheck   # wrangler types + react-router typegen + tsc -b
npm run deploy       # react-router build && wrangler deploy
```
Needs `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit is sufficient) and
`CLOUDFLARE_ACCOUNT_ID=fa9b6cd4633ac54da1f63fb03ba45600` in the environment.
Note: `wrangler secret put` specifically also needs `CLOUDFLARE_ACCOUNT_ID`
set explicitly, or it 400s on an internal `/memberships` lookup that some
scoped tokens can't make.

---

## 3. What's NOT built yet (real gaps, not oversights)

`mcp-agent-mail`'s Rust HTTP server only exposes **three** JSON endpoints
under `/mail/api/`: `unified-inbox`, `projects/{project}/agents`, and a
sibling-suggestion POST. Everything else — sending a message, creating/
listing file reservations (advisory locks), reading a specific thread — only
exists through the **MCP JSON-RPC interface** (`POST /api/` on the mail-mail
server, tool-call protocol), not plain REST. This means:

- **No compose/send UI in this Worker** — would require the Worker to speak
  MCP JSON-RPC (a `tools/call` request body) to mail-mail, not just
  `fetch()` a REST path. (The upstream `/mail` web UI, now reachable
  directly at https://agentmail.goobnut.com/mail via Cloudflare Access, DOES
  have compose/search/reservations built in — see §1 — so this gap only
  applies to the custom Worker pages, not to the mailbox as a whole.)
- **No file-reservation view in this Worker** — same limitation; the
  upstream `/mail` UI has one, this Worker doesn't.
- **`/mail/api/locks`** exists but is **not** the file-reservation concept —
  it returns raw OS-level lock *files* (SQLite/search-index locks), which is
  a different, lower-level thing. Don't wire this up thinking it's the
  advisory-lease feature; it isn't.
- **No live-updating dashboard** — everything here is server-rendered on
  each page load (React Router loaders), no polling/websockets. The upstream
  Rust project's own docs mark a live browser dashboard as explicitly
  deferred/unsupported, so there's no existing reference to build against.
- **No coding harness actually uses the mailbox day-to-day yet** — the one
  agent/message in it (§1) is a smoke test, not real multi-agent
  coordination. Nothing runs `am setup run` locally yet to wire Claude
  Code / Codex / opencode to register and send through it automatically.

## 4. Natural next steps

1. **Wire real harnesses in**: run `am setup run` on Ben's Mac Mini (and any
   other machine running coding agents) to auto-detect installed agents and
   write their MCP config so they register/send/reserve through this
   mailbox for real, instead of the one-off smoke-test agent in §1.
2. Point `GITHUB_REPOS` at whatever repos actually have Ben's real task
   backlog (right now it's a placeholder pointing at itself).
3. Decide the Worker's fate now that the upstream `/mail` UI is directly
   browsable: either point/redirect this Worker's pages at
   `https://agentmail.goobnut.com/mail` instead of maintaining a parallel
   thinner UI, or keep this Worker strictly for the `/tasks` (GitHub) view
   and drop the inbox-duplication attempt.
4. If compose/reservations are still wanted *inside this Worker* (rather
   than sending people to the upstream `/mail` UI): implement a small MCP
   JSON-RPC client in `workers/app.ts` (`POST` to `${AGENT_MAIL_URL}/api/`
   with a `tools/call` envelope) rather than expecting a REST shortcut —
   there isn't one.
