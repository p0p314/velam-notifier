# CLAUDE.md

Guide de référence pour travailler sur ce dépôt (destiné à Claude Code comme à tout
nouveau développeur). Le code et les chaînes d'interface sont **en français** — conserver
cette convention (commentaires, libellés UI, messages d'erreur).

## Projet

**VéloPulse** — PWA de suivi des stations de vélos en libre-service **Vélam** (Amiens).

- **Backend** : proxy Express (CommonJS) au-dessus du flux **GBFS v2** de Cyclocity, avec
  auth JWT, favoris par utilisateur et **alertes de disponibilité** notifiées par **Web Push**.
- **Frontend** : application **React / Vite** multi-pages (PWA installable), carte **Mapbox**,
  thème clair/sombre, expérience mobile-first.
- **Déploiement** : service web unique sur **Render** (front + back même domaine).
  Base **PostgreSQL** (Supabase) en prod, **SQLite** en dev.

> Le dépôt s'appelle encore `velam-notifier` (et l'URL Render est
> `velam-notifier.onrender.com`), mais le produit est **VéloPulse** (`package.json` → `velopulse`).

## Commandes

Backend (racine) — Node **20.x** (fetch natif, pas de client HTTP tiers) :

```bash
npm install
npm start          # node server.js — écoute sur PORT (défaut 3001)
npm run dev        # node --watch server.js — redémarrage auto
npm run build      # installe deps racine + frontend, puis build Vite → frontend/dist
```

Frontend (`frontend/` — projet npm séparé, ESM/Vite, distinct du backend CommonJS) :

```bash
cd frontend
npm install
npm run dev        # Vite → http://localhost:5173
npm run build      # build de prod → frontend/dist
npm run preview    # prévisualise le build
```

En dev, lancer les deux : backend sur 3001, frontend sur 5173 (proxy via `VITE_API_URL`).
En prod, un seul process : Express sert `frontend/dist` en statique **après** les routes `/api`
(fallback SPA vers `index.html`). **Aucun test ni linter** n'est configuré à ce jour.

## Variables d'environnement

Backend (voir `render.yaml`) :

- `PORT` — port d'écoute (défaut 3001).
- `NODE_ENV=production` — active le service statique du build + le CORS de prod.
- `DATABASE_URL` — **présence = mode PostgreSQL** ; absente = SQLite (`data/velam.db`).
- `JWT_SECRET` — secret de signature JWT (sinon secret aléatoire persisté en `config`, dev).
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` — Web Push (sinon générés en dev).
- `CRON_SECRET` — protège `POST /cron/sync-rental-apps` (obligatoire pour l'activer).
- `APP_URL` — base `https://` des liens de notification (page `/redirect`).
- `CORS_ORIGIN` — origines autorisées en dev (CSV) ; `FRONTEND_URL` en prod.
- `ALERT_TZ` — fuseau d'évaluation des alertes (défaut `Europe/Paris`).

Frontend (préfixe `VITE_`, injectées au build) :

- `VITE_API_URL` — base de l'API (vide en prod = même domaine ; `http://localhost:3001` en dev).
- `VITE_MAPBOX_TOKEN` — token Mapbox (jamais commité ; via `.env.*.local` ou env Render).

## Architecture backend

Modules CommonJS, séparation nette des responsabilités :

- **gbfs.js** — accès au flux GBFS Cyclocity (fetch natif). Trois endpoints :
  `station_information` (statique), `station_status` (live), `system_information` (rental_apps).
  Filtre la station fantôme `761` (sans nom/capacité) au moment du fetch info. Renvoie les
  données brutes ; **aucune fusion ici**.
