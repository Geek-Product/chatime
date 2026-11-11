# Team Chat

A Slack-style team discussion app. Workspaces contain channels and 1:1 direct messages; messages
support threads, reactions, mentions, attachments, and Markdown. Everything is delivered in realtime,
with unread badges and browser (Web Push) notifications.

## Stack

| Layer | Technologies |
| --- | --- |
| **Backend** | Node.js, Fastify 5, TypeScript, Zod (validation), Drizzle ORM |
| **Database** | PostgreSQL (schema in `server/src/db/schema.ts`, SQL in `server/scripts/schema.sql`) |
| **Realtime** | `@fastify/websocket` hub (presence, fan-out, 30 s heartbeat) |
| **Auth** | JWT access tokens (`jose`) + rotating refresh tokens in an HttpOnly cookie, Argon2 password hashes |
| **Files** | `@fastify/multipart` uploads to disk, permission-checked downloads |
| **Push** | `web-push` with VAPID keys + a service worker |
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4 |
| **Client data** | TanStack Query, React Router 7, sonner (toasts), lucide-react (icons) |
| **Tooling** | npm workspaces, `tsx` (dev runner), `concurrently` |

Requires: **Node.js 24.22.2+** (LTS), **PostgreSQL 14+** (running separately — see [Database](#database)).

## Quick start

```bash
cp .env.example .env     # then point DATABASE_URL at your Postgres
npm install
npm run gen:vapid        # writes VAPID keys into .env (needed for desktop notifications)
npm run dev              # API on :4000 + Vite on :5173
```

In a second terminal, once Postgres is up (the exported `DATABASE_URL` is the one from `.env`):

```bash
set -a; . ./.env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/schema.sql   # create tables (see Database)
npm run db:seed          # demo users, workspace "Acme", channels
```

Open http://localhost:5173 and sign in as `alice@example.com` or `bob@example.com` (password
`password123`; `carol@example.com` works too, seeded as a regular member).

## Project layout

```
team-chat/
├── package.json              # npm workspaces (server, web) + top-level scripts
├── .env.example              # all configuration, documented
│
├── server/                   # Fastify API + WebSocket
│   ├── env.ts                # Zod-validated process.env (loaded from ../.env)
│   ├── drizzle.config.ts
│   ├── scripts/
│   │   ├── seed.ts           # demo data
│   │   └── gen-vapid.ts      # writes VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env
│   ├── src/
│   │   ├── index.ts          # entrypoint, graceful shutdown
│   │   ├── app.ts            # plugins, error handler, route registration, SPA serving
│   │   ├── db/
│   │   │   ├── schema.ts     # tables, enums, relations (single source of truth)
│   │   │   └── index.ts      # postgres client + Drizzle instance
│   │   ├── lib/              # domain logic shared by routes
│   │   │   ├── auth.ts       # JWT issue/verify, Argon2 hashing
│   │   │   ├── access.ts     # workspace/channel membership checks
│   │   │   ├── access-status.ts
│   │   │   ├── chat.ts       # channel message history/listing
│   │   │   ├── conversations.ts
│   │   │   ├── messages.ts   # create/edit/delete, mentions, broadcasting
│   │   │   ├── targets.ts    # resolve a message to its channel/DM audience
│   │   │   ├── hub.ts        # WebSocket registry, presence, fan-out
│   │   │   ├── unread.ts     # unread counts and last-read tracking
│   │   │   ├── attachments.ts
│   │   │   ├── push.ts       # Web Push delivery
│   │   │   ├── webhooks.ts   # bot users, token URLs, payload → Markdown rendering
│   │   │   └── errors.ts     # HttpError
│   │   ├── routes/           # HTTP endpoints + /ws, all mounted under /api
│   │   │   ├── auth.ts          channels.ts   conversations.ts  messages.ts
│   │   │   ├── notifications.ts push.ts       attachments.ts    workspaces.ts
│   │   │   ├── access.ts        ws.ts         webhooks.ts
│   │   └── types.d.ts        # Fastify decorators
│   └── uploads/              # attachment storage (gitignored; path = UPLOAD_DIR)
│
└── web/                      # React single-page app
    ├── vite.config.ts        # dev server :5173, proxies /api → :4000
    ├── public/sw.js          # service worker (Web Push)
    └── src/
        ├── main.tsx          # providers: Query, Auth, Router, Theme, Profile
        ├── App.tsx           # routes: /login, /welcome, /w/:wsId/(c|d)/:id, /mentions
        ├── pages/
        │   ├── ChatLayout.tsx       # main app shell
        │   ├── LoginPage.tsx        # sign in / sign up
        │   ├── AccessPendingPage.tsx# waiting-for-approval screen
        │   └── MentionsView.tsx
        ├── components/       # Sidebar, MessageList/Item/Text, Composer, ThreadPanel,
        │                     # SettingsModal, MemberPicker, SignupsDialog, …
        └── lib/
            ├── api.ts        # fetch wrapper, token refresh, typed helpers
            ├── socket.ts     # WebSocket client (API origin in dev, same origin in prod)
            ├── useRealtime.tsx + usePresence / useAccessSocket
            ├── auth-context.tsx, profile.tsx, theme.tsx, profile-settings.ts
            ├── push.ts, sound.ts, presence.ts
            ├── types.ts      # shared client-side types
            └── useDismiss.ts
```

## Scripts

Run from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`tsx watch`) + Vite, side by side |
| `npm run dev:api` / `dev:web` | Run just one of them |
| `npm run db:push` | Generate/apply schema via Drizzle Kit (does not work with the pinned `drizzle-kit`) |
| `npm run db:seed` | Create demo users, workspace "Acme", channels |
| `npm run gen:vapid` | Generate Web Push keys into `.env` |
| `npm run typecheck` | TypeScript check for web and server |
| `npm run build` | Build the web app to `web/dist` |
| `npm start` | Serve API + built web app from a single process |

