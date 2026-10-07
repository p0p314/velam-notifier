// Hooks du module Trains : recherche, détail d'un trajet, « Mes trains ».
// Tout passe par api() → backend (jamais d'appel direct à la SNCF).
// Actualisation : toutes les 2 min (fréquence de mise à jour du flux temps réel SNCF),
// uniquement quand la page est visible et que le temps réel s'applique (jour proche) ;
// au retour au premier plan ; et sur demande (bouton, qui force la relecture du flux).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export const TRAIN_REFRESH_MS = 120_000;

/** Horloge qui avance toutes les `ms` (libellés « il y a 2 min »). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}

/** Appelle `fn` toutes les `ms` tant que la page est visible, et au retour au premier plan. */
function useVisibleRefresh(fn, ms, enabled) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const iv = setInterval(() => { if (document.visibilityState !== "hidden") ref.current(); }, ms);
    const onVisible = () => { if (document.visibilityState === "visible") ref.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }, [ms, enabled]);
}

/**
 * Chargement d'une ressource trains (`path` null = rien à charger). Seule la réponse
 * de la dernière requête est appliquée (changement rapide de recherche).
 */
function useTrainResource(path, { auth = false, cache } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!path) return;
    const id = ++seq.current;
    if (force) setRefreshing(true);
    try {
      const url = force ? `${path}${path.includes("?") ? "&" : "?"}refresh=1` : path;
      const res = await api(url, { auth, ...(cache ? { cache } : {}) });
      if (id !== seq.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e.message); // les données déjà affichées sont conservées
    } finally {
      if (id === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [path, auth, cache]);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(!!path);
    load();
  }, [path, load]);

  return { data, setData, loading, refreshing, error, load };
}

/** Résultats d'une recherche (`query` : paramètres déjà sérialisés, ou null). */
export function useTrainSearch(query) {
  const res = useTrainResource(query ? `/api/trains/search?${query}` : null);
  useVisibleRefresh(() => res.load(), TRAIN_REFRESH_MS, !!res.data?.realtime?.applicable);
  return { ...res, refresh: () => res.load({ force: true }) };
}

/**
 * Détail d'un trajet. `refreshMs(data)` : fréquence d'actualisation (carte : 30 s
 * quand le fournisseur publie des positions pour un train en route), 2 min sinon.
 */
export function useTrainJourney(id, { refreshMs = null } = {}) {
  const res = useTrainResource(id ? `/api/trains/journey?id=${encodeURIComponent(id)}` : null);
  const ms = refreshMs ? refreshMs(res.data, TRAIN_REFRESH_MS) : TRAIN_REFRESH_MS;
  useVisibleRefresh(() => res.load(), ms, !!res.data?.realtime?.applicable || !!res.data?.position?.available);
  return { ...res, refresh: () => res.load({ force: true }) };
}

/** Itinéraire géographique d'un trajet (statique : mis en cache par le navigateur). */
export function useTrainRoute(id) {
  return useTrainResource(id ? `/api/trains/route?id=${encodeURIComponent(id)}` : null, { cache: "default" });
}

/**
 * Favoris trains (avec l'état de leurs prochaines circulations) et alertes de ligne,
 * plus les actions associées. Chaque action recharge la liste depuis le serveur.
 */
export function useMyTrains() {
  const res = useTrainResource("/api/trains/favorites", { auth: true });
  useVisibleRefresh(() => res.load(), TRAIN_REFRESH_MS, !!res.data?.favorites?.length);
  const { load } = res;

  const run = useCallback(async (request) => {
    const out = await request();
    await load();
    return out;
  }, [load]);

  return {
    ...res,
    favorites: res.data?.favorites ?? [],
    lineAlerts: res.data?.line_alerts ?? [],
    refresh: () => load({ force: true }),
    addFavorite: (journeyId) => run(() => api("/api/trains/favorites", { method: "POST", body: { journey_id: journeyId } })),
    removeFavorite: (id) => run(() => api(`/api/trains/favorites/${id}`, { method: "DELETE" })),
    renameFavorite: (id, label) => run(() => api(`/api/trains/favorites/${id}`, { method: "PATCH", body: { label } })),
    createAlert: (body) => run(() => api("/api/trains/alerts", { method: "POST", body })),
    updateAlert: (id, body) => run(() => api(`/api/trains/alerts/${id}`, { method: "PATCH", body })),
    deleteAlert: (id) => run(() => api(`/api/trains/alerts/${id}`, { method: "DELETE" })),
  };
}

/**
 * Autocomplétion (gares ou lignes) : requête après 250 ms de pause dans la frappe,
 * 2 caractères minimum ; seule la dernière réponse compte.
 */
export function useSuggestions(kind, text, { enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = text.trim();
    if (!enabled || q.length < 2) { setItems([]); setLoading(false); return undefined; }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/trains/${kind}?q=${encodeURIComponent(q)}`, { auth: false });
        if (id === seq.current) setItems(data[kind] ?? []);
      } catch {
        if (id === seq.current) setItems([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [kind, text, enabled]);
  return { items, loading };
}

/** Alertes trains (page Alertes) : liste + actions, rechargée après chaque modification. */
export function useTrainAlerts(enabled = true) {
  const res = useTrainResource(enabled ? "/api/trains/alerts" : null, { auth: true });
  const { load } = res;
  const run = useCallback(async (request) => {
    const out = await request();
    await load();
    return out;
  }, [load]);
  return {
    ...res,
    alerts: res.data?.alerts ?? [],
    createAlert: (body) => run(() => api("/api/trains/alerts", { method: "POST", body })),
    updateAlert: (id, body) => run(() => api(`/api/trains/alerts/${id}`, { method: "PATCH", body })),
    deleteAlert: (id) => run(() => api(`/api/trains/alerts/${id}`, { method: "DELETE" })),
  };
}
