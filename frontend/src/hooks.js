import { useState, useEffect, useCallback } from "react";
import { api } from "./api";

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

/** Polling des stations (via le backend) toutes les 60 s. */
export function useStations() {
  const [stations, setStations] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [lastUpd,  setLastUpd]  = useState(null);

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/stations", { auth: false });
      setStations(data.stations);
      setLastUpd(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, REFRESH * 1000);
    return () => clearInterval(iv);
  }, [reload]);

  return { stations, loading, error, lastUpd, reload };
}

/** Favoris de l'utilisateur connecté + toggle optimiste. */
export function useFavorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading,   setLoading]   = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/favorites");
      setFavorites(data.favorites);
    } catch {
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const favIds = new Set(favorites.map((f) => f.station_id));

  const toggleFav = useCallback(async (station) => {
    const id = station.station_id;
    const isFav = favorites.some((f) => f.station_id === id);
    try {
      const data = isFav
        ? await api(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" })
        : await api("/api/favorites", { method: "POST", body: { station_id: id, station_name: station.name } });
      setFavorites(data.favorites);
    } catch (e) {
      console.warn("[favorites]", e.message);
    }
  }, [favorites]);

  return { favorites, favIds, toggleFav, loading, reload };
}
