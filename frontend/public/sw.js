/* Service Worker VéloPulse — réception des push et clic sur notification. */

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    // data.url est désormais toujours une URL https:// (page /redirect interne)
    // qui gère côté navigateur l'ouverture de l'app native, puis store, puis web.
    data: { url: data.url || "https://velam.amiens.fr/fr/home" },

    // Urgence visuelle et comportementale
    requireInteraction: true, // reste affiché jusqu'au tap (Android)
    silent: false,            // force le son système
    vibrate: [200, 100, 200, 100, 400], // pattern distinct : court-court-long

    // Évite les doublons en rafale (reprise de connexion) : un tag par station
    tag: `velopulse-alert-${data.stationId || "station"}`,
    renotify: true, // même tag = remplace ET re-notifie (son + vibration rejoués)

    // Actions rapides (Android)
    actions: [
      { action: "reserve", title: "🚲 Réserver" },
      { action: "dismiss", title: "Ignorer" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "VéloPulse", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // data.url est maintenant toujours une URL https:// valide (page /redirect).
  const url = event.notification.data?.url || "https://velam.amiens.fr/fr/home";

  if (event.action === "dismiss") return; // fermer sans ouvrir

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // Réutiliser un onglet déjà ouvert sur notre app.
        const existing = list.find((c) => c.url.includes("velam-notifier.onrender.com"));
        if (existing) {
          existing.navigate(url);
          return existing.focus();
        }
        return clients.openWindow(url);
      })
  );
});
