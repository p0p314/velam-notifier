/* Service Worker VéloPulse — réception des push et clic sur notification. */

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  // Fallback same-origin : iOS ne peut pas ouvrir une URL cross-origin depuis le SW.
  const fallbackUrl = self.location.origin + "/open?url=" + encodeURIComponent("https://velam.amiens.fr/fr/home");

  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { url: data.url || fallbackUrl },

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

  const fallbackUrl = self.location.origin + "/open?url=" + encodeURIComponent("https://velam.amiens.fr/fr/home");
  const url = event.notification.data?.url || fallbackUrl;

  if (event.action === "dismiss") return; // fermer sans ouvrir

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // Réutiliser une fenêtre PWA existante pour y déclencher la navigation.
        const existing = list.find((c) => c.url.startsWith(self.location.origin));
        if (existing) {
          existing.navigate(url);
          return existing.focus();
        }
        return clients.openWindow(url);
      })
  );
});
