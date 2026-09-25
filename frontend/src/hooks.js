import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "./api";
import { saveCache, loadCache } from "./lib/offlineCache";

const REFRESH = 60; // secondes

/** Distance à vol d'oiseau (km) entre deux points {lat, lon}. Infinity si invalide. */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lon == null || b.lon == null) return Infinity;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance lisible : « 850 m » sous 1 km, sinon « 1,2 km ». null si invalide. */
export function fmtDistance(km) {
  if (km == null || !isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

const hasGeo = () => typeof navigator !== "undefined" && "geolocation" in navigator;

// Dernière position obtenue, partagée par toutes les pages : une seule mesure GPS
// pour Favoris, Stations et Carte au lieu d'une par page affichée.
const GEO_REUSE_MS = 2 * 60_000;
let lastPos = null; // { coords, at }
let pending = null; // mesure en cours

/** Tests : oublie la position partagée. */
export function resetGeoCache() { lastPos = null; pending = null; }

/** Demande la position (peut afficher l'invite du navigateur). Réutilise une position de moins de 2 min. */
export function requestPosition() {
  if (!hasGeo()) return Promise.reject(new Error("Géolocalisation indisponible"));
  if (lastPos && Date.now() - lastPos.at < GEO_REUSE_MS) return Promise.resolve(lastPos.coords);
  // Plusieurs pages montées en même temps → une seule mesure en cours.
  if (pending) return pending;
  const p = new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        lastPos = { coords, at: Date.now() };
        resolve(coords);
      },
      reject,
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  });
  pending = p;
  // Libère après coup (le rappel peut être synchrone) ; un échec permet de réessayer.
  p.finally(() => { if (pending === p) pending = null; }).catch(() => {});
  return p;
}

/**
 * Position de l'utilisateur, mesurée au lancement de l'app puis partagée entre les
 * pages (une seule mesure GPS tant qu'elle a moins de 2 min). `locate()` relance
 * une mesure (après un refus, ou au choix du tri proximité).
 * status : 'locating' | 'granted' | 'denied' | 'unavailable'.
 * Le tri par distance retombe sur l'ordre alphabétique tant que coords est null.
 */
export function useGeolocation() {
  const [coords, setCoords] = useState(() => lastPos?.coords ?? null);
  const [status, setStatus] = useState(() => (!hasGeo() ? "unavailable" : lastPos ? "granted" : "locating"));
  const alive = useRef(true);

  const locate = useCallback(() => {
    if (!hasGeo()) { setStatus("unavailable"); return; }
    setStatus("locating");
    requestPosition().then(
      (c) => { if (alive.current) { setCoords(c); setStatus("granted"); } },
      () => { if (alive.current) setStatus("denied"); }
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    locate();
    return () => { alive.current = false; };
  }, [locate]);

  return { coords, status, locate };
}

/**
 * Détection device fiable (mobile vs desktop) pour le flow d'installation PWA.
 * UA mobile, + cas iPadOS 13+ qui se présente comme un Mac (écran tactile).
 * Centralisé ici pour éviter toute détection éparpillée.
 */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/android|iphone|ipad|ipod|iemobile|blackberry|opera mini|mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPad « desktop class »
}

/** True si le viewport est mobile (≤ 768px), réactif au redimensionnement. */
export function useIsMobile(query = "(max-width: 768px)") {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return mobile;
}

/** État de connexion réseau du navigateur (événements online / offline). */
export function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/**
 * Polling des stations (via le backend) toutes les 60 s, et au retour au premier plan.
 *
 * Fraîcheur des disponibilités (`stale` + `staleReason`) :
 *  - "upstream" : le serveur répond mais le flux Vélam ne lui répond plus, répond mal,
 *    ou ses données ont ≥ 5 min (verdict `stale` calculé par le serveur) ;
 *  - "server"   : le serveur VéloPulse lui-même est injoignable (ou l'appareil hors ligne).
 * `lastUpd` = date des données Vélam affichées. Les dernières données connues
 * (mémoire ou cache hors ligne) restent affichées dans tous les cas.
 */
