import { useState, useEffect, useCallback } from "react";
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

/**
 * Position de l'utilisateur via la géolocalisation navigateur (une seule requête).
 * status : 'prompt' (en cours) | 'granted' | 'denied' | 'unavailable'.
 * Le tri par distance retombe sur l'ordre alphabétique tant que coords est null.
 */
export function useGeolocation() {
  const [coords, setCoords] = useState(null);
  const [status, setStatus] = useState("prompt");

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setStatus("granted"); },
      () => setStatus("denied"),
      // GPS si dispo + position fraîche (pas de cache grossier) → tri proximité fiable.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }, []);

  return { coords, status };
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
 * Polling des stations (via le backend) toutes les 60 s.
 * Hors ligne / serveur injoignable : sert la dernière liste connue (localStorage)
 * avec `stale: true` ; `lastUpd` donne alors l'heure de cette dernière mise à jour.
 * Rafraîchit dès que la connexion revient.
 */
export function useStations() {
  const [cached] = useState(() => loadCache("stations"));
  const [stations, setStations] = useState(() => cached?.data ?? []);
  const [loading,  setLoading]  = useState(!cached);
  const [error,    setError]    = useState(null);
  const [stale,    setStale]    = useState(false);
  const [lastUpd,  setLastUpd]  = useState(() => (cached ? new Date(cached.at) : null));

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/stations", { auth: false });
      const at = Date.parse(data.fetched_at) || Date.now();
      setStations(data.stations);
      setLastUpd(new Date(at));
      setError(null);
      setStale(false);
      saveCache("stations", data.stations, at);
    } catch (e) {
      // Des données (mémoire ou cache) existent déjà → on les garde, marquées périmées.
      setStale(true);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, REFRESH * 1000);
    window.addEventListener("online", reload);
    return () => { clearInterval(iv); window.removeEventListener("online", reload); };
  }, [reload]);

  // `error` n'est bloquant que s'il n'y a rien à afficher.
  return { stations, loading, error: stations.length ? null : error, stale, lastUpd, reload };
}

/** Favoris de l'utilisateur connecté + toggle optimiste. Dernière liste gardée hors ligne. */
export function useFavorites() {
  const [cached] = useState(() => loadCache("favorites"));
  const [favorites, setFavorites] = useState(() => cached?.data ?? []);
  const [loading,   setLoading]   = useState(!cached);
  const [stale,     setStale]     = useState(false);

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

  const favIds = new Set(favorites.map((f) => f.station_id));

  const toggleFav = useCallback(async (station) => {
    const id = station.station_id;
    const isFav = favorites.some((f) => f.station_id === id);
    try {
      const data = isFav
        ? await api(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" })
        : await api("/api/favorites", { method: "POST", body: { station_id: id, station_name: station.name } });
      apply(data.favorites);
    } catch (e) {
      console.warn("[favorites]", e.message);
    }
  }, [favorites, apply]);

  /** Nom personnalisé (vide = nom de la station). */
  const rename = useCallback(async (stationId, label) => {
    try {
      apply((await api(`/api/favorites/${encodeURIComponent(stationId)}`, { method: "PATCH", body: { label } })).favorites);
    } catch (e) {
      console.warn("[favorites]", e.message);
    }
  }, [apply]);

  /** Nouvel ordre (optimiste : affiché tout de suite, resynchronisé par la réponse). */
  const reorder = useCallback(async (stationIds) => {
    setFavorites((list) => stationIds.map((id) => list.find((f) => f.station_id === id)).filter(Boolean));
    try {
      apply((await api("/api/favorites/order", { method: "PUT", body: { station_ids: stationIds } })).favorites);
    } catch (e) {
      console.warn("[favorites]", e.message);
      reload();
    }
  }, [apply, reload]);

  return { favorites, favIds, toggleFav, rename, reorder, loading, stale, reload };
}
