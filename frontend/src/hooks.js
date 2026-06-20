import { useState, useEffect, useCallback } from "react";
import { api } from "./api";

const REFRESH = 60; // secondes

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
