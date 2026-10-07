// Module Trains : registre des fournisseurs de transport.
//
//   TransportProvider
//   ├── schedule : StaticScheduleProvider (GTFS — horaires théoriques)
//   ├── realtime : RealtimeTrainProvider  (GTFS-RT — retards, suppressions, perturbations)
//   ├── conventions : particularités du producteur (numéro de train, alias temps réel…)
//   └── service  : TrainService (couche métier → modèles TrainJourney)
//
// Un seul fournisseur aujourd'hui (SNCF) ; en ajouter un = une configuration de plus
// dans providers/ (URL GTFS, URL GTFS-RT, conventions) et un appel à register().
const { createStaticSchedule } = require('./gtfs/staticSchedule');
const { createRealtimeProvider } = require('./gtfs/realtime');
const { createTrainService, TrainsError } = require('./service');
const { sncfConfig } = require('./providers/sncf');

const providers = new Map();

/** Assemble un fournisseur à partir de sa configuration. */
function createProvider(config, env = process.env) {
  const provider = {
    id: config.id,
    name: config.name,
    attribution: config.attribution,
    conventions: config.conventions,
    schedule: createStaticSchedule({ id: config.id, url: config.gtfsUrl, conventions: config.conventions, env }),
    realtime: createRealtimeProvider({
      tripUpdatesUrl: config.tripUpdatesUrl, serviceAlertsUrl: config.serviceAlertsUrl,
      vehiclePositionsUrl: config.vehiclePositionsUrl ?? null, env,
    }),
  };
  provider.service = createTrainService(provider, env);
  return provider;
}

function register(provider) {
  providers.set(provider.id, provider);
  return provider;
}

register(createProvider(sncfConfig()));

const DEFAULT_PROVIDER = 'sncf';

/** Fournisseur demandé (défaut : SNCF) ; 404 s'il est inconnu. */
function getProvider(id = DEFAULT_PROVIDER) {
  const p = providers.get(id || DEFAULT_PROVIDER);
  if (!p) throw new TrainsError(404, 'Fournisseur de transport inconnu');
  return p;
}

const listProviders = () => [...providers.values()];

/**
 * Démarrage (server.js) : chargement des horaires en arrière-plan, jamais bloquant.
 * TRAINS_ENABLED=0 désactive le chargement (instance à très faible mémoire).
 */
function initTrains(env = process.env) {
  if (env.TRAINS_ENABLED === '0') {
    console.log('[trains] module désactivé (TRAINS_ENABLED=0)');
    return;
  }
  for (const p of providers.values()) p.schedule.load();
}

/** État de chaque fournisseur, sans appel réseau (pour /api/health). */
function trainsHealth(now = Date.now()) {
  return listProviders().map((p) => {
    const { tripUpdates, serviceAlerts, vehicles } = p.realtime.peek();
    const feed = (snap) => snap && {
      upstream_ok: snap.upstreamOk,
      data_updated_at: snap.feedTimestamp ? new Date(snap.feedTimestamp).toISOString() : null,
      data_age_s: snap.feedTimestamp ? Math.max(0, Math.round((now - snap.feedTimestamp) / 1000)) : null,
      last_error: snap.error ?? null,
    };
    return {
      provider: p.id,
      schedule: p.schedule.status(),
      trip_updates: feed(tripUpdates),
      service_alerts: feed(serviceAlerts),
      // Positions des trains : null si le fournisseur n'en publie pas (SNCF).
      vehicle_positions: p.realtime.hasVehiclePositions
        ? (vehicles ? { ...feed(vehicles), count: vehicles.vehicles?.length ?? 0 } : { upstream_ok: null, note: 'pas encore interrogé' })
        : null,
    };
  });
}

module.exports = { getProvider, listProviders, register, createProvider, initTrains, trainsHealth, TrainsError, DEFAULT_PROVIDER };
