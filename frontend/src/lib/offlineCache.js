// Dernières données connues, persistées en localStorage pour le mode hors ligne.
// Seules les stations et les favoris sont conservés (lecture seule hors ligne).
// Chaque entrée est horodatée : l'UI affiche l'heure de la dernière mise à jour.

const PREFIX = "velopulse_cache:";

/** Enregistre `data` sous `key` avec l'horodatage `at` (ms, défaut maintenant). */
export function saveCache(key, data, at = Date.now()) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at, data }));
  } catch { /* quota plein / stockage indisponible : le cache est facultatif */ }
}

/** Renvoie { at, data } ou null si absent / illisible. */
export function loadCache(key) {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + key));
    return v && typeof v.at === "number" && "data" in v ? v : null;
  } catch {
    return null;
  }
}

export function removeCache(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignoré */ }
}

/** « 14:32 » si c'est aujourd'hui, sinon « 23/09 à 14:32 ». */
export function fmtUpdatedAt(date, now = new Date()) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `${day} à ${time}`;
}