## Configuration

All settings live in the root `.env` (see `.env.example`); the server validates them with Zod at boot.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin allowed in development |
| `APP_URL` | `http://localhost:5173` | Base URL used in push notification deep links |
| `NODE_ENV` | `development` | In `production`, the API also serves `web/dist` |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/team_chat` | Postgres connection |
| `UPLOAD_DIR` | `server/uploads` | Attachment storage directory |
| `UPLOAD_MAX_MB` | `25` | Max size per uploaded file (1–100) |
| `JWT_SECRET` | dev placeholder | Access-token signing key (min. 16 chars) |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh-token lifetime |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | — | Web Push credentials |

Optional: `VITE_API_URL` (default `http://localhost:4000`) tells the dev client which API origin to
use for the WebSocket. Vite's dev proxy drops WebSocket upgrades, so the socket connects directly to
the API in development; in production everything shares one origin.

## Database

Postgres is **not** started by `npm run dev` — it is an independent service. The app only needs
`DATABASE_URL`; any Postgres (system package, managed cloud instance, container) works.

- Schema changes: edit `server/src/db/schema.ts`, regenerate `server/scripts/schema.sql` (see the header of that file) and apply it with `psql "$DATABASE_URL" -f server/scripts/schema.sql`.
- `npm run db:push` is broken: `drizzle-kit` is pinned to `0.18`, which has no `push` command.
- The server sets `search_path` to `chatime,public` and the SQL creates its objects in a `chatime`
  schema, so the DB role only needs `CREATE` on the database (an owned database no longer grants
  `CREATE` on `public` in Postgres 15+). Create the schema once: `CREATE SCHEMA chatime;`.
- Drizzle Kit reads `DATABASE_URL` from the root `.env` (see `server/drizzle.config.ts`).
- Demo data is idempotent — `db:seed` can be re-run safely.

### Helper scripts on this machine

The bundled `psql` cannot load here (`libldap.so.2` is missing) and Docker isn't available, so these
wrappers in `~/.local/bin` use the app's own Node Postgres driver or the bundled `pg_dump`:

```bash
team-chat-db -c 'select count(*) from messages'   # run a query
team-chat-db -f path/to/queries.sql               # run a SQL file
team-chat-dump                                    # backup -> ./team-chat-backup.sql
team-chat-dump /path/to/backup.sql                # backup to a specific file
team-chat-pgctl status                            # manage the local throwaway cluster
```

`team-chat-db` regenerates `~/.pgpass` (mode 600) from `DATABASE_URL` on every run. Because
`~/.pgpass` is keyed by host/port/database, connecting to a *different* database needs `PGPASSWORD`
or its own `.pgpass` line.

