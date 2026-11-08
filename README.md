# Team Chat

Slack-style team discussion app: workspaces → channels → messages with threads and reactions,
realtime delivery, unread badges, `@mentions`, and browser (Web Push) notifications.

- **Backend**: Fastify 5 + TypeScript, PostgreSQL + Drizzle ORM, WebSocket hub, JWT auth, web-push
- **Frontend**: React 19 + Vite + Tailwind v4 + TanStack Query

## Quick start (development)

```bash
cp .env.example .env
npm install
npm run gen:vapid          # writes VAPID keys into .env
npm run dev                # API (:4000) + Vite (:5173); Postgres runs as a separate service
```

In a second terminal, apply the schema and load demo data:

```bash
npm run db:push
npm run db:seed
```

Open http://localhost:5173 and sign in as `alice@example.com` or `bob@example.com` (password `password123`).

### Database

Postgres is **not** part of `npm run dev` — it runs as its own native service, independent of the
app process:

- The app uses the **local Postgres on `127.0.0.1:5432`**, database `team_chat`, user `postgres`
  (see `DATABASE_URL` in `.env`). No other cluster is created or managed by this project.
- Schema changes: `npm run db:push`; demo data: `npm run db:seed`

Manual queries go through `team-chat-db`:

```bash
team-chat-db -c 'select count(*) from messages'
team-chat-db -f path/to/queries.sql
```

On this machine the bundled `psql` cannot load (`libldap.so.2` is missing), and Docker isn't
available, so the client scripts use the app's own Node Postgres driver / the bundled `pg_dump`.

Credentials come from `~/.pgpass` (mode 600), which `team-chat-db` regenerates from `DATABASE_URL`
on every run. `~/.pgpass` is keyed to host/port/database, so connecting to a *different* database
needs `PGPASSWORD` (or its own `.pgpass` line).

Backups use `pg_dump`, not `psql` (there is no `\.dump` meta-command):

```bash
team-chat-dump                        # plain SQL -> ./team-chat-backup.sql
team-chat-dump /path/to/backup.sql
```

Restore with any working Postgres `psql` against the local server (the bundled client cannot run
here, so install the system package or use another machine's `psql`):

```bash
PGPASSWORD=… psql -h 127.0.0.1 -p 5432 -U postgres -d new_db -f team-chat-backup.sql
```

`DATABASE_URL` in `.env` points at it. To use any other Postgres (system package, managed cloud
instance, etc.), just change `DATABASE_URL` — nothing else in the app cares where it lives.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`tsx watch`) + Vite dev server (Postgres is a separate service) |
| `npm run dev:api` / `dev:web` | Run one piece |
| `npm run db:push` | Push the Drizzle schema to the database |
| `npm run db:seed` | Create demo users, workspace "Acme", channels |
| `npm run gen:vapid` | Generate Web Push keys into `.env` |
| `npm run typecheck` | TypeScript check for server and web |
| `npm run build` | Build the web app to `web/dist` |
| `npm start` | Serve API + built web app from one process |

## Sign-ups and approval

New accounts don't get into a workspace on their own. After **Sign up** they land on a waiting
screen that explains the next step and updates itself (realtime `access.changed`) — no blank page.
Sign-up requests are collected server-wide in `join_requests`.

Workspace owners and admins see a **Sign-ups** entry in the sidebar with a badge for the number of
people waiting. The dialog lists each applicant (name, handle, email, when they asked, and their
optional "Who invited you" note) with **Accept** / **Decline**:

- Accept (`POST /workspaces/:id/access-requests/:userId/approve`) adds them to that workspace as a
  member, joins them to `#general`, and the waiting tab switches straight into the app.
- Decline (`.../decline`) shows "Your sign-up wasn't approved" and blocks logging in
  (`403 SIGNUP_DECLINED`) until an admin approves them later.

Waiting users are only listed while they belong to no workspace, so approved people drop off the
list automatically.

## Direct messages

Click **+** next to "Direct messages" in the sidebar, pick a teammate, and chat 1:1. A conversation is
one pair of workspace members, so opening it again from either side reuses the same thread
(`POST /workspaces/:id/conversations` is idempotent). Only the two participants can read it — other
members get `403` and never see the conversation in their list. DMs have their own unread badges,
online presence dots, sidebar previews, and the same realtime delivery, reactions, edit/delete and
`@mention` behaviour as channels. Threads are channel-only.

