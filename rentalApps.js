// Service de synchronisation des applications de location (rental_apps).
// Données quasi statiques exposées par le flux GBFS `system_information.json`.
// Synchronisées une fois par jour (via GitHub Actions → POST /cron/sync-rental-apps),
// jamais à chaque requête. Sert à enrichir les notifications push d'un deep link
// officiel vers l'app Vélam, avec repli sur le store puis le web.

const { fetchSystemInformation } = require('./gbfs');
const { upsertRentalApp, getRentalAppsMap } = require('./db');

/**
 * Transforme `system_information.data.rental_apps` (objet indexé par plateforme)
 * en lignes normalisées prêtes pour l'upsert. Le nom provient du système (data.name)
 * car GBFS ne fournit pas de nom par application.
 *
 * Entrée : { android: { store_uri, discovery_uri }, ios: { ... } }
 * Sortie : [ { platform, name, discovery_uri, store_uri }, ... ]
 */
function normalizeRentalApps(systemInfo) {
  const apps = systemInfo?.rental_apps ?? {};
  const name = systemInfo?.name ?? 'Vélam';

  return Object.entries(apps)
    .filter(([, v]) => v && (v.discovery_uri || v.store_uri))
    .map(([platform, v]) => ({
      platform,                        // 'ios' | 'android'
      name,
      discovery_uri: v.discovery_uri ?? null,
      store_uri:     v.store_uri ?? null,
    }));
}

/**
 * Récupère le flux GBFS, normalise et upsert chaque rental_app en base.
 * Retourne la liste normalisée (pour la réponse de l'endpoint cron).
 */
async function syncRentalApps() {
  const systemInfo = await fetchSystemInformation();
  const apps = normalizeRentalApps(systemInfo);

  for (const app of apps) {
    await upsertRentalApp(app);
  }

  console.log(`[rental-apps] ${apps.length} application(s) synchronisée(s) : ${apps.map((a) => a.platform).join(', ') || '—'}`);
  return apps;
}

module.exports = { syncRentalApps, normalizeRentalApps, getRentalAppsMap };