Restore to a **new** database using any working `psql` (the bundled client can't run here):

```bash
PGPASSWORD=… psql -h 127.0.0.1 -p 5432 -U postgres -d new_db -f team-chat-backup.sql
```

## API overview

All HTTP routes are prefixed with `/api`. Requests need a `Bearer` access token unless noted.
Errors are `{ "error": { "code": "…", "message": "…" } }`.
`GET /api/health` returns `{ ok: true }` and needs no auth.

| Area | Endpoints |
| --- | --- |
| **Auth** | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`¹, `POST /auth/logout`¹, `GET /auth/me`, `PATCH /auth/me`, `POST /auth/password` |
| **Access** | `GET /access/me`, `GET /access/workspaces`, `GET /workspaces/:id/access-requests`, `POST /workspaces/:id/access-requests/:userId/approve`, `…/decline` |
| **Workspaces** | `GET /workspaces`, `POST /workspaces`, `PATCH /workspaces/:id`, `GET /workspaces/:id/members`, `GET /workspaces/:id/members/:userId` |
| **Channels** | `GET/POST /workspaces/:id/channels`, `PATCH /channels/:id`, `POST /channels/:id/join`, `GET/POST /channels/:id/members`, `DELETE /channels/:id/members/:userId`, `GET /channels/:id/members`, `POST /channels/:id/read`, `GET /channels/:id/messages`, `GET /channels/:id/history` |
| **DMs** | `GET/POST /workspaces/:id/conversations`, `POST /dms/:id/read`, `GET /dms/:id/messages`, `GET /dms/:id/history` |
| **Messages** | `POST /messages`, `PATCH /messages/:id`, `DELETE /messages/:id`, `GET /messages/:id`, `GET /messages/:id/replies`, `GET /messages/:id/location`, `POST /messages/:id/reactions` |
| **Notifications** | `GET /notifications/mentions`, `POST /notifications/read`, `DELETE /notifications/mentions/:messageId`, `GET /unread` |
| **Push** | `GET /push/key`, `POST /push/subscribe`, `DELETE /push/subscribe` |
| **Attachments** | `GET /attachments/limits`, `POST /attachments`, `GET /attachments/:id`, `DELETE /attachments/:id` |
| **Webhooks** | `POST /webhooks/:id/:token`², `GET/POST /workspaces/:id/webhooks`, `PATCH /webhooks/:id`, `POST /webhooks/:id/rotate`, `DELETE /webhooks/:id` |
| **Realtime** | `GET /ws?token=…` (WebSocket) |

¹ Uses the refresh-token cookie instead of the `Authorization` header.
² Public, called by external platforms; authenticated by the secret in the URL. Managing webhooks
requires an owner/admin role in the workspace.

### WebSocket

Connect to `/api/ws?token=<accessToken>`. The server sends a `hello` frame with the user's
workspaces, unread counts, and online users, then pushes events:

`message.created`, `message.updated`, `message.deleted`, `reaction.updated`, `channel.created`,
`channel.updated`, `conversation.created`, `member.joined`, `user.updated`, `presence`,
`access.changed`, `notification`. Clients may send `{ "type": "ping" }` to get a `pong`; the server
heartbeats every 30 s.

## Features

### Sign-ups and approval

New accounts start as **pending** and see a waiting screen (no workspace access). Workspace
owners/admins see a **Sign-ups** entry in the sidebar with a badge; the dialog lists each applicant
(name, handle, email, requested date, optional "Who invited you" note) with Accept / Decline.

- **Accept** adds them to the workspace as a member, joins them to `#general`, and the waiting tab
  switches straight into the app.
- **Decline** blocks login (`403 SIGNUP_DECLINED`) until an admin approves them later.

Pending users are only listed while they belong to no workspace, so approved people drop off the
list automatically. Decisions are pushed over the socket (`access.changed`).

### Channels

The **+** next to "Channels" opens *Create a channel*: name, topic, public/private, and a member
picker (`POST /workspaces/:id/channels` with `memberIds`). Public channels are edited from the
channel header (**Edit**): rename/topic (live for everyone via `channel.updated`), invite, and remove
members. Private channel membership is managed by whoever invites people.

### Direct messages

**+** next to "Direct messages" opens a 1:1 chat. A conversation is one pair of workspace members,
so opening it from either side reuses the same thread (creation is idempotent). Only the two
participants can read it (others get `403`); it has its own unread badges, presence dots, sidebar
previews, and the same realtime behaviour as channels. Threads are channel-only.

### Messages

- Realtime create/edit/delete, reactions, threads (`parentId` + reply panel).
- Safe Markdown subset rendered as React nodes — no `innerHTML`:

  | Syntax | Result |
  | --- | --- |
  | `**bold**`, `_italic_` / `*italic*`, `~~strike~~` | bold, italic, strikethrough |
  | `` `code` `` and fenced code blocks | inline / block code |
  | `- item`, `1. item`, `> quote` | lists and blockquotes |
  | `\| a \| b \|` + `\|---\|---\|` | table |
  | `https://…`, `@username` | link, mention pill |

- Composer: toolbar, `Ctrl/Cmd+B/I/E`, `Enter` sends, `Shift+Enter` newline, `@` opens the member
  picker.

### Notifications

- **In-app**: unread badges, bold channel names, tab title `(n) Team Chat`, mention toast, bell
  dropdown, "Mentions & activity" view.
- **Desktop**: Preferences → Desktop notifications subscribes to Web Push. Pushes go out only for
  `@mentions`, and only while the user has no live WebSocket (tab closed). Requires HTTPS or
  `localhost`.
- **Sound**: chime per incoming message (triple chime for mentions); toggle under Preferences →
  Message sounds. Stored per browser (`tc.sound`); the first click/keypress arms audio.

### Profiles and appearance

- Click any name or avatar to open a profile card (`GET /workspaces/:id/members/:userId`): role,
  join date, account age, online status, **Message** button.
- **Change password** (Preferences → Password): verifies the current password, stores an Argon2
  hash, revokes all refresh tokens (other devices are signed out), and issues a fresh session.
  Rate limited to 10 attempts/minute.
- **Sidebar color**: 8 presets plus a custom picker with live preview and contrast-checked text.
  Saved per browser (`tc.sidebarTheme`, `tc.sidebarCustom`) and drives the accent color.

### Attachments

Images and files via the paperclip, drag & drop, or paste. Streamed to `POST /api/attachments`
(max `UPLOAD_MAX_MB` each, 10 per message), stored under `UPLOAD_DIR`, linked to the message by
`attachmentIds` when sent. Images render as thumbnails with a lightbox; other files as download
chips. Downloads (`GET /api/attachments/:id`) check that the viewer belongs to the message's
channel/DM, send `X-Content-Type-Options: nosniff`, and force a download for anything that isn't an
inline-safe image or PDF. Unclaimed uploads are deleted when removed before sending.

Storage keys are generated server-side, never derived from client file names. For multiple API
instances, use object storage (e.g. S3) or a shared `UPLOAD_DIR` volume.

### Incoming webhooks

Point any external tool at a channel: **Edit → Webhooks** (workspace owners/admins) creates a secret
URL. `POST` JSON (or `text/plain`) to it and it appears in the channel as a message authored by the
webhook's name (e.g. "Metabase"), in realtime and counted toward unread badges.

- **Payloads**: any JSON body. With a **template**, `{{path.to.field}}` is substituted from the body
  (array indexes like `{{rows.0.region}}` work). Without one, a `text`/`content` string is used
  verbatim; anything else becomes a readable key/value summary. Sending `text/plain` posts the body as
  is. Rendering is capped at the 8000-character message limit.
- **Notifications**: "Notify channel members" sends every channel member an in-app announcement and a
  desktop push (no mention badge is touched).
- **Metabase example**: alarm → Webhook → that URL; template `` **{{alert_name}}** — {{value}} ``.
- **Security**: only the token's SHA-256 is stored; the full URL is shown once (on create or rotate).
  Unknown, rotated and disabled URLs all answer `404`. Rotating stops the old URL immediately;
  "Enabled" pauses deliveries without losing the URL. Removing a webhook keeps its past messages.
- `APP_URL` must be reachable by the external platform (the URL is built from it). Requests are body-
  limited to 256 KiB and rate limited per webhook. Errors: `404` unknown/disabled, `415` unsupported
  content type, `422` payload rendered nothing.

## Deployment

Set `NODE_ENV=production`, a strong `JWT_SECRET`, real `VAPID_*` keys, `APP_URL`, and
`DATABASE_URL`. Then:

```bash
npm ci && psql "$DATABASE_URL" -f server/scripts/schema.sql && npm run build && npm start
```

`npm start` serves the API and the built SPA (`web/dist`) from one process; unknown non-`/api` paths
fall back to `index.html` for client-side routing.
