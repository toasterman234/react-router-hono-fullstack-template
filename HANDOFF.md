# Handoff — checkpoint 2026-07-04 (later session)

Read this first, then `README.md` for full detail. This file is the "what's
the state right now / what's next" summary; the README is the reference doc.

## What's live right now

- Worker deployed: https://react-router-hono-fullstack-template.bencharney234.workers.dev
- **`/tasks` is now a combined dashboard**, not just GitHub issues: Open
  Issues (from `toasterman234/life-os`), Mail Inbox, Agent Directory (by
  project), Search, and Compose — all on one page. `/` still has the older
  standalone inbox view.
- Mailbox backend (`agent-mail.service`) running on the Hetzner VPS
  (`root@5.78.219.175`), fronted by a Cloudflare Tunnel at
  `agentmail.goobnut.com`, gated by Cloudflare Access (Zero Trust team
  `crimson-cake-7134.cloudflareaccess.com`, policy "ben only").
- **Correction to the previous handoff:** the origin does **not** run
  `--no-auth` anymore — it requires the bearer token again (see
  `projects/personal/agent-mail-vps/CONTEXT.md` "Gotcha 1" in ben-agents3).
  Every call to `agentmail.goobnut.com` — REST or MCP — needs **both** the
  `CF-Access-Client-Id`/`CF-Access-Client-Secret` service-token headers
  *and* `Authorization: Bearer <AGENT_MAIL_TOKEN>`. Missing either one
  fails (302 redirect to Access login without the CF-Access headers, 401
  from the origin without the bearer token).
- 6 real projects seeded, 2 real agents registered: `CreamAnchor`
  (project `root-ben-agents3`) and `ProudCardinal` (project
  `users-bencharney-...-life-os`). A handful of real test messages have
  been sent and verified end-to-end (search + compose both confirmed
  against the raw sqlite database, not just "no error returned").

## What changed this session (2026-07-04, later)

Built out full mail functionality inside `/tasks` and found/fixed **3 real,
pre-existing bugs** in the process — none of these were caused by the new
feature work, they were latent since the original template was adapted:

1. **`/api/inbox` and `/api/projects/:project/agents` never sent the
   Cloudflare Access service-token headers**, only the app's own bearer
   token. Since the whole hostname sits behind Access, these routes were
   silently redirected to the Access login page and always returned empty
   data. Fixed by adding `CF-Access-Client-Id`/`CF-Access-Client-Secret` to
   every outbound call (two new Worker secrets, same values the Mac
   harnesses already use).
2. **Pages self-fetched their own `/api/*` routes and got 404s.** A
   same-worker subrequest to this Worker's own `workers.dev` URL does not
   loop back through Hono's router — it 404s. Fixed by extracting the
   mcp-agent-mail/GitHub calls into `app/lib/agent-mail.server.ts` and
   having loaders/actions call them directly via `context.cloudflare.env`
   instead of hairpinning over HTTP. The `/api/*` routes in
   `workers/app.ts` now just wrap the same helpers, kept for external
   consumers/debugging via curl.
3. **The Hono catch-all (`app.get("*", ...)`) only matched `GET`,** so any
   React Router route `action` (a form `POST`) 404'd before even reaching
   the SSR handler. This silently broke the new compose form. Fixed by
   switching to `app.all("*", ...)`.

Also found (and fixed by restarting `agent-mail.service`) a **server-side
staleness bug**: right after a period of heavy read/write activity, the
mail server's MCP JSON-RPC interface (used for search/send) couldn't see an
agent that the REST interface and the raw database both confirmed existed.
A clean `systemctl restart agent-mail.service` resolved it. If compose or
search ever silently fail again (no error, but nothing shows up in the
DB/search results), suspect this same MCP-vs-REST divergence first —
verify against the raw sqlite database
(`/root/.local/share/mcp-agent-mail/git_mailbox_repo/storage.sqlite3` on
the VPS) before assuming the Worker code regressed.

New Worker secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (same
values as `~/.config/agent-mail-mcp/agent-mail-mcp.env` on Ben's Mac).
New `wrangler.jsonc` var: `AGENT_MAIL_PROJECTS` (comma-separated project
**slugs**, not human_key paths — the REST agents-list endpoint rejects
paths with separators).

## What's still open (in priority order)

1. **No coding harness actually uses this mailbox day-to-day** for real
   multi-agent coordination — the registered agents/messages are still
   smoke tests (now somewhat richer smoke tests than before). Running
   `am setup run` on Ben's machine(s) to auto-wire Claude Code/Codex/
   opencode is still not done.
2. `/tasks` compose only sends plain messages (to/subject/body) — no
   thread replies, no ack-required, no CC/BCC, no file reservations. The
   upstream `/mail` UI still has more mailbox features than this Worker.
3. If `mcp-agent-mail` is ever upgraded and its own MCP-vs-REST divergence
   bug is fixed upstream, no Worker-side change is needed — just note it
   here.

## Traps for whoever picks this up next

- Don't try to protect `agentmail.goobnut.com` via
  **Networks → Tunnels → Public Hostname → Add** in the Cloudflare
  dashboard — that creates/edits a tunnel *route*, not an Access
  application, and risks a duplicate route for a hostname that's already
  published. Access setup lives under **Access → Applications**.
- An Access **policy** with no application attached does nothing
  ("Used by applications: --" in its overview page). If login stops
  working, check that first before assuming DNS/tunnel/origin is broken.
- `am` (mcp-agent-mail CLI) rejects descriptive `--agent-name` values on
  purpose — agent names must be auto-generated adjective+noun pairs.
- Bearer-token-in-URL (`?token=...`) auth (the mailbox's own scheme, now
  superseded by Access for browser use) only propagates across same-tab
  link clicks via page JS — new tabs lose it and 401. Not a bug to "fix,"
  just why Access was introduced instead.
- **Any new outbound call to `agentmail.goobnut.com` needs all 3 headers**
  (CF-Access-Client-Id, CF-Access-Client-Secret, Authorization Bearer) —
  see `agentMailHeaders()` in `app/lib/agent-mail.server.ts`. It's easy to
  copy an old snippet that's missing one and get a confusing 302/401.
- **Never self-fetch this Worker's own `/api/*` routes from a loader/
  action** — call the helpers in `app/lib/agent-mail.server.ts` directly
  via `context.cloudflare.env` instead. See bug #2 above.
- Project keys in `AGENT_MAIL_PROJECTS` (`wrangler.jsonc`) are **slugs**
  (e.g. `users-bencharney-ben-agents3`), not the raw absolute path used
  with `ensure_project`. The REST agents-list endpoint 500s on a path with
  slashes.
