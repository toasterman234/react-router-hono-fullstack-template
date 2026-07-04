# Agent Inbox / Task App

A Cloudflare Worker (Hono + React Router) that gives Ben a web UI over two
things: an **mcp-agent-mail** mailbox running on a Hetzner VPS, and open
**GitHub issues** treated as a task queue. Originally scaffolded from
Cloudflare's `react-router-hono-fullstack-template`; the template's default
welcome page has been replaced with real functionality.

**Live app:** https://react-router-hono-fullstack-template.bencharney234.workers.dev
**Repo:** `toasterman234/react-router-hono-fullstack-template`

This doc exists so a different agent (or Ben, later) can pick this up without
re-deriving any of the infrastructure decisions below.

---

## System map

```
Cloudflare Worker (edge)                    Hetzner VPS  root@5.78.219.175
react-router-hono-fullstack-template        (hostname: hermes-usw-cpx21-01)

  /        (inbox page)                     systemd services:
  /tasks   (tasks page)                       - agent-mail.service    :8765
                                                 (mcp-agent-mail, Rust)
  GET /api/inbox  ───────HTTPS tunnel────▶     - cloudflared.service
                         (agentmail.               (tunnel: agent-mail-vps)
                          goobnut.com)         - sh.executor.daemon.service :4789
                                                 (executor.sh, own instance,
  GET /api/tasks  ───────HTTPS───────▶        separate from Ben's Mac one)
        │
        ▼
  api.github.com
```

The Worker never talks to the VPS directly on a raw IP/port — it goes through
a public hostname (`agentmail.goobnut.com`) backed by a Cloudflare Tunnel,
because Workers run on Cloudflare's edge, not near the VPS, and mail-mail is
bound to `127.0.0.1` for security.

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
  - `ExecStart`: `am serve-http --host 127.0.0.1 --port 8765 --no-tui`
  - `HTTP_BEARER_TOKEN`: set in the unit file's `Environment=` lines (do not
    print it in logs/docs — read it directly from the unit file on the VPS
    if you need it: `systemctl cat agent-mail.service`)
  - `HTTP_ALLOWED_HOSTS=agentmail.goobnut.com,127.0.0.1,localhost` — **required**,
    otherwise requests arriving via the tunnel get a 421 (mail-mail rejects
    unrecognized `Host` headers by default)
  - Storage: SQLite + git-backed archive at
    `/root/.local/share/mcp-agent-mail/git_mailbox_repo/`
- Manage it: `systemctl {status,restart,stop} agent-mail.service`,
  `journalctl -u agent-mail.service`
- **Current state (as of this writing): empty.** `project_count: 0`,
  `message_count: 0` — no agents have registered with it yet. That's expected,
  not a bug. The web app's empty states reflect this honestly.
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

---

## 2. This Worker app

### Routes (`app/routes.ts`)
- `/` → `app/routes/inbox.tsx` — unified inbox across all mail-mail projects
- `/tasks` → `app/routes/tasks.tsx` — open GitHub issues as a task list

### Backend API (`workers/app.ts`, Hono)
- `GET /api/inbox` — proxies `${AGENT_MAIL_URL}/mail/api/unified-inbox` with
  the bearer token attached server-side (token never reaches the client)
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

- **No compose/send UI** — would require the Worker to speak MCP JSON-RPC
  (a `tools/call` request body) to mail-mail, not just `fetch()` a REST path.
- **No file-reservation view** — same limitation; reservations are
  MCP-tool-only (`crates/mcp-agent-mail-tools/src/reservations.rs` in the
  Rust source), no HTTP JSON route exists for them.
- **`/mail/api/locks`** exists but is **not** the file-reservation concept —
  it returns raw OS-level lock *files* (SQLite/search-index locks), which is
  a different, lower-level thing. Don't wire this up thinking it's the
  advisory-lease feature; it isn't.
- **No live-updating dashboard** — everything here is server-rendered on
  each page load (React Router loaders), no polling/websockets. The upstream
  Rust project's own docs mark a live browser dashboard as explicitly
  deferred/unsupported, so there's no existing reference to build against.
- **Single-tenant auth** — the whole app has no login of its own; it's
  gated only by whoever can reach the Worker URL. Fine for Ben as sole
  operator, not fine if this needs to support multiple people.

## 4. Natural next steps

1. Point `GITHUB_REPOS` at whatever repos actually have Ben's real task
   backlog (right now it's a placeholder pointing at itself).
2. Get at least one real agent registered with `mcp-agent-mail` (via its MCP
   tools) so the inbox has real data to render and display formatting can
   be checked against real messages, not just the empty state.
3. If compose/reservations are wanted in the UI: implement a small MCP
   JSON-RPC client in `workers/app.ts` (`POST` to
   `${AGENT_MAIL_URL}/api/` with a `tools/call` envelope) rather than
   expecting a REST shortcut — there isn't one.
