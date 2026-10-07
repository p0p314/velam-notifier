// Tutoriel de présentation : contenu des slides et règle d'affichage. Sans React → testable.

/**
 * Slides, dans l'ordre de découverte de l'app. `points` : 2 à 3 puces courtes
 * (lisibles sur un téléphone sans défiler).
 */
export const TUTORIAL_SLIDES = [
  {
    icon: "bike",
    title: "Bienvenue sur VéloPulse",
    text: "Les vélos Vélam d'Amiens en temps réel, station par station.",
    points: [
      "Vélos mécaniques, électriques et places libres",
      "Données officielles Vélam, rafraîchies toutes les minutes",
    ],
  },
  {
    icon: "map-pin",
    title: "Trouvez une station",
    text: "Dans Stations, cherchez par nom et triez par distance. La Carte montre d'un coup d'œil où il reste des vélos.",
    points: [
      "Filtres par type de vélo et nombre minimum",
      "« Autour de moi » : les 3 stations utiles les plus proches",
    ],
  },
  {
    icon: "star",
    title: "Gardez vos favoris",
    text: "Touchez l'étoile d'une station (maison, travail…) : elle apparaît dans Favoris, triée par proximité ou dans votre ordre.",
    points: [
      "Renommez-les (« Maison ») et réorganisez-les",
      "Depuis la fiche d'une station, créez une alerte en un geste",
    ],
  },
  {
    icon: "bell",
    title: "Soyez alerté",
    text: "Une alerte de disponibilité vous prévient quand votre station se vide ou se remplit, sur le créneau et les jours choisis.",
    points: [
      "Trajet : vérifie aussi les places à l'arrivée",
      "Groupe : plusieurs stations proches, une seule alerte",
    ],
  },
  {
    icon: "clock",
    title: "Recevez un résumé",
    text: "Le résumé à heure fixe vous envoie le nombre de vélos de vos stations, à une ou plusieurs heures de la journée.",
    points: [
      "Par exemple à 7 h 45 avant de partir et à 18 h pour le retour",
      "Depuis une notification, ouvrez l'app Vélam pour louer",
    ],
  },
  {
    icon: "train",
    title: "Prenez aussi le train",
    text: "Dans Trains, cherchez un trajet (Lille Flandres → Amiens) ou une ligne (K44) : horaires du jour, retards et suppressions en temps réel.",
    points: [
      "Ajoutez votre train en favori pour voir son état d'un coup d'œil",
      "Alerte en cas de retard, de suppression ou de perturbation",
    ],
  },
  {
    icon: "sliders",
    title: "À votre main",
    text: "Dans Paramètres : thème, type de vélo par défaut, page d'ouverture, notifications et appareils connectés.",
    points: [
      "Activez les notifications pour recevoir alertes et résumés",
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
