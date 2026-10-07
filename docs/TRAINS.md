# Module Trains

Recherche et suivi de trains (TER, Intercités, TGV) dans VéloPulse : horaires du jour,
retards et suppressions en temps réel, trajets favoris, alertes par notification.
Exemple de référence : **Lille Flandres ↔ Amiens, ligne K44** — mais rien n'est propre à
cette ligne : tout fonctionne pour n'importe quelle ligne présente dans les données.

## 1. Sources de données

Toutes les données viennent du **Point d'Accès National** (transport.data.gouv.fr), jeu
« Réseau SNCF TGV, Intercités et TER » (producteur SNCF Voyageurs, licence **ODbL**).
**Aucune clé d'API** n'est nécessaire.

| Donnée | Format | URL (défaut) | Fréquence |
|---|---|---|---|
| Horaires théoriques | GTFS (zip ~7 Mo, ~85 Mo décompressé) | `https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip` | publié environ une fois par jour, couvre ~5 mois |
| Retards, suppressions | GTFS-RT Trip Updates (protobuf) | `https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates` | mis à jour ~toutes les 2 min (trains de l'heure à venir) |
| Perturbations | GTFS-RT Service Alerts (protobuf) | `https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts` | idem, change plus lentement |
| Tracés des voies | GTFS `shapes.txt` | — | **non publié par la SNCF** (voir § 12) |
| Positions des trains | GTFS-RT VehiclePosition | — (`TRAINS_RT_VEHICLES_URL`) | **non publié par la SNCF** (voir § 12) |

> Ces URL ont été vérifiées sur la fiche du jeu de données (ressources 83582 et 83196 du
> PAN) et dans un outil communautaire qui les consomme en production
> ([orhazal/sncf-gtfs-toolkit](https://github.com/orhazal/sncf-gtfs-toolkit)). Les
> conventions du flux décrites ci-dessous ont été constatées sur l'export SNCF réel du
> 2026-10-06 (60 185 trajets, 525 244 passages en gare, 740 lignes).

### Particularités du flux SNCF (toutes isolées dans `trains/providers/sncf.js`)

- **Calendrier** entièrement dans `calendar_dates.txt` (`calendar.txt` vide).
- **trip_id** : `OCESN843924F1187_F:TER:<ligne>::<UIC départ>:<UIC arrivée>:…:<fin de période>`.
  Il contient la date de fin de période : **il change à chaque version** du dataset
  (voir Favoris).
- **Numéro de train** = `trip_headsign` (zéros de tête retirés).
- **Gares** : `StopArea:OCE<UIC>` ; **quais** : `StopPoint:OCE<marque>-<UIC>` (un quai par
  marque : Train TER, Car TER, TGV INOUI…). La recherche se fait par gare.
- **Mode** : `_F:` (ferroviaire) ou `_R:` (routier, cars TER) dans le trip_id ; **marque**
  (TER, TGV INOUI, OUIGO…) lue au même endroit.
- **Homonymes** : deux lignes « K44 » existent (Lille Flandres – Amiens et Lyon Perrache –
  Valence). L'autocomplétion affiche le nom long ; un nom court tapé seul désigne toutes
  les lignes de ce nom ; une alerte de ligne exige une ligne précise.
- **GTFS-RT** : la relation « normale » est omise (= `SCHEDULED`) ; un train y est souvent
  désigné par son **identifiant interne court** (`OCESN843924F`, préfixe des trip_id
  statiques) + `start_date` ; les trains `ADDED` sont absents du théorique.

## 2. Architecture

```
frontend ──► backend VéloPulse ──► cache / fournisseurs ──► SNCF (PAN)
             (routes/trains.js)     (trains/)
```

Le frontend n'appelle **jamais** la SNCF : tout passe par le backend, qui mutualise les
appels (un seul téléchargement du flux pour tous les utilisateurs).

```
trains/
├── index.js               Registre des fournisseurs (TransportProvider) + santé
├── providers/sncf.js      SNCFProvider : URL + conventions du flux SNCF
├── gtfs/
│   ├── staticSchedule.js  StaticScheduleProvider : téléchargement conditionnel, cache disque, index
│   ├── staticIndex.js     Parsing GTFS → index mémoire compact (modèle normalisé)
│   ├── realtime.js        RealtimeTrainProvider : fetch + décodage protobuf + cache TTL
│   ├── gtfs-realtime.proto  Schéma officiel (google/transit)
│   ├── zip.js / csv.js    Lecture en flux (zip natif zlib, CSV RFC 4180)
│   └── time.js            Heures GTFS (> 24:00, changements d'heure)
├── merge.js               Fusion théorique + temps réel → TrainJourney (fonctions pures)
├── route.js               TrainRoute : itinéraire géographique (shapes.txt, sinon gare en gare)
├── vehicles.js            Positions : rattachement VehiclePosition → trajet, progression
├── service.js             TrainService : recherche, détail, favoris (couche métier)
├── alertLoop.js           Boucle d'alerte (idempotente)
└── notifier.js            Canal de notification (Web Push, extensible)
```

- **TransportProvider** = `{ schedule, realtime, conventions, service }`. Ajouter un
  réseau : un fichier dans `providers/` (URL GTFS, URL GTFS-RT, conventions — numéro de
  train, alias temps réel, mode) puis `register(createProvider(config))`. Le reste est du
  GTFS / GTFS-RT générique (`calendar.txt` est aussi pris en charge).
- **StaticScheduleProvider** et **RealtimeTrainProvider** ne se connaissent pas ; seule la
  couche métier (`merge.js`, `service.js`) les combine.
- Le domaine ne manipule jamais le GTFS brut : l'index expose des gares, lignes, trajets
  et passages normalisés ; le frontend reçoit des `TrainJourney`.

### Modèle `TrainJourney` (réponse API)

| Champ | Description |
|---|---|
| `id` | `trip_id|jour de service|gare départ|gare arrivée` (détail : `/api/trains/journey?id=`) |
| `lineId`, `lineName`, `line` | ligne (`{ id, name, longName, color, textColor }`) |
| `trainNumber`, `brand`, `mode` | numéro, marque (TER…), `train` ou `car` |
| `directionId` | sens sur la ligne (`direction_id` GTFS : 0 / 1), `null` s'il n'est pas publié |
| `departureStation`, `arrivalStation`, `terminus` | `{ id, name }` |
| `scheduledDeparture`, `estimatedDeparture` | ISO 8601 ; estimé `null` sans temps réel |
| `scheduledArrival`, `estimatedArrival` | idem |
| `departureDelay`, `arrivalDelay` | minutes (`null` sans temps réel) |
| `status` | `scheduled` (théorique), `on_time`, `delayed`, `cancelled` |
| `phase` | `upcoming`, `en_route`, `arrived` (null si supprimé) |
| `cancellation` | `null` ou `{ partial, reason }` (partiel : arrêt de départ/arrivée supprimé) |
| `realtime` | une mise à jour temps réel existe pour ce train |
| `alerts`, `disrupted` | perturbations (`scope` : trip, line, station ; `major`) |
| `stops` | (détail) tous les arrêts du trajet : `station` (`{ id, name, lat, lon }`), `seq` (stop_sequence), `stopId` (quai), horaires prévus / estimés, `delay`, `skipped`, `inJourney` |

### Règles de fusion

- Rattachement d'un Trip Update : trip_id exact, sinon alias SNCF (`OCESN…F`) parmi les
  trajets qui circulent le `start_date` ; sans `start_date`, jour déduit de l'horodatage
  du flux. `ADDED` non rattachable : ignoré.
- Retard **propagé** aux arrêts suivants jusqu'à la mise à jour suivante (spécification
  GTFS-RT) ; `NO_DATA` interrompt la propagation ; `SKIPPED` = arrêt supprimé.
- **Sans temps réel** (flux en panne, données de plus de 10 min, train absent du flux,
  date éloignée) : horaires théoriques, statut `scheduled` — **jamais** « supprimé ».
- Le temps réel n'est interrogé que pour des dates de la veille au lendemain.

## 3. Cache, synchronisation, performances

| Élément | Où | Durée |
|---|---|---|
| Index des horaires (≈ 50 Mo de tas pour la SNCF entière, construit en ~2 s) | mémoire | jusqu'à la version suivante |
| Zip GTFS + `Last-Modified` | disque (`TRAINS_CACHE_DIR`, défaut `data/gtfs/`) | évite un téléchargement au redémarrage |
| Trip Updates | mémoire | TTL 120 s (`TRAINS_RT_TTL_MS`) |
| Service Alerts | mémoire | TTL 300 s (`TRAINS_ALERTS_TTL_MS`) |
| Index temps réel (rattachement) | mémoire | une fois par instantané |
| Tracés (`TrainRoute`) | mémoire, attaché à l'index | jusqu'à la version suivante (2 000 trajets au plus) ; navigateur : 1 h + ETag |
| Positions (VehiclePosition), si publiées | mémoire | TTL 30 s (`TRAINS_RT_VEHICLES_TTL_MS`) |

- Démarrage : chargement **en arrière-plan** (le serveur répond tout de suite ; les
  routes trains renvoient 503 « en cours de chargement » quelques secondes, le client
  réessaie automatiquement).
- Synchronisation : `POST /cron/sync-trains` chaque nuit (GitHub Actions,
  `sync-rental-apps.yml`) — requête **conditionnelle** (`If-Modified-Since`) : 304 =
  rien n'est retéléchargé. À défaut de cron, revalidation au premier accès après 24 h.
  Une nouvelle version est indexée à côté de l'ancienne puis échangée (pas d'interruption).
- Temps réel : appels coalescés, jamais plus d'un par TTL quel que soit le nombre
  d'utilisateurs ; « Actualiser » force une relecture au plus toutes les 30 s ; le
  frontend rafraîchit toutes les 2 min seulement si la page est visible et la date proche.
- Aucune donnée GTFS en base : seules les données des utilisateurs y sont.

## 4. Base de données

| Table | Rôle |
|---|---|
| `train_favorites` | trajet précis : `train_number`, `line_id`/`line_name`/`line_long_name`, `origin_id`/`origin_name`, `destination_id`/`destination_name`, `departure_time` (heure théorique, HH:MM), `arrival_time`, `trip_id` (dernier connu, informatif), `label`. Unique par (compte, fournisseur, gares, heure, numéro). |
| `train_alerts` | `scope` = `trip` (`favorite_id`, un par favori) ou `line` (`line_id`, une par ligne) ; `delay_threshold` (min, trajet uniquement), `on_cancel`, `on_disruption`, `days`, `time_start`/`time_end` (ligne), `active`. |
| `train_notifications` | journal d'idempotence : `alert_id`, `event_key`, `type`, `sent_at` ; **unique (`alert_id`, `event_key`)** ; purgé après 45 jours. |

Suppression d'un favori ⇒ son alerte et son journal ; suppression du compte ⇒ tout.
Export RGPD : section `trains`.

## 5. Favoris : identifier un train d'une version à l'autre

Un favori n'est **pas** « K44 » : c'est « le train n° 843924, 16:53 Lille Flandres →
Amiens, ligne K44 ». Le `trip_id` change à chaque période / version : il n'est pas utilisé
pour retrouver le train. Pour une date donnée :

1. trajets qui desservent la gare de départ **puis** la gare d'arrivée (identifiants de gare
   UIC, stables) et circulent ce jour-là ;
