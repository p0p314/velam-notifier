/* Service Worker VéloPulse — coquille hors ligne, réception des push, clic sur notification. */

// ── Hors ligne ─────────────────────────────────────────────────────────────────
// But : pouvoir OUVRIR l'app sans réseau (liste des stations + favoris affichés
// depuis le cache localStorage du front). On ne met en cache que la coquille :
//   - navigations → réseau d'abord, repli sur la dernière index.html connue ;
//   - /assets/* (fichiers Vite hashés, immuables) + icônes → cache d'abord.
// Jamais l'API (/api, /open, /cron) : la fraîcheur des données est gérée par le front.
// Incrémenter la version si un fichier non hashé (icônes, manifest, theme-init) change.
const CACHE = "velopulse-shell-v1";
const SHELL = "/index.html";
const STATIC_RE = /^\/(assets\/|icon-|badge-|manifest\.json|velopulse-icon|theme-init\.js)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request(SHELL, { cache: "reload" })))
      .catch(() => { /* hors ligne à l'installation : la coquille sera mise en cache plus tard */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Après chaque nouvelle index.html, supprime les assets qu'elle ne référence plus
 * (anciens builds) : le cache reste borné à la version courante.
 * Les chunks chargés à la demande (carte) sont re-téléchargés au besoin, en ligne.
 */
async function pruneAssets(cache, html) {
  const used = new Set([...html.matchAll(/\/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !used.has(path)) await cache.delete(req);
  }
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      const copy = res.clone();
      copy.text().then((html) => pruneAssets(cache, html)).catch(() => {});
      await cache.put(SHELL, res.clone());
    }
    return res;
  } catch {
    return (await cache.match(SHELL)) || Response.error();
  }
}

async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Chrome 111+ exclut les handlers « vides » du critère d'installabilité PWA :
  // on appelle toujours respondWith() (pass-through réseau par défaut).
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }
  const isPage = request.mode === "navigate"
    && !/^\/(api|open|cron|health)(\/|$)/.test(url.pathname);
  if (isPage) {
    event.respondWith(handleNavigation(request));
  } else if (STATIC_RE.test(url.pathname)) {
    event.respondWith(handleStatic(request));
  } else {
    event.respondWith(fetch(request));
  }
});

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
