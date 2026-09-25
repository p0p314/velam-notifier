# Changelog

Toutes les évolutions notables de VéloPulse. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en
[SemVer](https://semver.org/lang/fr/).

**Publier une version** : mettre à jour `version` dans `package.json` **et**
`frontend/package.json` (un test vérifie qu'elles sont identiques), ajouter la
section `## [x.y.z] - AAAA-MM-JJ` ci-dessous, puis merger sur `main` : le workflow
`release.yml` crée le tag `vx.y.z` et la release GitHub à partir de cette section.

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

[1.1.0]: https://github.com/p0p314/velam-notifier/releases/tag/v1.1.0
[1.0.0]: https://github.com/p0p314/velam-notifier/releases/tag/v1.0.0