2. **numéro de train identique**, au plus près de l'heure enregistrée (±90 min : horaire
   modifié → `scheduleChanged: true`, affiché « Horaire modifié ») → `match: exact` ;
3. sinon (train renuméroté) **même ligne** et heure à ±10 min → `match: approx` ;
4. sinon aucune circulation ce jour-là.

`GET /api/trains/favorites` renvoie pour chaque favori ses 3 prochaines circulations
(sur 8 jours) avec leur état temps réel.

## 6. Alertes et notifications

Boucle dédiée (`trains/alertLoop.js`), une passe par minute, sans chevauchement.

- **Due** : alerte de trajet de **3 h avant le départ prévu jusqu'à l'arrivée** (+2 h de
  marge), les jours choisis où le train circule ; alerte de ligne pendant son créneau
  (ou toute la journée) les jours choisis. Compte en pause (pause globale des alertes) :
  rien. Rien n'est téléchargé si aucune alerte n'est due.
- **Données non fraîches** (flux en panne ou > 10 min) : le cycle n'envoie rien.
- **Événements** (clé d'idempotence) :

| Événement | Clé | Notifié |
|---|---|---|
| Retard ≥ seuil | `delay:<jour>:<palier>` (palier = seuil, seuil+10, seuil+20…) | à la 1re atteinte puis à chaque aggravation de 10 min |
| Retard résorbé (≤ 2 min) | `delay_cleared:<jour>` | une fois, seulement si un retard a été notifié |
| Train supprimé (ou arrêt de départ/arrivée supprimé) | `cancel:<jour>` | une fois |
| Perturbation (trajet) | `alert:<id>` | une fois par perturbation |
| Perturbation importante (ligne) | `alert:<id>` | une fois par perturbation, même si elle dure des semaines |
| Train de la ligne supprimé | `cancel:<jour>:<numéro>` | une fois par train |

L'événement est **enregistré avant l'envoi** (`INSERT … ON CONFLICT DO NOTHING`) : s'il
existe déjà, rien ne part — même si deux cycles se chevauchaient. Une variation de retard
dans le même palier (10 → 14 min) n'est pas un nouvel événement.

« Perturbation importante » : effet GTFS-RT `NO_SERVICE`, `REDUCED_SERVICE`,
`SIGNIFICANT_DELAYS`, `DETOUR`, `MODIFIED_SERVICE`, `STOP_MOVED`, `UNKNOWN_EFFECT` (la SNCF
ne renseigne pas toujours l'effet) ou sévérité `SEVERE`.

**Canal** : Web Push (PWA) via l'envoi existant (`push.js` → tous les appareils du
compte). `trains/notifier.js` est le seul point à étendre pour un autre canal (e-mail…).
Les notifications ouvrent le détail du trajet (`/trains/trajet?id=…`) ou, pour une ligne, la page Alertes (`/alertes?type=trains`).

Texte des notifications : titre court qui identifie le train et son état (`K44 16:53 Lille Flandres → Amiens · +12 min` / `· Supprimé` / `· Perturbé` / `· À l'heure`, `Ligne K44 · Perturbation` / `· Train supprimé`) ; corps factuel rédigé par l'app (nouvelles heures, cause). Le texte SNCF n'est qu'un complément : converti en texte brut (les messages SNCF contiennent du HTML, jamais rendu), sans lignes génériques ni liens, 140 caractères au plus.

## 7. API

Publiques (données ouvertes) :

| Route | Rôle |
|---|---|
| `GET /api/trains/status` | fournisseurs, version et validité des horaires |
| `GET /api/trains/stations?q=lill` | autocomplétion des gares (≥ 2 caractères) |
| `GET /api/trains/lines?q=K44` | recherche de lignes |
| `GET /api/trains/search?from=&to=&line=&date=&after=&refresh=1` | trains d'un jour (au moins une gare ou une ligne ; `line` = identifiant ou nom court ; `after` = HH:MM) |
| `GET /api/trains/journey?id=` | détail d'un trajet + `position` (voir § 12) |
| `GET /api/trains/route?id=` | itinéraire géographique (`TrainRoute`) — `Cache-Control: max-age=3600`, `ETag` |

Réponse de recherche : `{ ok, date, count, journeys, realtime: { applicable, available,
updated_at, age_s }, coverage: { from, until }, out_of_coverage, truncated, lines, directions }`
(`directions` : recherche par ligne aux deux sens → `[{ id, label }]`, label = terminus le plus
fréquent du sens ; sinon `null`).
Erreurs : 400 (paramètres), 404 (gare / ligne / trajet inconnus), 503 (horaires en
chargement). Une date hors période renvoie une liste vide avec `out_of_coverage`.

Protégées (JWT) :

| Route | Rôle |
|---|---|
| `GET /api/trains/favorites` | favoris + prochaines circulations + alerte ; `line_alerts` |
| `POST /api/trains/favorites` `{ journey_id }` | ajoute (données relues côté serveur) |
| `PATCH /api/trains/favorites/:id` `{ label }` | renomme |
| `DELETE /api/trains/favorites/:id` | retire (et son alerte) |
| `GET /api/trains/alerts` | alertes trains (une alerte de trajet porte le résumé de son favori : `favorite`) |
| `POST /api/trains/alerts` | trajet : `{ scope:'trip', favorite_id | journey_id, delay_threshold, on_cancel, on_disruption, days }` ; ligne : `{ scope:'line', line, on_cancel, on_disruption, time_start, time_end, days }` |
| `PATCH /api/trains/alerts/:id` | modifie (portée et favori non modifiables) |
| `DELETE /api/trains/alerts/:id` | supprime |

Cron (`CRON_SECRET`) : `POST /cron/sync-trains`. Santé : section `trains` de `/api/health`.
Limites : 50 favoris, 30 alertes trains par compte.

## 8. Variables d'environnement

Toutes facultatives (les sources SNCF sont publiques).

| Variable | Défaut | Rôle |
|---|---|---|
| `TRAINS_ENABLED` | (activé) | `0` : ne charge pas les horaires et n'active pas la boucle |
| `TRAINS_GTFS_URL` | export SNCF | dataset GTFS |
| `TRAINS_RT_TRIP_UPDATES_URL` / `TRAINS_RT_ALERTS_URL` | proxy PAN | flux GTFS-RT |
| `TRAINS_CACHE_DIR` | `data/gtfs` | cache disque du zip |
| `TRAINS_GTFS_REFRESH_H` | 24 | revalidation paresseuse |
| `TRAINS_GTFS_TIMEOUT_MS` | 120000 | téléchargement du zip |
| `TRAINS_RT_TTL_MS` / `TRAINS_ALERTS_TTL_MS` | 120000 / 300000 | cache temps réel |
| `TRAINS_RT_TIMEOUT_MS` | 15000 | délai d'un appel GTFS-RT |
| `TRAINS_RT_MAX_AGE_MS` | 600000 | au-delà, temps réel ignoré |
| `TRAINS_RT_VEHICLES_URL` | (aucune) | flux GTFS-RT VehiclePosition, si une source en publie un (la SNCF non) |
| `TRAINS_RT_VEHICLES_TTL_MS` | 30000 | cache des positions |
| `CRON_SECRET` | — | requis pour `/cron/sync-trains` |

## 9. Développement local

```bash
npm install && npm run dev          # backend : télécharge le GTFS au 1er lancement (data/gtfs/)
cd frontend && npm install && npm run dev
npm test                            # backend : données SNCF simulées, aucun réseau
cd frontend && npm test
```

Sans accès réseau à la SNCF, placer un export dans `data/gtfs/sncf.zip` avec
`data/gtfs/sncf.json` = `{"lastModified": null, "savedAt": <ms epoch>}` : il est chargé
sans téléchargement. Pour simuler le temps réel, pointer `TRAINS_RT_*_URL` vers un
serveur local qui sert des FeedMessage encodés (`encodeFeed` de `trains/gtfs/realtime.js`).

Tests : `test/trainsFixture.js` construit un dataset au format SNCF (deux K44, car TER,
train de nuit après minuit, calendar_dates) et des flux GTFS-RT ; `test/helpers.js`
intercepte les hôtes SNCF (`sncf.gtfs`, `sncf.tripUpdates`, `sncf.alerts`,
`sncf.vehicles`, `sncf.failRealtime`). `buildGtfs({ shapes: true })` ajoute un
`shapes.txt` ; `vehiclesFeed()` encode des positions ; `test/trains.map.test.js` crée
un fournisseur de test doté d'un flux de positions fictif.

## 10. Déploiement

Rien de plus à configurer sur Render : les sources sont publiques. Prévoir :
- la mémoire : ~50 Mo de tas pour l'index, pic d'environ 200 Mo de RSS pendant la
  construction (compatible 512 Mo) ; `TRAINS_ENABLED=0` pour désactiver ;
- le secret GitHub `CRON_SECRET` / `BACKEND_URL` (déjà utilisés) : le workflow quotidien
  appelle aussi `/cron/sync-trains`.
- le disque de Render est éphémère : après un redéploiement, le zip est retéléchargé
  (~7 Mo) au démarrage.

## 11. Limitations connues

- **Trajets directs uniquement** : pas de calcul d'itinéraire avec correspondance.
- **Quais** : non publiés dans ces flux (ni théorique ni temps réel).
- **Carte** : ni tracé des voies ni position des trains publiés par la SNCF — tracé
  approximatif de gare en gare et avancement estimé d'après les horaires (§ 12).
- **Temps réel limité à l'heure à venir** : la SNCF publie les Trip Updates pour les
  trains proches ; avant, un train apparaît « Horaire théorique » (les suppressions
  anticipées arrivent souvent par les Service Alerts, affichées sur le trajet).
- **Trains ajoutés** (`ADDED`) non affichables : absents du théorique, sans ligne ni horaire.
- **Dates passées** : le dataset SNCF commence le jour de sa publication ; une date
  antérieure renvoie une liste vide (« horaires disponibles du … au … »).
- **Périodes des perturbations** : rattachées par chevauchement avec l'horaire du train
  (le flux ne date pas les trains qu'il cite).
- Une gare « ville » (« Lille, toutes gares ») n'existe pas dans le GTFS : il faut choisir
  Lille Flandres ou Lille Europe.

## 12. Cartographie : tracés et positions

Page `/trains/carte?id=<TrainJourney>` (« Carte » sur chaque résultat, « Voir sur la
carte » dans le détail ; les trains favoris de Mes trajets utilisent les mêmes cartes) :
tracé du trajet, portion du voyageur, gares cliquables (horaires prévus / estimés,
retard, état), position du train quand elle existe, prochaines gares, stations Vélam en
option (trajets passant par Amiens).

### Ce que publie (ou non) la SNCF — vérifié, pas supposé

- **Tracés** : l'export GTFS SNCF n'a **pas de `shapes.txt`** et `shape_id` est vide pour
  les 60 185 trajets (export du 2026-10-06). Le tracé affiché est donc une **ligne de gare
  en gare** (`geometrySource: 'stops'`), dessinée en pointillés et signalée
  « Tracé approximatif ». Aucun service externe n'est appelé pour le recalculer.
- **Positions** : le PAN ne propose pour la SNCF que les flux **Trip Updates** et
  **Service Alerts** ; **aucun flux VehiclePosition**. Aucune position n'est inventée :
  l'avancement (« Prochaine gare : Arras ») est **estimé d'après les horaires** (estimés
  si le temps réel en donne, théoriques sinon) et présenté comme tel.

Le code prend en charge les deux dès qu'une source les fournit : un GTFS avec
`shapes.txt` donne le tracé réel (`'shape'`) ; `TRAINS_RT_VEHICLES_URL` (ou
`vehiclePositionsUrl` d'un fournisseur) active les positions.

### Modèle `TrainRoute` (`GET /api/trains/route`)

| Champ | Description |
|---|---|
| `tripId`, `shapeId` | trajet GTFS ; `shapeId` null sans tracé publié |
| `geometrySource` | `shape` (shapes.txt) ou `stops` (gare en gare, approximatif) |
| `geometry` | GeoJSON `LineString` ([lon, lat], précision ~1 m) |
| `distanceKm`, `bbox`, `direction` | longueur du tracé, emprise `[O, S, E, N]`, `direction_id` |
| `stops` | toutes les gares du trajet `{ station: { id, name, lat, lon }, seq }` |
| `segment` | `{ from, to }` : positions des gares de montée et de descente du voyageur |
| `line`, `trainNumber`, `datasetVersion` | ligne, numéro, version des horaires |

Ne dépend que du trajet et de la version des horaires : calculé une fois par version
(cache attaché à l'index, libéré avec lui), mis en cache 1 h par le navigateur
(revalidation `ETag`). `shapes.txt` est lu en flux au chargement du GTFS ; seuls les
tracés utilisés par un trajet sont gardés (`Float64Array`).

### Bloc `position` de `GET /api/trains/journey`

```
position: {
  available,     // le fournisseur publie-t-il des positions ? (SNCF : false)
  upstream_ok,   // dernier appel du flux de positions réussi (null si non interrogé)
  vehicle,       // null, ou { lat, lon, bearing, speedKmh, updatedAt, ageS, stale,
                 //   currentStatus, currentStopSequence, stopId, vehicleId }
  progress,      // null (supprimé), ou { basis: 'position' | 'schedule',
                 //   state: 'not_departed' | 'at_stop' | 'between' | 'arrived',
                 //   previous, next, upcoming: [indices dans journey.stops] }
}
```

### Rattachement d'une position à un trajet (`trains/vehicles.js`, côté serveur)

`VehiclePosition → trip → TrainJourney → TrainRoute`, par ordre de préférence :

1. `trip_id` exact (+ `start_date`, sinon jour déduit de l'horodatage) ;
2. alias du fournisseur (SNCF : `OCESN843924F` + `start_date`) ;
3. `route_id` + `start_date` + `start_time` (+ `direction_id` si fourni).

Un véhicule sans descripteur de trajet (seulement `vehicle_id`) n'est **jamais** rattaché
par son numéro ou son libellé. Le frontend ne fait aucun rapprochement : il reçoit la
position déjà associée au trajet. L'index des positions est calculé une fois par
instantané du flux.

### Fraîcheur et progression

- Position de moins de 5 min : « Position mise à jour il y a 30 s » ; de 5 à 30 min :
  `stale`, « Position connue il y a 8 min » (marqueur grisé, jamais présentée comme
  actuelle, avancement calculé sur les horaires) ; au-delà de 30 min : masquée.
- Progression : avec une position fraîche, arrêt courant du flux (`current_stop_sequence`
  / `stop_id` + `current_status`), sinon projection sur la ligne des gares ; sans
  position, horaires. Les gares supprimées (`SKIPPED`) sont retirées des prochaines gares.
- Le flux de positions n'est lu que pour un train **proche de son horaire** (30 min avant
  le départ → 1 h après l'arrivée) et jamais pour un train supprimé.

### Cas dégradés

| Cas | Comportement |
|---|---|
| Fournisseur sans positions (SNCF) | tracé + gares + avancement « estimé d'après les horaires » |
| Flux de positions en panne | idem, « Positions indisponibles pour le moment » |
| Train absent du flux / non rattaché | idem, « Position de ce train indisponible » |
| Position ancienne (> 5 min) | marqueur grisé, « Position connue il y a … » |
| Pas de `shapes.txt` / `shape_id` inconnu | tracé de gare en gare, pointillés |
| Temps réel indisponible | horaires théoriques (bandeau habituel) |
| Train supprimé | tracé et gares, ni position ni avancement |
| Retard sans position | avancement d'après les horaires **estimés** |
| Pas de token Mapbox | panneau (avancement, gares) sans carte |

### Actualisation

Carte : 30 s quand le fournisseur publie des positions pour un train en route, sinon
2 min (rythme du temps réel SNCF), uniquement page visible. Le tracé n'est jamais
rechargé (statique).

### Côté carte (frontend)

- `pages/TrainMapPage.jsx` (lazy) : carte + panneau (prochaine gare, base du calcul,
  fraîcheur, liste des gares).
- `components/map/TrainMap.jsx` : carte Mapbox ; couches de `components/map/layers.js`,
  conçues pour une carte commune vélos + trains : `TrainRoutesLayer`,
  `RailwayStationsLayer`, `TrainPositionsLayer` (marker DOM orienté selon le cap),
  `BikeStationsLayer`. Couleurs lues dans les variables CSS du thème ; couches
  réinstallées après un changement de thème (`setStyle` sans diff).
- `lib/trainMap.js` : logique pure (textes, GeoJSON, vue initiale), testée sans Mapbox.

### Ajouter une source de tracés ou de positions

- **Tracés** : un fournisseur dont le GTFS contient `shapes.txt` n'a rien à faire. Pour la
  SNCF, une évolution possible serait de construire les tracés à partir du référentiel
  des lignes SNCF Réseau ou d'OpenStreetMap (map-matching gare à gare, hors ligne, mis en
  cache par version) : non fait aujourd'hui.
- **Positions** : renseigner `vehiclePositionsUrl` dans la configuration du fournisseur
  (`providers/<id>.js`) ou `TRAINS_RT_VEHICLES_URL`. Si le flux désigne les trains
  autrement, ajouter la règle dans `conventions.realtimeAliases` du fournisseur.
