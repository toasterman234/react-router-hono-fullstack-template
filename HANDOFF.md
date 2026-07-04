# Handoff — checkpoint 2026-07-04

Read this first, then `README.md` for full detail. This file is the "what's
the state right now / what's next" summary; the README is the reference doc.

## What's live right now

- Worker deployed: https://react-router-hono-fullstack-template.bencharney234.workers.dev
- Mailbox backend (`agent-mail.service`) running on the Hetzner VPS
  (`root@5.78.219.175`), fronted by a Cloudflare Tunnel at
  `agentmail.goobnut.com`.
- **Human browser access to the real upstream mailbox UI now works:**
  `https://agentmail.goobnut.com/mail` — gated by Cloudflare Access (Zero
  Trust team `crimson-cake-7134.cloudflareaccess.com`, policy "ben only",
  login via email OTP or Google, restricted to `bencharney234@gmail.com`).
- The mailbox origin (`am serve-http`) now runs with `--no-auth` — Access is
  the only auth layer left in front of it. Details/why in README §1.
- One real project + agent registered as a smoke test: project
  `root-ben-agents3`, agent `CreamAnchor` (claude-code /
  claude-sonnet-4-6), one message sent and delivered. This proves the
  pipeline works end-to-end; it is NOT real usage yet.

## What's still open (in priority order)

1. **No coding harness actually uses this mailbox day-to-day.** Next real
   step is running `am setup run` on Ben's machine(s) to auto-wire
   Claude Code / Codex / opencode so they register + send/reserve through
   it for real. Nothing has done this yet.
2. **Decide what this Worker app is actually for**, now that the upstream
   `/mail` UI is directly browsable and has compose/search/reservations
   that this Worker's custom pages don't. Either point the Worker at the
   upstream UI, or scope it down to just the `/tasks` (GitHub issues) view.
3. `GITHUB_REPOS` in `wrangler.jsonc` still points at this repo itself
   (placeholder) — point it at real repos once decided.

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
