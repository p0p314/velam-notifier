// Configuration carte Mapbox + logique de disponibilité (réutilisée par les
// markers et le popup). Le token vient de l'environnement — jamais hardcodé.

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

// Centre par défaut : Amiens (pas de config ville dédiée dans le projet).
export const DEFAULT_CENTER = { lng: 2.2957, lat: 49.8941 };
export const DEFAULT_ZOOM   = 13;
export const MAP_STYLE      = "mapbox://styles/mapbox/light-v11";

/** Nombre de vélos pertinent selon le filtre de type actif. */
export function bikeCountForType(s, type) {
  if (type === "elec") return s.electrical ?? 0;
  if (type === "meca") return s.mechanical ?? 0;
  return (s.electrical ?? 0) + (s.mechanical ?? 0);
}

/**
 * Niveau de disponibilité → couleur du marker.
 *  off    : station hors service (gris)
 *  danger : peu/aucun vélo (rouge)   ≤ 2
 *  warn   : disponibilité moyenne (orange) 3–5
 *  ok     : beaucoup de vélos (vert) ≥ 6
 */
export function availabilityLevel(count, offline) {
  if (offline) return "off";
  if (count <= 2) return "danger";
  if (count <= 5) return "warn";
  return "ok";
}
