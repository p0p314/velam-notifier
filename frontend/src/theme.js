// Palette : alias vers les variables CSS du design system (modes clair/sombre).
// Aucune couleur en dur — tout bascule via [data-theme] sur <html>.

export const C = {
  bg:     "var(--bg)",
  card:   "var(--surface)",
  border: "var(--border)",
  elec:   "var(--accent)",       // électrique = accent
  meca:   "var(--neutral-bar)",  // mécanique = neutre
  green:  "var(--ok)",
  amber:  "var(--warn)",
  empty:  "var(--text-3)",
  text:   "var(--text)",
  muted:  "var(--text-3)",
  dim:    "var(--inset)",
  accent: "var(--accent)",
  danger: "var(--danger)",
};

// Couleur d'un compteur selon la disponibilité (0 → vide, faible → warn, sinon ok).
export const bikeColor = (n) => (n === 0 ? "var(--text-3)" : n <= 2 ? "var(--warn)" : "var(--ok)");

export function fmtTime(ts) {
  if (!ts || ts < 1_000_000_000) return null;
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