## Channels and invites

The **+** next to "Channels" opens *Create a channel*: name, topic, public/private, and a member
picker to invite people right away (`POST /workspaces/:id/channels` with `memberIds`). Invitees get
the channel in their sidebar instantly (realtime `channel.created`) — this is also how private
channels are shared.

Public channels can be edited from the **Edit** button in the channel header:
- rename and topic (`PATCH /api/channels/:id`, live rename for everyone via `channel.updated`),
- invite more workspace members (`POST /api/channels/:id/members`),
- remove members (`DELETE /api/channels/:id/members/:userId`).

Private channels are not editable here — their membership is managed by whoever invites people.

## Message formatting

Messages render a safe Markdown subset (plain React nodes — no `innerHTML`):

| Syntax | Result |
| --- | --- |
| `**bold**` / `_italic_` or `*italic*` | **bold**, _italic_ |
| `~~strike~~` | ~~strike~~ |
| `` `code` `` | inline code |
| ```` ```lang ```` … ```` ``` ```` | fenced code block |
| `- item` / `1. item` | bulleted / numbered list |
| `> text` | blockquote |
| `\| a \| b \|` + `\|---\|---\|` | table |
| `https://…`, `@username` | clickable link, mention pill |

The composer has a toolbar (and `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+E`), `Enter` sends,
`Shift+Enter` adds a line, and `@` opens the member picker.

## Notifications

- **In-app**: channel unread badges, bold channel names, tab title `(n) Team Chat`, mention toast,
  bell dropdown, "Mentions & activity" view, highlighted `@mention` pills.
- **Desktop**: Preferences → Desktop notifications toggles a Web Push subscription. Pushes are sent
  only for `@mentions` and only when the user has no live WebSocket (i.e. the tab is closed).
  Web Push requires HTTPS or `localhost`.

- **Sound**: a short chime plays for every incoming message (a brighter triple chime for
  `@mentions`). Toggle it under Preferences → Message sounds; the choice is stored in the browser
  (`tc.sound`). Browsers only allow audio after a user gesture, so the first click/keypress arms it.

## Profiles and appearance

- Click any name or avatar — in a message, a mention pill, the members list, or a DM header — to
  open that person's profile card (`GET /workspaces/:id/members/:userId`): role, join date, account
  age, online status, and a **Message** button that opens the 1:1 DM.
- **Change password**: Preferences → Password verifies the current password, stores an Argon2 hash
  of the new one, revokes every refresh token (other devices are signed out) and issues a fresh
  session for the current browser. Rate limited to 10 attempts/minute.
- **Sidebar color**: Preferences → Sidebar color offers 8 presets plus a custom color picker with a
  live sample and readable text contrast. The choice is saved per browser (`tc.sidebarTheme`,
  `tc.sidebarCustom`) and also drives the accent color.

## Attachments

The composer accepts images and files via the paperclip button, drag & drop, or paste. Files are
streamed to `POST /api/attachments` (max 25 MB each, 10 per message — `UPLOAD_MAX_MB` in `.env`),
stored under `UPLOAD_DIR` (`server/uploads`, gitignored), then linked to the message by
`attachmentIds` when it is sent. Images render as thumbnails with a lightbox; other files render as
download chips. Downloads go through `GET /api/attachments/:id`, which checks that the viewer is a
member of the message's channel/DM, sends `X-Content-Type-Options: nosniff`, and forces a download
for anything that is not an inline-safe image or PDF. Uploads that are removed before sending are
deleted. Use object storage (e.g. S3) and a shared `UPLOAD_DIR` volume when running multiple API
instances.

## Production notes

Set `NODE_ENV=production`, a strong `JWT_SECRET`, real `VAPID_*` keys, `APP_URL` (used in push
deep links), and `DATABASE_URL`. Then:

```bash
npm ci && npm run db:push && npm run build && npm start
```

Vite's dev proxy drops WebSocket upgrades, so in development the client connects straight to the
API origin (`VITE_API_URL`, default `http://localhost:4000`). In production everything shares one origin.
