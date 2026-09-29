// Préférences propres à cet appareil (localStorage) : type de vélo par défaut et
// page d'ouverture. Le thème est géré par useTheme.jsx. Sans React → testable.

const BIKE_KEY = "velopulse-pref-bike";
const LANDING_KEY = "velopulse-pref-landing";

export const BIKE_TYPES = [
  { value: "any",        label: "Les deux" },
  { value: "ebike",      label: "Électrique" },
  { value: "mechanical", label: "Mécanique" },
];
export const LANDINGS = [
  { value: "auto",     label: "Automatique" },
  { value: "favoris",  label: "Favoris" },
  { value: "stations", label: "Stations" },
  { value: "carte",    label: "Carte" },
];

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.some((o) => o.value === v) ? v : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* facultatif */ }
}

/** Type de vélo par défaut (alertes, résumés, filtres) : "any" | "ebike" | "mechanical". */
export const getBikePref = () => read(BIKE_KEY, BIKE_TYPES, "any");
export const setBikePref = (v) => write(BIKE_KEY, v);

/** Page d'ouverture : "auto" (mobile → Favoris, ordinateur → Stations) ou une page. */
export const getLandingPref = () => read(LANDING_KEY, LANDINGS, "auto");
export const setLandingPref = (v) => write(LANDING_KEY, v);

/** Chemin d'ouverture de l'app selon la préférence et le format d'écran. */
export function landingPath(pref, isMobile) {
  if (pref === "auto") return isMobile ? "/favoris" : "/stations";
  return `/${pref}`;
}

/** Filtre des pages Stations / Carte ("all" | "elec" | "meca") correspondant au type préféré. */
export function stationFilterFor(bikeType) {
  return { ebike: "elec", mechanical: "meca" }[bikeType] ?? "all";
}
