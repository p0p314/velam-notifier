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

Backend (racine) — Node **22.x** (LTS) (fetch natif, pas de client HTTP tiers) :

```bash
npm install
npm start          # node server.js — écoute sur PORT (défaut 3001)
npm run dev        # node --watch server.js — redémarrage auto
npm run build      # installe deps racine + frontend, puis build Vite → frontend/dist
npm test           # tests backend (node:test) — SQLite en mémoire par défaut
```

Frontend (`frontend/` — projet npm séparé, ESM/Vite, distinct du backend CommonJS) :

```bash
cd frontend
npm install
npm run dev        # Vite → http://localhost:5173
npm run build      # build de prod → frontend/dist
npm run preview    # prévisualise le build
npm test           # tests frontend (Vitest + jsdom + Testing Library)
```

En dev, lancer les deux : backend sur 3001, frontend sur 5173 (proxy via `VITE_API_URL`).
En prod, un seul process : Express sert `frontend/dist` en statique **après** les routes `/api`
(fallback SPA vers `index.html`). Aucun linter configuré.

## Tests & CI

- **Backend** (`test/*.test.js`, `node:test`, zéro dépendance) : `test/helpers.js` doit être
  importé **en premier** (fixe l'env avant le chargement des modules). Base SQLite `:memory:`
  par défaut ; avec `DATABASE_URL` (+ `DATABASE_SSL=false` en local) la même suite tourne sur
  un vrai PostgreSQL, vidé par `resetDb()`. Le flux GBFS est simulé en interceptant `fetch`
  (objet `gbfs` des helpers) et `web-push.sendNotification` est remplacé dans
  `alert-loop.test.js`. L'app est importée depuis `app.js` (sans boot ni polling).
- **Frontend** (`frontend/src/__tests__/`, Vitest) : `setup.js` réinitialise `localStorage`,
  `navigator.onLine` (`setOnline()`) et un `fetch` mocké à chaque test.
- **CI** : `.github/workflows/tests.yml` sur chaque PR vers `develop`/`main` — 3 jobs :
  backend SQLite, backend PostgreSQL 16 (service), frontend (tests + build). Le blocage du
  merge se configure dans la protection de branche GitHub (status checks requis).
- Toute nouvelle route / règle métier doit venir avec son test.

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
- `JWT_TTL` — durée de vie du jeton (défaut `30d`).
- `DATABASE_SSL=false` — désactive SSL vers Postgres (Postgres local / CI uniquement).
- `SQLITE_PATH` — fichier SQLite (défaut `data/velam.db` ; `:memory:` pour les tests).
- `RATE_LIMIT_DISABLED=1` — **tests uniquement** : coupe le rate-limit login/register.

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
- **auth.js** — bcrypt + JWT (`{ id, username }`, expiration `JWT_TTL` défaut 30 j, HS256 ;
  session glissante via `GET /api/auth/me` qui renvoie un jeton neuf au démarrage du client). Secret résolu une
  fois au boot (`JWT_SECRET` env, sinon aléatoire persisté). `requireAuth` lit
  `Authorization: Bearer`, pose `req.user`, sinon 401.
- **push.js** — clés VAPID (env ou générées), envoi `web-push` (`sendToUser` → `{ total, sent }`),
  et la **boucle d'alerte** (`startPolling` → cycle non concurrent toutes les 30 s) :
  `evaluateAlert` (pure), messages (`buildMessage`), stations de repli (`findFallback`).
  Voir l'invariant d'alerte plus bas. Les notifications ouvrent `/open` (deep link + stores).
- **time.js** — heure « métier » dans `ALERT_TZ` (`nowInTz`, `inWindow`, `addDays`).
- **geo.js** — `distanceKm` / `fmtDistance` côté serveur (stations de repli).
- **rentalApps.js** — synchronise les `rental_apps` (deep links officiels Vélam) depuis
  `system_information`. Données quasi statiques → **sync quotidienne**, jamais par requête.
- **app.js** — construit l'app Express sans la démarrer (importable par les tests) :
  middlewares de sécurité, montage des routers `routes/` (un par domaine : validation
  `validateAlertPayload` dans `routes/alerts.js`, fusion `mergeWithStatus` dans
  `routes/stations.js`…), service du build SPA en prod.
- **server.js** — boot séquentiel : `initialize()` → `initAuth()` → `initPush()` →
  `startPolling()` → `listen`.

### Invariant clé du flux de données

Les **infos statiques** de station sont mises en **cache SQL** ; la **disponibilité live**
(vélos, places, statut) est **toujours refetchée** depuis GBFS à chaque `GET /api/stations`
et fusionnée à la volée. La base n'est **jamais** la source de vérité pour la disponibilité,
seulement pour le référentiel lent des stations.

- `GET /api/stations` — auto-peuple la base au premier appel si vide, puis fusionne l'info en
  cache avec un fetch statut live. Le détail par type vient de `vehicle_types_available`
  (`mechanical` / `electrical`).
- `POST /api/stations/refresh` (**protégée**) et `POST /cron/refresh-stations` (cron quotidien) —
  rechargent le référentiel (`replaceStations` : upsert + retrait des stations disparues, sauf
  si le flux renvoie moins de la moitié des stations connues).
- **Fraîcheur (globale, pas par station)** : `getStationStatus()` (gbfs.js) renvoie un instantané
  `{ stations, updatedAt, upstreamOk }`. Appel Vélam borné à 8 s (`GBFS_TIMEOUT_MS`) ; si le flux
  ne répond plus / répond mal (HTTP, délai, JSON), la **dernière réponse valide** est servie avec
  `upstreamOk: false` (502 seulement si aucune donnée n'a jamais été reçue). `updatedAt` = champ
  racine `last_updated` du flux. La route renvoie `data_updated_at`, `data_age_s`, `upstream_ok`
  et `stale` (`!isFresh` : flux en échec ou données ≥ 5 min) ; le client affiche alors le bandeau
  (`OfflineBanner`, textes dans `lib/station.js` → `bannerText`). La boucle d'alerte **n'envoie
  rien** sur des données non fraîches.
- `GET /api/health` — version, nb de stations, uptime, Node, **état de la boucle d'alerte**
  (`alert_loop` : démarrée, saine, dernier passage, résultat, dernière erreur) et **du flux Vélam**
  (`gbfs`, lu depuis le cache sans appel) ; `status` = `ok` | `degraded`. `GET /health` — sonde anti-veille.

Erreurs upstream/proxy → **HTTP 502** `{ ok:false, error }`. Toutes les réponses portent une
enveloppe `ok` ; le client `api()` lève sur `!res.ok || data.ok === false`. Routes protégées
(`/api/favorites` (+ `PATCH /:id` label, `PUT /order`), `/api/alerts` (+ `PUT /pause`),
`/api/push/subscribe|unsubscribe|test`, `/api/auth/me` (GET ; DELETE = suppression du compte),
`PUT /api/auth/password`,
`POST /api/stations/refresh`) : Bearer requis. Publiques : login/register,
`GET /api/stations`, `GET /api/rental-apps`, `GET /api/push/vapid-public-key`.
Cron (`CRON_SECRET`) : `/cron/sync-rental-apps`, `/cron/refresh-stations` (workflow
`sync-rental-apps.yml`, 02:00 UTC).

### Invariant de la boucle d'alerte

`startPolling` exécute un cycle toutes les 30 s, protégé par un verrou (`isRunning`) pour ne
pas se chevaucher, et **ne fait rien** tant qu'aucune alerte n'est `active=1`
(`countActiveAlerts`). Chaque cycle supprime les alertes ponctuelles des jours passés, puis
ne fetch GBFS que si au moins une alerte est **due** : fenêtre horaire (`time_start`–`time_end`)
et jour (`days`, 1=lundi…7=dimanche) — ou, pour une ponctuelle, `valid_on` = aujourd'hui —
compte **non en pause** (`users.alerts_paused_until` < aujourd'hui). Heure évaluée dans
**`ALERT_TZ`** (Europe/Paris), pas en UTC serveur.

Modèle d'alerte (`routes/alerts.js` → `validateAlertPayload`, PATCH = fusion puis revalidation) :

- `target` : `bikes` (filtré par `bike_type`) ou `docks` (places libres) ;
- `comparison` + `threshold` : `at_most` N (« il en reste peu », 0 permis) ou `at_least` N
  (« il y en a de nouveau ») ;
- trajet : `arrival_station_*` + `arrival_threshold` (uniquement `bikes`/`at_most`) ⇒
  déclenche si peu de vélos au départ **ou** peu de places à l'arrivée ;
- `valid_on` (YYYY-MM-DD) : alerte ponctuelle.

Station fermée : `is_renting=false` ⇒ 0 vélo, `is_returning=false` ⇒ 0 place.
Anti-spam par jour, générique : `evaluateAlert` renvoie `{ triggered, key }` (clé = compte, ou
`départ|arrivée` pour un trajet). Notifie à la première atteinte du jour (`last_notified_date`),
re-notifie si la **clé change** (`last_notified_key`), se réarme (clé → NULL) quand la condition
se lève. **Toute modification** d'une alerte remet ces deux champs à NULL. Une alerte « au plus N »
déclenchée ajoute la **station de repli** la plus proche (≤ 1 km) qui ne pose pas le même
problème. Envoi à **toutes** les subscriptions de l'utilisateur ; 404/410 suppriment la
subscription morte. `POST /api/push/test` : notification de test (5 / 10 min / compte).

Subscriptions : **une ligne par appareil** (`endpoint` unique). Un `subscribe` d'un appareil
déjà connu le **réattribue** au compte courant (téléphone partagé) ; la déconnexion appelle
`POST /api/push/unsubscribe` pour détacher l'appareil du compte.

### rental_apps & redirection push

Le flux `system_information` expose des `rental_apps` (deep link `discovery_uri` + `store_uri`
par plateforme). Ils sont synchronisés **une fois par jour** par **GitHub Actions**
(`.github/workflows/sync-rental-apps.yml`, 02:00 UTC) qui appelle `POST /cron/sync-rental-apps`
(garde `CRON_SECRET`, comparaison à **temps constant**). Aucun cron côté serveur.

Les notifications pointent toujours vers une URL `https://` (`/open`, page HTML servie par
`routes/rentalApps.js`) car le Service Worker iOS refuse les schemes custom (`velam://`).
`/open` (publique, `noindex`) tente le deep link, puis le store de la plateforme, puis le web.

### Sécurité (backend)

`helmet` avec CSP adaptée au SPA (JS `'self'`+`blob:` pour les workers Mapbox, styles inline
React, `connectSrc` Mapbox ; polices `'self'` uniquement — Geist auto-hébergée via `@fontsource`). CORS en whitelist. Corps JSON borné à **16 kb**. `express-rate-limit`
sur `login` (10/15 min, partagé avec changement de mot de passe et suppression de compte) et
`register` (5/h). **RGPD** : `DELETE /api/auth/me` (mot de passe exigé) efface compte, favoris,
alertes et appareils (`db.deleteUser`) ; page publique `/confidentialite` à tenir à jour si le
modèle de données ou les tiers changent. `trust proxy` pour l'IP réelle derrière Render.

## Architecture frontend (`frontend/src/`)

React + `react-router-dom`. `main.jsx` enregistre `/sw.js`, injecte le CSS global, monte
`<BrowserRouter><App/></BrowserRouter>`. `App.jsx` empile les providers
(`ThemeProvider` → `AuthProvider` → `PwaInstallProvider`) et les routes ; les routes applicatives
sont derrière `<Protected>` + `<Layout>` (header mobile / navbar desktop / bottom-nav). La **carte
est lazy-loadée** (`React.lazy`) pour garder mapbox-gl hors du bundle principal. Landing
différenciée : mobile → `/favoris`, desktop → `/stations`.

- **api.js** — client `api(path, {method, body, auth})` unique : injecte le Bearer, normalise
  les erreurs, gère token/user en `localStorage`. Base = `VITE_API_URL`. Rejoue les GET sur
  erreur réseau / 502-504 (réveil Render) ; un 401 authentifié purge le jeton et émet
  `auth:expired` (écouté par `AuthProvider` → retour `/login`).
- **auth.jsx** — `AuthContext` / `useAuth` (login/register/logout async, `isAuthenticated`).
  Au démarrage : `/api/auth/me` (ignoré si la session a changé entre-temps) puis `syncPush()`.
- **useTheme.jsx** — thème clair/sombre via `data-theme` sur `<html>`, persisté.
- **hooks.js** — `useStations` (poll 60 s + au retour au premier plan ; `stale` / `staleReason` :
  `upstream` = verdict serveur, `server` = serveur injoignable), `useFavorites` (liste, toggle, `rename`, `reorder`
  optimiste ; modifications **mises en file**, seule la réponse de la dernière est appliquée),
  `useOnline`, `useGeolocation`, `useIsMobile`, helpers `distanceKm` / `fmtDistance`.
- **lib/** — logique pure testable : `alerts.js` (formulaire ↔ API, résumés), `favorites.js`
  (tri, déplacement, nom personnalisé), `station.js` (statut, `bannerText`, `disabledNote`),
  `mapConfig.js` (couleurs, `nearestWithBikes`), `onboarding.js` (étapes utiles), `offlineCache.js`.
- **Hors ligne** — `lib/offlineCache.js` garde en `localStorage` la dernière liste des stations
  et des favoris (horodatée ; favoris purgés à la déconnexion). Les hooks exposent `stale` +
  `lastUpd` ; `components/Offline.jsx` fournit `OfflineBanner` (« Hors ligne — données de HH:MM »)
  et `OnlineOnly` (Carte et Alertes indisponibles hors ligne). `public/sw.js` met en cache la
  coquille (index.html réseau-d'abord, `/assets/*` cache-d'abord, purge des anciens builds),
  **jamais** l'API. Incrémenter `CACHE` dans `sw.js` si un fichier public non hashé change.
- **push.js** + **public/sw.js** — `PushManager` natif. `syncPush()` (démarrage + login) est
  **silencieux** : ne fait rien sans permission accordée, resouscrit si la clé VAPID a changé.
  `enablePush()` demande la permission, **uniquement sur clic** (bandeau de la page Alertes). Le SW gère `push` + `notificationclick`.
- **usePwaInstallPrompt.js** + **components/PwaInstall*** — modal d'installation **réservée au
  mobile** (jamais desktop), réapparaît le lendemain si ignorée ; pas d'ouverture auto tant que
  l'accueil est en attente.
- **components/Onboarding.jsx** — accueil au premier lancement (installer / notifications /
  favoris), uniquement les étapes encore utiles ; rien n'est monté une fois terminé.
- **pages/** — `Login`, `Stations` (recherche/tri/filtre + détail), `Favorites` (swipe-to-delete,
  tri proximité / ordre choisi, mode « Organiser »), `MapPage` (carte + filtres + « Autour de moi »),
  `Alerts` (formulaire complet, pause, notification de test ; pré-rempli via
  `location.state.alertStation` depuis la fiche station), `Account` (`/compte` : mot de passe,
  suppression du compte), `Privacy` (`/confidentialite`, publique).
- **components/** — `StationCard` (desktop), `StationListItem` (mobile, étoile favori optionnelle
  via `onToggleFav`), `StationDetailSheet`,
  `BottomSheet`, `BottomNav` / `Navbar`, `Icon` (SVG inline style Lucide), `Logo`, `Offline`,
  `map/StationMap` (markers diffés, pas de recréation), `map/MapFilters`.
- **lib/mapConfig.js** — config Mapbox (`mapStyleFor(theme)` : fond clair / sombre, changé à chaud
  par `setStyle`) + logique de disponibilité (couleur des markers).
- **theme.js** — alias palette (variables CSS), `fmtTime`, `bikeColor`. Styles inline + `styles.css`
  (variables CSS, pas de framework CSS).

### Seam de nommage des types de vélo

L'UI et la DB utilisent **`ebike`** (électrique) ; GBFS l'appelle **`electrical`**. Le mapping
se fait dans `push.js` (`countForType`) et `routes/stations.js` (`extractCount`). Bien conserver ce seam.

## Base de données (schéma)

Tables (créées/migrées par `database/migrations.js`, dialecte selon `DATABASE_URL`) :
`stations` (référentiel statique), `config` (clé/valeur : secret JWT, clés VAPID),
`users` (+ `alerts_paused_until`), `favorites` (unique `user_id+station_id`, `label`, `sort_order`
— NULL tant que l'utilisateur n'a jamais ordonné : ordre alphabétique), `push_subscriptions`
(unique `endpoint`), `alerts` (cf. modèle ci-dessus ; `threshold` a remplacé `min_count`,
`last_notified_key` a remplacé `last_notified_count`), `rental_apps` (deep links par plateforme).
Helpers de migration portables : `columnsOf` / `addColumn` / `dropColumn` (`migrations.js`).

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
  si de nouvelles origines externes sont ajoutées. Pas de `<script>` inline dans `index.html`
  (bloqué par `script-src 'self'`) → fichier dans `public/` (cf. `theme-init.js`).

## Déploiement

`render.yaml` : service web `velopulse`, `buildCommand: npm run build`, `startCommand: npm start`.
Secrets (`DATABASE_URL`, `VAPID_*`, `JWT_SECRET`, `APP_URL`, `CRON_SECRET`) en variables d'env
Render. Après un merge sur `main`, déclencher un déploiement Render (voir mémoire projet).
