# Changelog

Toutes les évolutions notables de VéloPulse. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en
[SemVer](https://semver.org/lang/fr/).

**Publier une version** : mettre à jour `version` dans `package.json` **et**
`frontend/package.json` (un test vérifie qu'elles sont identiques), ajouter la
section `## [x.y.z] - AAAA-MM-JJ` ci-dessous, puis merger sur `main` : le workflow
`release.yml` crée le tag `vx.y.z` et la release GitHub à partir de cette section.

## [1.8.0] - 2026-10-07

### Carte des trains
- **« Carte »** sur chaque train (résultats de recherche, Mes trajets) et **« Voir sur la
  carte »** dans le détail : le trajet, toutes ses gares (horaires prévus / estimés,
  retard, gare desservie, prochain arrêt, arrêt supprimé), votre portion du trajet en
  couleur de ligne, et les stations Vélam en option pour les trajets passant par Amiens.
- **Où en est le train** : « Prochaine gare : Arras · arrivée 17:30 · +3 min », « En gare
  de Douai », « Arrivé à Amiens », avec la liste des gares restantes — aussi rappelé dans
  le détail du trajet.
- **Transparence sur les données** : la SNCF ne publie ni le tracé des voies ni la
  position des trains. Le tracé affiché est donc approximatif (de gare en gare, en
  pointillés) et l'avancement est « estimé d'après les horaires » (estimés en cas de
  retard) — aucune position n'est inventée.
- Prêt pour les sources qui publient davantage : tracé réel (GTFS `shapes.txt`) et
  positions en temps réel (GTFS-RT VehiclePosition, `TRAINS_RT_VEHICLES_URL`) avec
  « Position mise à jour il y a 30 s » / « Position connue il y a 8 min », marqueur
  orienté et actualisation toutes les 30 s.

### Technique
- `GET /api/trains/route?id=` : itinéraire (`TrainRoute`), mis en cache par version des
  horaires et 1 h par le navigateur (`ETag`). `GET /api/trains/journey` : bloc `position`
  (disponibilité, position, progression) ; arrêts avec `seq` / `stopId`.
- Rattachement des positions au trajet côté serveur (trip_id, alias SNCF, ligne + heure
  de départ ; jamais par le seul véhicule). État du flux de positions dans `/api/health`.
- Couches de carte réutilisables (`components/map/layers.js`) pour une future carte
  commune vélos + trains. Documentation : `docs/TRAINS.md` § 12.

## [1.7.0] - 2026-10-07

### Nouvelle organisation : 4 onglets
- **Mes trajets** (accueil) : tout ce que vous suivez, vélo et train, avec l'état actuel —
  vos trains favoris (retard, prochaines circulations, alerte) puis vos stations Vélam.
- **Correspondance train ↔ Vélam** : pour chaque train, la station Vélam la plus proche
  de la gare de départ (places libres pour déposer votre vélo) et de la gare d'arrivée
  (vélos pour repartir), à moins d'1 km.
- **Vélos** : les stations en liste ou sur la carte (dernier affichage mémorisé).
- **Trains** : la recherche (les trains suivis sont dans Mes trajets).
- **Alertes** : alertes vélos et alertes trains (trajets et lignes suivies) au même
  endroit ; « Suivre une ligne » depuis l'onglet ; pause et notifications communes.
- Les anciennes adresses (favoris, stations, carte, Mes trains) redirigent vers la
  nouvelle page ; page d'ouverture (Paramètres) : Mes trajets, Vélos ou Trains ;
  raccourcis de l'app et tutoriel mis à jour.

### Notifications
- **Paramètres › Notifications** : couper séparément les **alertes vélos** ou les
  **alertes trains**, pour tous vos appareils (les alertes sont conservées, simplement
  plus envoyées). La page Alertes le rappelle quand un type est coupé.

## [1.6.2] - 2026-10-07

### Trains
- Événements d'un train : les messages SNCF s'affichaient avec leurs balises HTML ; ils
  sont désormais convertis en texte (côté serveur, pour l'app comme pour les notifications).
- Notifications trains réécrites : titre court qui identifie le train et son état
  (« K44 16:53 Lille Flandres → Amiens · +12 min », « · Supprimé », « · Perturbé »,
  « Ligne K44 · Perturbation »), corps factuel (« Départ 17:05 au lieu de 16:53 »,
  « Cause : travaux ») ; le texte SNCF n'est plus qu'un complément, sans ses formules
  génériques (« Plus d'informations : … »).
- Recherche : champ « À partir de » corrigé sur iPhone (champ heure natif écrasé) ;
  « Toute la journée » pour l'effacer.

### Partout
- **Tirer pour actualiser** : tirer la page vers le bas remplit un anneau ; relâché
  plein, la page se recharge (Stations, Favoris, Trains, détail d'un train).

## [1.6.1] - 2026-10-07

### Déploiement
- Le build installe désormais aussi les dépendances du serveur (`npm run build`) : le
  déploiement de la 1.6.0 échouait au démarrage (`Cannot find module 'protobufjs'`), la
  nouvelle dépendance n'étant pas présente dans le cache de Render. La 1.5.2 était restée
  en ligne.

## [1.6.0] - 2026-10-07

### Trains (nouveau)
- Nouvel onglet **Trains** : recherche par trajet (Lille Flandres → Amiens, sens
  inversable), par gare seule, ou par ligne (K44), pour le jour choisi, avec une heure de
  départ minimale facultative. Gares et lignes proposées depuis les données SNCF
  (autocomplétion), jamais une liste en dur.
- Pour chaque train : ligne, numéro, gares, heures prévues et — seulement si elles
  diffèrent — estimées, retard en minutes, statut (à l'heure, en retard, supprimé,
  horaire théorique), suppression et perturbations annoncées.
- Temps réel SNCF (GTFS-RT) actualisé automatiquement toutes les 2 min tant que la page
  est visible, bouton **Actualiser**, et origine des données toujours indiquée
  (« Temps réel — mis à jour il y a 1 min » / « Horaires théoriques »).
- Filtres (heures, ligne, gares, état) et tris (départ, arrivée, retard).
- Page de détail d'un train : horaires, retard, événements, tous les arrêts.
- **Mes trains** : trajets favoris précis (un train à une heure, pas une ligne) avec leur
  état actuel et leurs prochaines circulations, retrouvés même quand la SNCF publie de
  nouveaux horaires.
- **Alertes trains** (notifications) : retard au-delà d'un seuil (+5, +10, +15, +30 min,
  puis à chaque aggravation de 10 min et quand le retard se résorbe), suppression,
  perturbation ; suivi d'une **ligne entière** (perturbations importantes, trains
  supprimés, créneau horaire facultatif). Jamais deux notifications pour le même
  événement.

### Technique
- Module `trains/` (fournisseurs de transport extensibles) : horaires GTFS indexés en
  mémoire (aucune copie en base), GTFS-RT décodé avec le schéma officiel, cache
  mutualisé côté serveur ; nouvelles tables `train_favorites`, `train_alerts`,
  `train_notifications` ; `POST /cron/sync-trains` (synchronisation quotidienne).
- Export RGPD et suppression du compte incluent les données trains.

## [1.5.2] - 2026-09-30

### Alertes
- Cartes d'alerte : le mot « vélo » disparaît (« ≤ 1 · 08:00–09:00 ») ; les vélos
  surveillés sont indiqués par icônes (⚡ électriques, 🚲 mécaniques, les deux pour « Les
  deux »). Les alertes sur les places libres gardent le mot « places ».

## [1.5.1] - 2026-09-30

### Connexion et inscription
- Page retravaillée : présentation de l'app, choix Connexion / Inscription, champs plus
  grands (pas de zoom sur iPhone), bouton pour **afficher le mot de passe**, pas de
  majuscule automatique sur le nom d'utilisateur.
- Inscription : **confirmation du mot de passe** (il n'est pas récupérable) et
  vérifications avant envoi (8 caractères minimum, nom de 32 caractères maximum).

### Stations et favoris
- Cartes de station : l'état n'est plus qu'une **pastille de couleur** (vert : ouverte,
  orange : faible disponibilité, rouge : hors service) ; le libellé reste dans la fiche
  de la station.

### Alertes
- Supprimer une alerte n'affiche plus « Alerte introuvable » : l'alerte disparaît de la
  liste tout de suite, et un second appui pendant l'enregistrement est ignoré.
- Le bouton « Modifier » est retiré : on ouvre l'alerte en touchant son nom.
- Groupes « au plus N » : la mention « toutes » est retirée (« ≤ 1 vélo · 08:00–09:00 »).
- La notification de test n'est plus sur la page Alertes, uniquement dans
  **Paramètres › Notifications**.

### Corrections
- Glisser pour supprimer (Alertes, Favoris) : le bouton rouge est détaché de la carte,
  avec des coins arrondis, et ne dépasse plus aux coins au repos.
- Page Stations (téléphone) : la pastille d'état et l'étoile favori sont alignées en haut
  à droite, les compteurs ne passent plus sur deux lignes.

## [1.5.0] - 2026-09-30

### Résumés à plusieurs heures
- Un même résumé peut désormais être envoyé à **plusieurs heures** de la journée (jusqu'à 6,
  par exemple 7 h 45 et 18 h), les jours choisis : « Ajouter une heure » dans le formulaire.
- Chaque heure est envoyée une seule fois par jour ; les résumés existants gardent leur heure.

### Tutoriel
- **Tutoriel de présentation** en plein écran au premier lancement après connexion : quelques slides
  (stations, carte, favoris, alertes, résumés, paramètres), « Suivant » ou glisser pour
  avancer, « Arrêter le tutoriel » à tout moment. Montré une seule fois par compte, puis
  suivi de l'accueil pratique (installer, notifications, favoris).
- Le tutoriel peut être revu depuis **Paramètres › Préférences**.

### Interface
- Le bouton clair / sombre de l'en-tête est retiré : le thème se règle dans
  **Paramètres › Préférences** (clair, sombre ou automatique).
- **Zoom au pincement et au double appui désactivé** dans l'application (la carte reste
  zoomable). Sur iPhone, un champ de saisie s'agrandit toujours au toucher, et l'écran
  revient à sa taille normale dès qu'on le quitte.

### Corrections
- Notification → Vélam : le bouton « Ouvrir l'app Vélam », qui ne fonctionnait pas, est
  retiré ; l'ancien lien « Site Vélam », qui fonctionne, prend sa place sous ce nom.

### Alertes
- **Cartes d'alerte allégées** : le type (alerte 🔔 / résumé 🕐) est une pastille en tête de
  carte, le type de vélo une icône (⚡ électrique, 🚲 mécanique) — plus de mention en texte ;
  un résumé n'affiche que ses heures (« 07:45, 18:00 »).
- **Jours modifiables directement sur la carte** (appui sur une pastille), sans ouvrir l'alerte.
- **Supprimer** : en glissant la carte vers la gauche, ou depuis le formulaire de
  modification (« Supprimer l'alerte », avec confirmation).
- **Dupliquer une alerte** (bouton sur chaque carte) : ouvre le formulaire pré-rempli
  pour ajuster station, horaires… avant de créer la copie ; un groupe nommé devient
  « Maison (copie) ».
- Alertes et résumés de groupe **nommés** : la liste n'affiche plus que le nom du groupe
  (« Maison »), plus le détail des stations — visible en modifiant l'alerte.

## [1.4.1] - 2026-09-29

### Corrections
- Notification → app Vélam : l'app s'ouvre sur appui du bouton « Ouvrir l'app Vélam »
  (l'ouverture automatique affichait « adresse non valide » sur iPhone) ; lien et store
  choisis selon le téléphone (iPhone / Android).
- Carte, « Autour de moi » : les 3 stations proposées suivent les filtres (type de vélo,
  nombre minimum) même modifiés après coup, et les disponibilités à jour.

## [1.4.0] - 2026-09-29

### Paramètres
- « Mon compte » devient **Paramètres**, en trois onglets : Préférences, Notifications, Sécurité.
- **Préférences** (propres à l'appareil) : thème clair / sombre / **automatique** (suit le
  réglage du téléphone), **type de vélo par défaut** (alertes, filtres Stations et Carte),
  **page d'ouverture** de l'application.
- **Notifications** : activer ou couper les notifications de cet appareil, notification de
  test ; la page Alertes signale les notifications coupées et propose de les réactiver.
- **Sécurité** : liste des **appareils connectés** (type, dernière activité) avec
  déconnexion d'un appareil ou de tous les autres ; changer de mot de passe déconnecte les
  autres appareils ; **export de toutes ses données** ; suppression du compte.
- Bouton **Partager VéloPulse** (feuille de partage, sinon lien copié).

### Corrections
- Notification → app Vélam : on peut désormais **revenir dans VéloPulse** (la page
  intermédiaire n'ouvre plus le site Vélam à la place de l'application, et son script
  n'est plus bloqué).
- Le bouton « Installer » n'apparaît plus quand l'application est déjà installée.

## [1.3.1] - 2026-09-29

### Amélioration
- Création d'une alerte : le créneau proposé va de **l'heure actuelle à +30 min**
  (au lieu de 08:00–10:00, ou d'1 h 30 depuis une fiche station).

## [1.3.0] - 2026-09-29

### Alertes
- **Groupe de stations** : une alerte peut surveiller 2 à 5 stations proches
  (avec un nom facultatif, ex. « Maison »). « Il en reste peu » ne prévient que si
  **toutes** les stations sont basses, « il y en a de nouveau » dès qu'**une** suffit.
  Une seule notification, avec le détail par station.
- **Résumé à heure fixe** : nouveau type d'alerte. Les jours choisis, à l'heure
  choisie, le nombre de vélos (mécaniques, électriques ou les deux) de 1 à 5
  stations. Jamais envoyé avec des chiffres périmés ; abandonné s'il ne peut pas
  partir dans les 15 minutes.
- Page Alertes : **filtre** par type (disponibilité / résumés) et **tri** par heure,
  par nom ou plus récentes ; les alertes désactivées passent en fin de liste.

## [1.2.1] - 2026-09-25

### Corrections
- Une seule mesure de position sert désormais à Favoris, Stations et Carte
  (« Autour de moi »), réutilisée 2 minutes, au lieu d'une mesure GPS par page affichée.
- Position refusée : message explicite et bouton « Réessayer » ; « Localisation… »
  pendant la mesure.

## [1.2.0] - 2026-09-25

### Compte et vie privée
- Page **Mon compte** : changer son mot de passe, **supprimer son compte** (toutes
  les données sont effacées), se déconnecter.
- Page **Confidentialité et mentions légales** : ce qui est enregistré, ce qui ne
  l'est pas, vos droits, les services tiers.
- À l'inscription, rappel qu'un mot de passe oublié ne peut pas être récupéré
  (aucun e-mail n'est demandé).
- Polices hébergées par l'application : plus aucun appel à Google, et affichage
  identique hors ligne.

### Ergonomie
- La carte passe en **fond sombre** avec le thème sombre.
- **Étoile** dans la liste des stations (mobile) pour ajouter un favori en un geste.

### Technique
- Passage à **Node 22 LTS** (Node 20 n'est plus maintenu) ; better-sqlite3 12.
- `/api/health` indique l'état de la boucle d'alerte et du flux Vélam (`ok` / `degraded`).
- Suppression de l'ancienne page `/redirect`, inutilisée.

## [1.1.2] - 2026-09-25

### Corrections
- Le message de fraîcheur n'est plus affiché station par station (il se fiait au
  signal de chaque borne, souvent trompeur). Il est remplacé par un **bandeau
  global** quand le flux Vélam ne répond plus ou répond mal au serveur VéloPulse,
  ou que ses données ont 5 minutes ou plus : « Disponibilités non mises à jour
  depuis 7 min — données de 14:33 ». Les dernières données connues restent affichées.
- Aucune alerte n'est envoyée tant que les disponibilités ne sont pas à jour.
- Rafraîchissement immédiat quand l'app revient au premier plan.

## [1.1.1] - 2026-09-25

### Corrections
- « Dernière info il y a… » s'affiche dès que le nombre de vélos d'une station n'a
  pas été mis à jour depuis **5 minutes** ou plus (au lieu d'une heure).

## [1.1.0] - 2026-09-24

Des alertes pensées pour le trajet quotidien, et une consultation plus fiable.

### Alertes
- **Alerte « trajet »** : station de départ + station d'arrivée. Vous êtes prévenu
  s'il manque des vélos au départ **ou** des places à l'arrivée.
- **Station de repli** dans la notification : « Gare : 0 vélo · Repli : Cathédrale
  (350 m) : 6 vélos » (station la plus proche, à moins de 1 km).
- **Alerte sur les places libres**, pour savoir où déposer son vélo.
- **« Il y en a de nouveau »** : être prévenu quand des vélos (ou des places)
  redeviennent disponibles.
- **Alerte ponctuelle** (« aujourd'hui seulement »), supprimée automatiquement ensuite.
- **Pause de toutes les alertes** jusqu'à une date (vacances, télétravail).
- **Notification de test** depuis la page Alertes.
- **Créer une alerte depuis la fiche d'une station**, formulaire pré-rempli.

### Favoris et consultation
- **Favoris renommables** (« Maison », « Travail ») et **ordre personnalisé**.
- **« Dernière info il y a 2 h »** quand une borne ne remonte plus de données.
- **Vélos indisponibles** affichés dans la fiche station.
- Carte : bouton **« Autour de moi »** (les 3 stations les plus proches avec des vélos).
- **Raccourcis** Favoris / Carte / Alertes par appui long sur l'icône de l'app.
- **Accueil en 3 étapes** au premier lancement (installer, notifications, favoris).

### Corrections
- Modifier une alerte la réarme : elle peut de nouveau notifier le jour même.
- Nouvelles stations Vélam ajoutées et stations supprimées retirées chaque jour
  (le référentiel n'était jamais rafraîchi).
- Une station qui ne loue pas / ne reprend pas les vélos compte pour 0 vélo / 0 place.
- Plus de modale d'installation juste après l'accueil ; activation des
  notifications qui ne peut plus rester bloquée.

## [1.0.0] - 2026-09-24

Première version stable de VéloPulse, l'application de suivi des stations Vélam d'Amiens.

### Fonctionnalités
- Liste des stations en temps réel (vélos électriques / mécaniques, places libres),
  recherche, filtres et tri par proximité.
- Carte interactive Mapbox des stations.
- Compte utilisateur, favoris (suppression par glissement sur mobile).
- Alertes de disponibilité par station, type de vélo, créneau horaire et jours,
  notifiées par Web Push ; le lien de la notification ouvre l'app Vélam (ou le store / le site).
- Application installable (PWA) sur iOS et Android, thème clair / sombre.
- **Mode hors ligne** : l'app s'ouvre sans réseau et affiche la dernière liste des
  stations et des favoris, avec l'heure de la dernière mise à jour.

### Corrections
- Plus besoin de se déconnecter / reconnecter pour retrouver ses favoris et alertes :
  session glissante de 30 jours, et retour propre à l'écran de connexion si elle expire.
- La permission de notification n'est plus demandée à chaque démarrage : uniquement
  sur clic, depuis la page Alertes.
- Relance automatique des requêtes au réveil du serveur ; la liste des favoris n'est
  plus vidée par une erreur passagère.
- Un téléphone partagé ne reçoit plus les alertes de plusieurs comptes ; la
  déconnexion détache l'appareil.
- Les heures d'alerte sont évaluées à l'heure de Paris (et non en UTC).

### Sécurité
- En-têtes de sécurité (CSP), limitation des tentatives de connexion, jetons HS256.
- Rechargement du référentiel des stations réservé aux utilisateurs connectés.

### Technique
- Tests automatisés : backend (SQLite et PostgreSQL) et frontend, exécutés sur chaque PR.
- Déploiement automatique sur Render à chaque merge sur `main`.

[1.2.1]: https://github.com/p0p314/velam-notifier/releases/tag/v1.2.1
[1.2.0]: https://github.com/p0p314/velam-notifier/releases/tag/v1.2.0
[1.1.2]: https://github.com/p0p314/velam-notifier/releases/tag/v1.1.2
[1.1.1]: https://github.com/p0p314/velam-notifier/releases/tag/v1.1.1
[1.1.0]: https://github.com/p0p314/velam-notifier/releases/tag/v1.1.0
[1.0.0]: https://github.com/p0p314/velam-notifier/releases/tag/v1.0.0