- **database/** — couche d'abstraction base de données (**seule** autorisée à parler à un driver) :
  - `index.js` — choisit l'adaptateur : `createPostgresDb()` si `DATABASE_URL`, sinon
    `createSQLiteDb()`. Exporte le singleton `dbc`.
  - `sqlite.js` — adaptateur `better-sqlite3` (WAL, FK ON), enrobé dans une interface **async**.
  - `postgres.js` — adaptateur `pg` (Pool). Traduit les placeholders `?` → `$1, $2…` et
    ajoute `RETURNING id` sur les INSERT concernés (sauf tables sans colonne `id`).
  - `migrations.js` — schéma des deux dialectes + migrations idempotentes (colonnes ajoutées
    à la volée). Pas d'outil de migration externe.
  - Interface : `dbc.query(sql, params) → { rows }`, `dbc.run(sql, params) → { id, changes }`,
    `dbc.get(sql, params) → row|null`, `dbc.initialize()`.
- **db.js** — **dépôt de données** (accès domaine). N'utilise **que** `dbc`, jamais un driver
  directement. Regroupe le SQL de tous les domaines : `stations`, `config`, `users`,
  `favorites`, `push_subscriptions`, `alerts`, `rental_apps`. Toutes les fonctions sont `async`.
- **auth.js** — bcrypt + JWT (`{ id, username }`, expiration 7 j, HS256). Secret résolu une
  fois au boot (`JWT_SECRET` env, sinon aléatoire persisté). `requireAuth` lit
  `Authorization: Bearer`, pose `req.user`, sinon 401.
- **push.js** — clés VAPID (env ou générées), envoi `web-push`, et la **boucle d'alerte**
  (`startPolling` → cycle non concurrent toutes les 30 s). Voir l'invariant d'alerte plus bas.
  Construit l'URL de notification via la page `/redirect` (deep link + stores).
- **rentalApps.js** — synchronise les `rental_apps` (deep links officiels Vélam) depuis
  `system_information`. Données quasi statiques → **sync quotidienne**, jamais par requête.
- **server.js** — assemble le tout : middlewares de sécurité, **toutes** les routes,
  validation des payloads (`validateAlertPayload`, regex `HHMM`), fusion
  (`mergeWithStatus`, `extractCount`), et service du build SPA en prod. Boot séquentiel :
  `initialize()` → `initAuth()` → `initPush()` → `startPolling()` → `listen`.

### Invariant clé du flux de données

Les **infos statiques** de station sont mises en **cache SQL** ; la **disponibilité live**
(vélos, places, statut) est **toujours refetchée** depuis GBFS à chaque `GET /api/stations`
et fusionnée à la volée. La base n'est **jamais** la source de vérité pour la disponibilité,
seulement pour le référentiel lent des stations.

- `GET /api/stations` — auto-peuple la base au premier appel si vide, puis fusionne l'info en
  cache avec un fetch statut live. Le détail par type vient de `vehicle_types_available`
  (`mechanical` / `electrical`).
- `POST /api/stations/refresh` — force le rechargement du référentiel statique.
- `GET /api/health` — nb de stations, uptime, version Node. `GET /health` — sonde anti-veille.

Erreurs upstream/proxy → **HTTP 502** `{ ok:false, error }`. Toutes les réponses portent une
enveloppe `ok` ; le client `api()` lève sur `!res.ok || data.ok === false`. Routes protégées
(`/api/favorites`, `/api/alerts`, `/api/push/subscribe`) : Bearer requis. Publiques : auth,
`GET /api/stations`, `GET /api/rental-apps`, `GET /api/push/vapid-public-key`.

### Invariant de la boucle d'alerte

`startPolling` exécute un cycle toutes les 30 s, protégé par un verrou (`isRunning`) pour ne
pas se chevaucher, et **ne fait rien** tant qu'aucune alerte n'est `active=1`
(`countActiveAlerts`). Il ne fetch GBFS que si au moins une alerte active a sa **fenêtre
horaire** (`time_start`–`time_end`) et son **jour** (`days`, 1=lundi…7=dimanche) qui couvrent
l'instant courant. L'heure est évaluée dans **`ALERT_TZ`** (Europe/Paris), pas en UTC serveur.

Sémantique du seuil : l'alerte se déclenche sur **basse disponibilité** —
`count <= min_count` (par type : `mechanical`, `ebike`→GBFS `electrical`, `any`→total).
Anti-spam par jour : notifie une fois quand le seuil est atteint (`last_notified_date`), re-notifie
uniquement si le compte **change** (`last_notified_count`), et se réarme quand le compte
repasse strictement au-dessus du seuil. Envoi à **toutes** les subscriptions de l'utilisateur ;
les réponses 404/410 suppriment la subscription morte.

> ⚠️ Dette de nommage : `min_count` désigne en réalité un **plafond** (« notifier si au plus N
> vélos »). Le nom est trompeur — à considérer lors d'une refonte.

### rental_apps & redirection push

Le flux `system_information` expose des `rental_apps` (deep link `discovery_uri` + `store_uri`
par plateforme). Ils sont synchronisés **une fois par jour** par **GitHub Actions**
(`.github/workflows/sync-rental-apps.yml`, 02:00 UTC) qui appelle `POST /cron/sync-rental-apps`
(garde `CRON_SECRET`, comparaison à **temps constant**). Aucun cron côté serveur.

Les notifications pointent toujours vers une URL `https://` (`/redirect`) car le Service Worker
iOS refuse les schemes custom (`velam://`). La page `/redirect` (publique, `noindex`) tente le
deep link, puis le store de la plateforme, puis le web.

### Sécurité (backend)

`helmet` avec CSP adaptée au SPA (JS `'self'`+`blob:` pour les workers Mapbox, styles inline
React, `connectSrc` Mapbox). CORS en whitelist. Corps JSON borné à **16 kb**. `express-rate-limit`
sur `login` (10/15 min) et `register` (5/h). `trust proxy` pour l'IP réelle derrière Render.

## Architecture frontend (`frontend/src/`)

React + `react-router-dom`. `main.jsx` enregistre `/sw.js`, injecte le CSS global, monte
`<BrowserRouter><App/></BrowserRouter>`. `App.jsx` empile les providers
(`ThemeProvider` → `AuthProvider` → `PwaInstallProvider`) et les routes ; les routes applicatives
sont derrière `<Protected>` + `<Layout>` (header mobile / navbar desktop / bottom-nav). La **carte
est lazy-loadée** (`React.lazy`) pour garder mapbox-gl hors du bundle principal. Landing
différenciée : mobile → `/favoris`, desktop → `/stations`.

- **api.js** — client `api(path, {method, body, auth})` unique : injecte le Bearer, normalise
  les erreurs, gère token/user en `localStorage`. Base = `VITE_API_URL`.
- **auth.jsx** — `AuthContext` / `useAuth` (login/register/logout, `isAuthenticated`).
- **useTheme.jsx** — thème clair/sombre via `data-theme` sur `<html>`, persisté.
- **hooks.js** — `useStations` (poll 60 s), `useFavorites` (liste + toggle optimiste),
  `useGeolocation`, `useIsMobile`, helpers `distanceKm` / `fmtDistance` (tri par proximité).
- **push.js** + **public/sw.js** — `PushManager` natif ; `registerPush()` (après login) demande
  la permission, souscrit, POST la subscription. Le SW gère `push` + `notificationclick`.
- **usePwaInstallPrompt.js** + **components/PwaInstall*** — modal d'installation **réservée au
  mobile** (jamais desktop), réapparaît le lendemain si ignorée.
- **pages/** — `Login`, `Stations` (recherche/tri/filtre + détail), `Favorites` (swipe-to-delete),
  `MapPage` (carte + filtres), `Alerts` (CRUD depuis les favoris), `Redirect` (cible push).
- **components/** — `StationCard` (desktop), `StationListItem` (mobile), `StationDetailSheet`,
  `BottomSheet`, `BottomNav` / `Navbar`, `Icon` (SVG inline style Lucide), `Logo`,
  `map/StationMap` (markers diffés, pas de recréation), `map/MapFilters`.
- **lib/mapConfig.js** — config Mapbox + logique de disponibilité (couleur des markers).
- **theme.js** — alias palette (variables CSS), `fmtTime`, `bikeColor`. Styles inline + `styles.css`
  (variables CSS, pas de framework CSS).

### Seam de nommage des types de vélo

L'UI et la DB utilisent **`ebike`** (électrique) ; GBFS l'appelle **`electrical`**. Le mapping
se fait dans `push.js` (`countForType`) et `server.js` (`extractCount`). Bien conserver ce seam.

## Base de données (schéma)

Tables (créées/migrées par `database/migrations.js`, dialecte selon `DATABASE_URL`) :
`stations` (référentiel statique), `config` (clé/valeur : secret JWT, clés VAPID),
`users`, `favorites` (unique `user_id+station_id`), `push_subscriptions`, `alerts`
(fenêtre horaire + `days` + suivi de notification), `rental_apps` (deep links par plateforme).

## Conventions & bonnes pratiques

- **Français** partout (code, UI, commentaires, logs).
- **Backend** : ne jamais appeler un driver DB hors de `database/` — passer par `db.js` / `dbc`.
  Toute réponse porte l'enveloppe `{ ok, … }`. Erreurs upstream → 502, erreurs serveur → 500,
  validation → 400. Routes protégées via `requireAuth`.
- **Frontend** : tout appel réseau passe par `api()`. Aucune couleur en dur — utiliser les
  variables CSS / la palette `C`. Détection mobile centralisée dans `hooks.js`.
- **Éco-conception / performance** : la disponibilité est volatile mais coûteuse à fetcher —
  minimiser les appels GBFS upstream (mutualiser, mettre en cache court) ; préférer les
  markers diffés et le lazy-loading ; borner les tailles de payload.
- **Sécurité** : secrets uniquement via env/`config`, jamais commités ; garder le CSP à jour
  si de nouvelles origines externes sont ajoutées.

## Déploiement

`render.yaml` : service web `velopulse`, `buildCommand: npm run build`, `startCommand: npm start`.
Secrets (`DATABASE_URL`, `VAPID_*`, `JWT_SECRET`, `APP_URL`, `CRON_SECRET`) en variables d'env
Render. Après un merge sur `main`, déclencher un déploiement Render (voir mémoire projet).
