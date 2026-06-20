# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Proxy API + dashboard for the Vélam bike-share stations in Amiens. The backend is an Express
proxy over the Cyclocity **GBFS v2** feed, plus JWT auth, per-user favorites, and time-windowed
availability alerts delivered via Web Push. The frontend is a multi-page React/Vite app.
UI strings and code comments are in French — keep that convention.

## Commands

Backend (repo root):

```bash
npm install            # requires Node >= 18 (uses native fetch, no http client dep)
npm start              # node server.js — serves on PORT (default 3001)
npm run dev            # node --watch server.js — auto-restart on file change
```

Frontend (`frontend/` — separate npm project, ESM/Vite, kept apart from the CommonJS backend):

```bash
cd frontend
npm install
npm run dev            # Vite dev server on http://localhost:5173
npm run build          # production build → frontend/dist
```

Run both together: backend on 3001, frontend on 5173. There are no tests or linter configured.

## Architecture

Backend modules (CommonJS), clean separation:

- **gbfs.js** — fetches the two GBFS endpoints (`station_information.json` static,
  `station_status.json` live). Filters out phantom station `761` (no name/capacity) at the
  info-fetch boundary. Returns raw GBFS data; no merging here.
- **db.js** — `better-sqlite3` store at `data/velam.db` (WAL mode, FK on, auto-created). Owns
  every table and all SQL: `stations` (static info), `config` (JWT secret + VAPID keys),
  `users`, `favorites`, `push_subscriptions`, `alerts`. All `CREATE TABLE IF NOT EXISTS` in
  `initDb()` — no migration step. Lazy singleton connection.
- **auth.js** — bcrypt hashing + JWT (`{ id, username }`, 7-day expiry). Signing secret comes
  from `JWT_SECRET` env, else a random secret generated once and persisted in `config`.
  `requireAuth` middleware reads `Authorization: Bearer`, sets `req.user`, 401s otherwise.
- **push.js** — VAPID keys generated once into `config`; `web-push` sender; the 30s alert poll
  (`startPolling` → `checkAlerts`). See the alert-polling invariant below.
- **server.js** — wires it together, owns the merge logic (`mergeWithStatus`, `extractCount`)
  and all route handlers + payload validation (`validateAlertPayload`, `HHMM` regex).

### The key data-flow invariant

Static station info is **cached in SQLite**; live availability (bike counts, docks, renting
status) is **always fetched fresh** from GBFS on every `GET /api/stations` and merged in at
request time. The DB is never the source of truth for availability — only for the slow-changing
station roster.

- `GET /api/stations` — auto-populates SQLite on first call if empty, then merges cached info
  with a live status fetch. Bike counts come from `vehicle_types_available` (`mechanical` /
  `electrical` type ids).
- `POST /api/stations/refresh` — force re-fetch of the static roster (call when stations are
  added/removed upstream).
- `GET /api/health` — station count, uptime, node version.

Upstream/proxy errors return HTTP **502** with `{ ok: false, error }`. All responses carry an
`ok` envelope; the `api()` client throws on `!res.ok || data.ok === false`. Protected routes
(`/api/favorites`, `/api/alerts`, `/api/push/subscribe`) require a valid Bearer token; auth
routes and `GET /api/push/vapid-public-key` are public.

### The alert-polling invariant

`startPolling` runs `checkAlerts` every 30s but **does nothing unless ≥1 alert has `active=1`**
(`countActiveAlerts()` guard) — and only fetches GBFS if at least one active alert's time window
covers the current `HH:MM`. For each due alert it compares the live count (by `bike_type`:
`mechanical` → mechanical, `ebike` → GBFS `electrical`, `any` → total) against `min_count`;
on `count >= min_count` it pushes to **all** of that user's subscriptions. There is **no
dedup** — a notification fires on every satisfying tick by design. Web-push 404/410 responses
delete the dead subscription from `push_subscriptions`.

### CORS

Restricted to `http://localhost:5173` by default; override with the `CORS_ORIGIN` env var
(comma-separated for multiple origins).

### Frontend (`frontend/src/`)

Multi-page React app, `react-router-dom`. Entry `main.jsx` registers `/sw.js`, injects global
CSS, mounts `<BrowserRouter><App/></BrowserRouter>`. `App.jsx` holds `<AuthProvider>` + routes;
all app routes sit behind `<Protected>` (redirects to `/login` when `!isAuthenticated`).

- **auth.jsx** — `AuthContext` / `useAuth` (login/register/logout, `isAuthenticated`). Token +
  user persisted in `localStorage` via **api.js** helpers.
- **api.js** — single `api(path, {method, body, auth})` client; injects the Bearer token,
  normalizes errors. Base URL from `VITE_API_URL` env, default `http://localhost:3001`.
- **hooks.js** — `useStations` (60s polling) and `useFavorites` (list + optimistic toggle).
- **push.js** + **public/sw.js** — native `PushManager`; `registerPush()` (called after login)
  requests permission, subscribes, POSTs the subscription. SW handles `push` + `notificationclick`.
- **pages/** — `Login`, `Stations` (dashboard + favorite ★ toggle + detail modal),
  `Favorites`, `Alerts` (create from favorites / toggle active / delete).
- **components/** — `StationCard`, `StationDetailModal`. **theme.js** holds the shared `C`
  palette + `fmtTime`/`bikeColor` helpers (inline styling, no CSS framework).

Note the bike-type naming seam: the UI/DB use `ebike` for electric, but GBFS calls it
`electrical` — `push.js` (`countForType`) and `server.js` (`extractCount`) map between them.
