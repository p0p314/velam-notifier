// Tutoriel de présentation : contenu des slides et règle d'affichage. Sans React → testable.

/**
 * Slides, dans l'ordre de découverte de l'app. `points` : 2 à 3 puces courtes
 * (lisibles sur un téléphone sans défiler).
 */
export const TUTORIAL_SLIDES = [
  {
    icon: "bike",
    title: "Bienvenue sur VéloPulse",
    text: "Vos trajets du quotidien en temps réel : les vélos Vélam d'Amiens et les trains SNCF.",
    points: [
      "Vélos mécaniques, électriques et places libres, station par station",
      "Horaires, retards et suppressions des TER, Intercités et TGV",
    ],
  },
  {
    icon: "star",
    title: "Mes trajets",
    text: "Votre page d'accueil : vos trains et vos stations favoris, avec leur état actuel.",
    points: [
      "Pour chaque train : retard éventuel et prochaines circulations",
      "Les stations Vélam près de vos gares : places au départ, vélos à l'arrivée",
    ],
  },
  {
    icon: "map-pin",
    title: "Vélos",
    text: "Toutes les stations en liste ou sur la carte. Touchez l'étoile d'une station pour la suivre.",
    points: [
      "Recherche par nom, tri par distance, filtres par type de vélo",
      "« Autour de moi » : les 3 stations utiles les plus proches",
    ],
  },
  {
    icon: "train",
    title: "Trains",
    text: "Cherchez un trajet (Lille Flandres → Amiens), une gare ou une ligne (K44) : les trains du jour, avec les retards en temps réel.",
    points: [
      "Ouvrez un train pour l'ajouter à vos trajets",
      "« Carte » : son trajet, ses gares et où il en est",
      "Tirez la page vers le bas pour l'actualiser",
    ],
  },
  {
    icon: "bell",
    title: "Alertes",
    text: "Soyez prévenu au bon moment, pour vos vélos comme pour vos trains.",
    points: [
      "Vélos : station qui se vide ou se remplit, résumé à heure fixe",
      "Trains : retard, suppression, perturbation, ou toute une ligne",
    ],
  },
  {
    icon: "sliders",
    title: "À votre main",
    text: "Dans Paramètres : thème, type de vélo par défaut, page d'ouverture, notifications et appareils connectés.",
    points: [
      "Activez les notifications pour recevoir vos alertes",
      "Ce tutoriel reste disponible dans Paramètres › Préférences",
    ],
  },
];

/**
 * Le tutoriel se lance après la première connexion du compte : seulement quand le
 * serveur a confirmé qu'il n'a jamais été vu (un utilisateur mémorisé avant la v1.5,
 * sans le champ, attend la réponse de /api/auth/me).
 */
export const tutorialPending = (user) => user?.tutorial_done === false;
