// StaticScheduleProvider : horaires théoriques (GTFS).
//
// Cycle de vie du dataset :
//  - au démarrage du serveur, chargement en arrière-plan (jamais bloquant) depuis le
//    cache disque s'il existe, sinon téléchargement ;
//  - revalidation conditionnelle (If-Modified-Since) au plus une fois par
//    TRAINS_GTFS_REFRESH_H (24 h par défaut) — déclenchée par le cron quotidien
//    (POST /cron/sync-trains) ou, à défaut, au premier accès après ce délai ;
//  - une nouvelle version est indexée À CÔTÉ de l'ancienne, puis échangée : les
//    recherches continuent pendant la reconstruction (~2 s pour la SNCF).
// Le zip n'est téléchargé que s'il a changé (304 sinon) : ~7 Mo par version publiée.
const fs = require('fs');
const path = require('path');
const { openZip } = require('./zip');
const { buildIndex, filesReader } = require('./staticIndex');

const MAX_BYTES = 300 * 1024 * 1024;

function createStaticSchedule({ id, url, conventions, env = process.env }) {
  const cacheDir = env.TRAINS_CACHE_DIR || path.join(process.cwd(), 'data', 'gtfs');
  const refreshMs = (Number(env.TRAINS_GTFS_REFRESH_H) || 24) * 3600_000;
  const timeoutMs = Number(env.TRAINS_GTFS_TIMEOUT_MS) || 120_000;
  const zipFile = path.join(cacheDir, `${id}.zip`);
  const metaFile = path.join(cacheDir, `${id}.json`);

  const state = {
    index: null,
    loading: null,       // promesse de chargement / rafraîchissement en cours
    lastModified: null,  // en-tête Last-Modified de la version chargée
    lastCheckAt: null,   // dernière revalidation auprès du producteur (ms)
    loadedAt: null,
    source: null,        // cache | network | files
    lastError: null,
    buildMs: null,
  };

  async function install(reader, source, lastModified) {
    const t0 = Date.now();
    const index = await buildIndex(reader, conventions);
    state.index = index;
    state.buildMs = Date.now() - t0;
    state.loadedAt = Date.now();
    state.source = source;
    state.lastModified = lastModified ?? null;
    state.lastError = null;
    console.log(`[trains] horaires ${id} chargés (${source}) : ${index.trips.count} trajets, ${index.stations.length} gares, version ${index.feed.version ?? '?'} — ${state.buildMs} ms`);
    return index;
  }

  function readCacheMeta() {
    try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return null; }
  }

  function writeCache(buf, lastModified) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(zipFile, buf);
      fs.writeFileSync(metaFile, JSON.stringify({ lastModified, savedAt: Date.now() }));
    } catch (err) {
      console.warn('[trains] cache disque indisponible :', err.message); // non bloquant
    }
  }

  /** Télécharge si modifié depuis la version chargée. Renvoie true si une nouvelle version est installée. */
  async function download({ force = false } = {}) {
    const headers = {};
    if (!force && state.index && state.lastModified) headers['If-Modified-Since'] = state.lastModified;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    state.lastCheckAt = Date.now();
    if (res.status === 304) return false;
    if (!res.ok) throw new Error(`GTFS ${id} → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`GTFS ${id} : archive trop volumineuse`);
    const lastModified = res.headers.get('last-modified');
    await install(openZip(buf), 'network', lastModified);
    writeCache(buf, lastModified);
    return true;
  }

  /** Un seul chargement à la fois ; les appels concurrents partagent la même promesse. */
  function exclusive(task) {
    if (state.loading) return state.loading;
    state.loading = task()
      .catch((err) => {
        state.lastError = { message: err.message, at: new Date().toISOString() };
        console.error(`[trains] horaires ${id} :`, err.message);
        return false;
      })
      .finally(() => { state.loading = null; });
    return state.loading;
  }

  /** Chargement initial : cache disque, sinon réseau. Puis revalidation si le cache est ancien. */
  function load() {
    if (state.index) return Promise.resolve(true);
    return exclusive(async () => {
      const meta = readCacheMeta();
      if (meta && fs.existsSync(zipFile)) {
        try {
          await install(openZip(fs.readFileSync(zipFile)), 'cache', meta.lastModified);
          state.lastCheckAt = meta.savedAt ?? null;
        } catch (err) {
          console.warn('[trains] cache disque illisible, téléchargement :', err.message);
        }
      }
      if (!state.index) return download({ force: true });
      if (!state.lastCheckAt || Date.now() - state.lastCheckAt > refreshMs) {
        try { await download(); } catch (err) { console.warn('[trains] revalidation :', err.message); }
      }
      return true;
    });
  }

  /** Revalidation (cron) : renvoie { updated, version }. */
  async function refresh({ force = false } = {}) {
    let updated = false;
    let failure = null;
    await exclusive(async () => {
      try { updated = await download({ force }); } catch (err) { failure = err; throw err; }
    });
    if (failure) throw failure;
    return { updated, version: state.index?.feed.version ?? null };
  }

  /** Revalidation paresseuse : au plus une fois par période, en arrière-plan. */
  function maybeRevalidate() {
    if (!state.index || state.loading || state.source === 'files') return;
    if (state.lastCheckAt && Date.now() - state.lastCheckAt < refreshMs) return;
    state.lastCheckAt = Date.now(); // pas de nouvelle tentative avant la prochaine période
    exclusive(() => download());
  }

  return {
    id,
    load,
    refresh,
    maybeRevalidate,
    getIndex: () => state.index,
    isLoading: () => !!state.loading,
    /** Tests / dev : charge un dataset depuis des textes { 'stops.txt': '…' } ou une archive. */
    loadFiles: (files) => install(filesReader(files), 'files', null),
    loadZip: (buf) => install(openZip(buf), 'files', null),
    reset: () => { state.index = null; state.loading = null; state.lastModified = null; state.lastCheckAt = null; state.source = null; state.lastError = null; },
    status() {
      const idx = state.index;
      return {
        loaded: !!idx,
        loading: !!state.loading,
        source: state.source,
        version: idx?.feed.version ?? null,
        valid_from: idx?.feed.start ?? null,
        valid_until: idx?.feed.end ?? null,
        trips: idx?.trips.count ?? 0,
        stations: idx ? idx.stations.filter((s) => s.served).length : 0,
        loaded_at: state.loadedAt ? new Date(state.loadedAt).toISOString() : null,
        last_check_at: state.lastCheckAt ? new Date(state.lastCheckAt).toISOString() : null,
        build_ms: state.buildMs,
        last_error: state.lastError,
      };
    },
  };
}

module.exports = { createStaticSchedule };
