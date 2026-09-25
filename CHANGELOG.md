# Changelog

Toutes les évolutions notables de VéloPulse. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en
[SemVer](https://semver.org/lang/fr/).

**Publier une version** : mettre à jour `version` dans `package.json` **et**
`frontend/package.json` (un test vérifie qu'elles sont identiques), ajouter la
section `## [x.y.z] - AAAA-MM-JJ` ci-dessous, puis merger sur `main` : le workflow
`release.yml` crée le tag `vx.y.z` et la release GitHub à partir de cette section.

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
