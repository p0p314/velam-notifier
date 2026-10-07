// Canal de notification du module Trains. Première version : Web Push (PWA), en
// réutilisant l'envoi existant (push.js : tous les appareils du compte, nettoyage
// des abonnements expirés). Un autre canal (e-mail…) s'ajouterait ici sans toucher
// à la boucle d'alerte, qui ne connaît que `notify(userId, message)`.
const { sendToUser } = require('../push');

const channels = {
  webpush: (userId, message) => sendToUser(userId, {
    title: message.title,
    body: message.body,
    url: message.url,
    // Clé de regroupement côté appareil (une notification par train et par jour).
    stationId: message.tag ?? 'trains',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
  }),
};

/** Envoie un message à l'utilisateur sur ses canaux (Web Push uniquement pour l'instant). */
async function notify(userId, message) {
  return channels.webpush(userId, message);
}

module.exports = { notify };