export function useStations() {
  const [cached] = useState(() => loadCache("stations"));
  const [stations, setStations] = useState(() => cached?.data ?? []);
  const [loading,  setLoading]  = useState(!cached);
  const [error,    setError]    = useState(null);
  const [staleReason, setStaleReason] = useState(null);
  const [lastUpd,  setLastUpd]  = useState(() => (cached ? new Date(cached.at) : null));

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/stations", { auth: false });
      // Réponse illisible ou incomplète (proxy, corps tronqué…) : traitée comme un échec
      // plutôt que d'écraser la liste affichée par `undefined`.
      if (!Array.isArray(data?.stations)) throw new Error("Réponse du serveur invalide");
      // Âge fourni par le serveur : insensible à un décalage d'horloge de l'appareil.
      const at = Date.now() - (Number(data.data_age_s) || 0) * 1000;
      setStations(data.stations);
      setLastUpd(new Date(at));
      setError(null);
      setStaleReason(data.stale ? "upstream" : null);
      saveCache("stations", data.stations, at);
    } catch (e) {
      // Des données (mémoire ou cache) existent déjà → on les garde, marquées périmées.
      setStaleReason("server");
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, REFRESH * 1000);
    // Au retour au premier plan (app mise en veille), on rafraîchit tout de suite.
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("online", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      window.removeEventListener("online", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // `error` n'est bloquant que s'il n'y a rien à afficher.
  return {
    stations, loading, error: stations.length ? null : error,
    stale: staleReason !== null, staleReason, lastUpd, reload,
  };
}

/**
 * Favoris de l'utilisateur connecté + actions (ajout/retrait, renommage, ordre).
 * Dernière liste gardée hors ligne. Les modifications sont envoyées une par une
 * (file) et seule la réponse de la dernière est appliquée : deux actions rapides
 * (renommer puis déplacer) ne peuvent pas laisser l'affichage sur un état périmé.
 */
export function useFavorites() {
  const [cached] = useState(() => loadCache("favorites"));
  const [favorites, setFavorites] = useState(() => cached?.data ?? []);
  const [loading,   setLoading]   = useState(!cached);
  const [stale,     setStale]     = useState(false);
  const queue   = useRef(Promise.resolve());
  const pending = useRef(0);

  const apply = useCallback((list) => {
    setFavorites(list);
    setStale(false);
    saveCache("favorites", list);
  }, []);

  const reload = useCallback(async () => {
    try {
      apply((await api("/api/favorites")).favorites);
    } catch (e) {
      // Ne pas vider la liste sur une erreur passagère (réveil serveur, réseau) :
      // on garde l'état connu. Un 401 est géré globalement (déconnexion).
      setStale(true);
      console.warn("[favorites]", e.message);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [reload]);

  /** Met en file une modification ; `request` renvoie la liste à jour du serveur. */
  const mutate = useCallback((request) => {
    pending.current++;
    const run = async () => {
      try {
        const list = await request();
        if (pending.current === 1) apply(list); // une plus récente suit : on l'attend
      } catch (e) {
        console.warn("[favorites]", e.message);
        if (pending.current === 1) reload();
      } finally {
        pending.current--;
      }
    };
    queue.current = queue.current.then(run);
    return queue.current;
  }, [apply, reload]);

  const favIds = new Set(favorites.map((f) => f.station_id));

  const toggleFav = useCallback((station) => {
    const id = station.station_id;
    const isFav = favorites.some((f) => f.station_id === id);
    return mutate(async () => (isFav
      ? await api(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" })
      : await api("/api/favorites", { method: "POST", body: { station_id: id, station_name: station.name } })
    ).favorites);
  }, [favorites, mutate]);

  /** Nom personnalisé (vide = nom de la station). */
  const rename = useCallback((stationId, label) => mutate(async () =>
    (await api(`/api/favorites/${encodeURIComponent(stationId)}`, { method: "PATCH", body: { label } })).favorites
  ), [mutate]);

  /** Nouvel ordre (optimiste : affiché tout de suite, confirmé par le serveur). */
  const reorder = useCallback((stationIds) => {
    setFavorites((list) => stationIds.map((id) => list.find((f) => f.station_id === id)).filter(Boolean));
    return mutate(async () =>
      (await api("/api/favorites/order", { method: "PUT", body: { station_ids: stationIds } })).favorites
    );
  }, [mutate]);

  return { favorites, favIds, toggleFav, rename, reorder, loading, stale, reload };
}
