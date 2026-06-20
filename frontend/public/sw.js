/* Service Worker Vélam — réception des push et clic sur notification. */

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "VéloPulse", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      data: { url: data.url || "https://velam.amiens.fr" },
      requireInteraction: false,
      renotify: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes("velam.amiens.fr"));
      if (existing) return existing.focus();
      return clients.openWindow(event.notification.data.url);
    })
  );
});
