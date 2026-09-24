// Favoris : tri, déplacement, affichage du nom personnalisé. Sans React → testable.
import { distanceKm } from "../hooks";

export const SORT_KEY = "velopulse-fav-sort";
export const SORTS = { distance: "distance", custom: "custom" };

/** Préférence de tri mémorisée (défaut : proximité). */
export function loadSortPref() {
  try { return localStorage.getItem(SORT_KEY) === SORTS.custom ? SORTS.custom : SORTS.distance; }
  catch { return SORTS.distance; }
}
export function saveSortPref(v) {
  try { localStorage.setItem(SORT_KEY, v); } catch { /* facultatif */ }
}

/** Déplace l'élément `index` de `delta` positions (borné). Renvoie une nouvelle liste. */
export function moveItem(list, index, delta) {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (to === index) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Station affichée pour un favori : le nom personnalisé passe en titre et le nom
 * réel de la station en sous-titre (à la place de l'adresse).
 */
export function displayStation(station, fav) {
  if (!fav?.label) return station;
  return { ...station, name: fav.label, address: station.name };
}

/**
 * Trie les favoris affichés. `favorites` est déjà dans l'ordre personnalisé (API).
 * Proximité : nécessite la position, sinon on garde l'ordre personnalisé.
 */
export function sortFavorites(items, mode, coords) {
  if (mode !== SORTS.distance || !coords) return items;
  return [...items].sort((a, b) => distanceKm(coords, a) - distanceKm(coords, b));
}
