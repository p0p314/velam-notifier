// Module Trains : logique pure (affichage, filtres, tris, formulaires). Sans React → testable.
// Les heures sont affichées dans le fuseau du réseau (Europe/Paris), quel que soit
// celui de l'appareil : « 16:53 » doit rester l'heure lue en gare.

export const NETWORK_TZ = "Europe/Paris";

const clockFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: NETWORK_TZ, hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: NETWORK_TZ, weekday: "long", day: "numeric", month: "long" });
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: NETWORK_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** « 16:53 » (ISO → heure locale du réseau) ; "" si absent. */
export const fmtClock = (iso) => (iso ? clockFmt.format(new Date(iso)) : "");

/** Date du jour dans le fuseau du réseau (« AAAA-MM-JJ »). */
export const networkToday = (now = new Date()) => ymdFmt.format(now);

/** « mercredi 7 octobre » pour une date « AAAA-MM-JJ ». */
export const fmtDayLong = (ymd) => dayFmt.format(new Date(`${ymd}T12:00:00Z`));

/** Retard lisible : « +9 min », « -2 min » (avance), "" si nul ou inconnu. */
export function delayLabel(min) {
  if (min === null || min === undefined || min === 0) return "";
  return `${min > 0 ? "+" : "−"}${Math.abs(min)} min`;
}

/**
 * Horaires à afficher pour un côté (départ / arrivée) : l'heure estimée n'est donnée
 * que si elle diffère de l'heure prévue (« Prévu 16:53 · Estimé 17:02 · +9 min »).
 */
export function timeInfo(scheduled, estimated, delay) {
  const sched = fmtClock(scheduled);
  const est = fmtClock(estimated);
  const changed = !!est && est !== sched;
  return { scheduled: sched, estimated: changed ? est : null, delay: changed ? delayLabel(delay) : "" };
}

/** Statut du trajet : libellé + ton (couleur), et phase (« Parti », « Arrivé »). */
export function statusInfo(j) {
  const byStatus = {
    cancelled: { label: j.cancellation?.partial ? "Arrêt supprimé" : "Supprimé", tone: "danger" },
    delayed:   { label: "En retard", tone: "warn" },
    on_time:   { label: "À l'heure", tone: "ok" },
    scheduled: { label: "Horaire théorique", tone: "neutral" },
  };
  const s = byStatus[j.status] ?? byStatus.scheduled;
  const phase = j.phase === "en_route" ? "Parti" : j.phase === "arrived" ? "Arrivé" : null;
  return { ...s, phase };
}

/** « à l'instant », « il y a 1 min », « il y a 2 h ». */
export function agoLabel(iso, now = Date.now()) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.floor(m / 60)} h`;
}

/**
 * Bandeau de fraîcheur des données d'une recherche :
 *  - date lointaine : « Horaires théoriques » ;
 *  - temps réel disponible : « Temps réel — mis à jour il y a 1 min » ;
 *  - temps réel indisponible : « Temps réel indisponible — horaires théoriques ».
 */
export function freshnessInfo(realtime, now = Date.now()) {
  if (!realtime?.applicable) return { tone: "neutral", text: "Horaires théoriques" };
  if (realtime.available) return { tone: "ok", text: `Temps réel — mis à jour ${agoLabel(realtime.updated_at, now)}` };
  return { tone: "warn", text: "Temps réel indisponible — horaires théoriques" };
}

/** Ligne affichable : « K44 » (ou la marque, ou « Train »), couleurs de la ligne si fournies. */
export function lineBadge(line, j = null) {
  const name = line?.name || j?.brand || (j?.mode === "car" ? "Car" : "Train");
  const style = line?.color ? { background: `#${line.color}`, color: line.textColor ? `#${line.textColor}` : "var(--on-accent)" } : null;
  return { name, style };
}

// ── Filtres et tris (côté client, sur les résultats d'une journée) ───────────

export const SORTS = [
  { value: "departure", label: "Heure de départ" },
  { value: "arrival",   label: "Heure d'arrivée" },
  { value: "delay",     label: "Retard" },
];

export const STATUS_FILTERS = [
  { value: "all",       label: "Tous" },
  { value: "delayed",   label: "En retard" },
  { value: "cancelled", label: "Supprimés" },
  { value: "on_time",   label: "À l'heure" },
  { value: "disrupted", label: "Perturbés" },
];

/** Trains déjà passés : tout afficher, masquer les arrivés, ou aussi ceux déjà partis. */
export const PAST_FILTERS = [
  { value: "",        label: "Tout afficher" },
  { value: "arrived", label: "Masquer les trains arrivés" },
  { value: "left",    label: "Masquer les trains partis et arrivés" },
];

export const DEFAULT_FILTERS = { minTime: "", maxTime: "", line: "", from: "", to: "", status: "all", sort: "departure", past: "" };

/** Nombre de filtres actifs (pastille du bouton « Filtrer »). */
export const activeFilterCount = (f) =>
  ["minTime", "maxTime", "line", "from", "to", "past"].filter((k) => f[k]).length + (f.status !== "all" ? 1 : 0) + (f.sort !== "departure" ? 1 : 0);

const PAST_KEY = "velopulse-trains-passes";
const PAST_VALUES = new Set(PAST_FILTERS.map((o) => o.value));

/** Choix « Trains passés » mémorisé sur l'appareil (gardé d'une recherche à l'autre). */
export function loadPastFilter() {
  try { const v = localStorage.getItem(PAST_KEY) ?? ""; return PAST_VALUES.has(v) ? v : ""; } catch { return ""; }
}
export function savePastFilter(v) {
  try { if (v) localStorage.setItem(PAST_KEY, v); else localStorage.removeItem(PAST_KEY); } catch { /* stockage indisponible */ }
}

/** Filtres de départ d'une recherche : par défaut, sauf le choix « Trains passés » mémorisé. */
export const initialFilters = () => ({ ...DEFAULT_FILTERS, past: loadPastFilter() });

/**
 * Phase d'un train à l'instant `now` (recalculée côté client : la liste reste affichée
 * entre deux actualisations) : « upcoming », « left » (parti) ou « arrived ». Heures
 * estimées si connues ; un train supprimé suit ses heures prévues. Les passages en gare
 * signalés par la SNCF (`passage`, trains proches) priment sur les heures.
 */
export function journeyPhase(j, now = Date.now()) {
  const live = j.status !== "cancelled";
  const p = live ? j.passage ?? {} : {};
  if (p.arrived === true) return "arrived";
  if (p.departed === false) return "upcoming";
  const dep = Date.parse((live && j.estimatedDeparture) || j.scheduledDeparture);
  const arr = Date.parse((live && j.estimatedArrival) || j.scheduledArrival);
  if (now >= arr && p.arrived !== false) return "arrived";
  return now >= dep || p.departed === true ? "left" : "upcoming";
}

const maxDelay = (j) => Math.max(j.departureDelay ?? 0, j.arrivalDelay ?? 0);

/** Applique filtres et tri. Heures comparées en « HH:MM » du réseau. */
export function applyFilters(journeys, f = DEFAULT_FILTERS, now = Date.now()) {
  const list = journeys.filter((j) => {
    if (f.past) {
      const phase = journeyPhase(j, now);
      if (phase === "arrived" || (f.past === "left" && phase === "left")) return false;
    }
    const dep = fmtClock(j.scheduledDeparture);
    if (f.minTime && dep < f.minTime) return false;
    if (f.maxTime && dep > f.maxTime) return false;
    if (f.line && (j.line?.name ?? "") !== f.line) return false;
    if (f.from && j.departureStation.id !== f.from) return false;
    if (f.to && j.arrivalStation.id !== f.to) return false;
    if (f.status === "delayed" && j.status !== "delayed") return false;
    if (f.status === "cancelled" && j.status !== "cancelled") return false;
    if (f.status === "on_time" && j.status !== "on_time") return false;
    if (f.status === "disrupted" && !j.disrupted && j.status !== "cancelled") return false;
    return true;
  });
  const key = {
    departure: (j) => Date.parse(j.scheduledDeparture),
    arrival:   (j) => Date.parse(j.estimatedArrival ?? j.scheduledArrival),
    delay:     (j) => -(j.status === "cancelled" ? Infinity : maxDelay(j)),
  }[f.sort] ?? ((j) => Date.parse(j.scheduledDeparture));
  return [...list].sort((a, b) => key(a) - key(b) || Date.parse(a.scheduledDeparture) - Date.parse(b.scheduledDeparture));
}

/** Valeurs proposées par les filtres (lignes, gares de départ / d'arrivée présentes). */
export function filterOptions(journeys) {
  const uniq = (pairs) => [...new Map(pairs).entries()].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
  return {
    lines: uniq(journeys.filter((j) => j.line?.name).map((j) => [j.line.name, j.line.name])),
    from: uniq(journeys.map((j) => [j.departureStation.id, j.departureStation.name])),
    to: uniq(journeys.map((j) => [j.arrivalStation.id, j.arrivalStation.name])),
  };
}

// ── Recherche ↔ URL (la recherche survit au retour arrière et se partage) ─────

/** Recherche lue dans l'URL : { from:{id,name}|null, to, line:{id,name,longName}|null, date, after }. */
export function searchFromQuery(params) {
  const pair = (id, name) => (params.get(id) ? { id: params.get(id), name: params.get(name) || params.get(id) } : null);
  const line = params.get("line") ? { id: params.get("line"), name: params.get("lineName") || params.get("line"), longName: params.get("lineLong") || "" } : null;
  return {
    from: pair("from", "fromName"),
    to: pair("to", "toName"),
    line,
    date: params.get("date") || "",
    after: params.get("after") || "",
  };
}

/** Paramètres d'URL d'une recherche (noms inclus pour réafficher les champs). */
export function queryFromSearch(s) {
  const p = new URLSearchParams();
  if (s.from) { p.set("from", s.from.id); p.set("fromName", s.from.name); }
  if (s.to) { p.set("to", s.to.id); p.set("toName", s.to.name); }
  if (s.line) { p.set("line", s.line.id); p.set("lineName", s.line.name); if (s.line.longName) p.set("lineLong", s.line.longName); }
  if (s.date) p.set("date", s.date);
  if (s.after) p.set("after", s.after);
  return p;
}

/** Paramètres envoyés à /api/trains/search. */
export function apiSearchQuery(s, { refresh = false } = {}) {
  const p = new URLSearchParams();
  if (s.from) p.set("from", s.from.id);
  if (s.to) p.set("to", s.to.id);
  if (s.line) p.set("line", s.line.id);
  if (s.date) p.set("date", s.date);
  if (s.after) p.set("after", s.after);
  if (refresh) p.set("refresh", "1");
  return p.toString();
}

/** Une recherche est-elle lançable ? (une gare ou une ligne au minimum, gares distinctes) */
export function searchError(s) {
  if (!s.from && !s.to && !s.line) return "Choisissez une gare de départ, d'arrivée ou une ligne.";
  if (s.from && s.to && s.from.id === s.to.id) return "Les gares de départ et d'arrivée doivent être différentes.";
  return null;
}

/** Titre d'une recherche : « Lille Flandres → Amiens · K44 ». */
export function searchTitle(s) {
  const route = s.from && s.to ? `${s.from.name} → ${s.to.name}`
    : s.from ? `Départs de ${s.from.name}` : s.to ? `Arrivées à ${s.to.name}` : "";
  const line = s.line ? `Ligne ${s.line.name}${s.line.longName ? ` (${s.line.longName})` : ""}` : "";
  return [route, line].filter(Boolean).join(" · ");
}

// ── Alertes ─────────────────────────────────────────────────────────────────

export const DELAY_OPTIONS = [
  { value: "", label: "Non" },
  { value: "5", label: "+5 min" },
  { value: "10", label: "+10 min" },
  { value: "15", label: "+15 min" },
  { value: "30", label: "+30 min" },
];

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Formulaire d'alerte de trajet (création ou modification). */
export function tripAlertForm(alert = null) {
  return {
    delay: alert ? (alert.delay_threshold ? String(alert.delay_threshold) : "") : "10",
    onCancel: alert ? !!alert.on_cancel : true,
    onDisruption: alert ? !!alert.on_disruption : true,
    onPlatform: alert ? !!alert.on_platform : true,
    days: alert ? alert.days.split(",").map(Number) : [...ALL_DAYS],
  };
}

/** Formulaire d'alerte de ligne. */
export function lineAlertForm(alert = null) {
  return {
    onDisruption: alert ? !!alert.on_disruption : true,
    onCancel: alert ? !!alert.on_cancel : false,
    window: !!alert?.time_start,
    timeStart: alert?.time_start ?? "06:00",
    timeEnd: alert?.time_end ?? "20:00",
    days: alert ? alert.days.split(",").map(Number) : [1, 2, 3, 4, 5],
  };
}

/** Erreur bloquante du formulaire, ou null. */
export function alertFormError(form, scope = "trip") {
  const any = (scope === "trip" && (form.delay || form.onPlatform)) || form.onCancel || form.onDisruption;
  if (!any) return "Choisissez au moins un motif d'alerte.";
  if (!form.days.length) return "Choisissez au moins un jour.";
  if (scope === "line" && form.window && (!form.timeStart || !form.timeEnd)) return "Indiquez le début et la fin du créneau.";
  return null;
}

export function tripAlertPayload(form) {
  return {
    delay_threshold: form.delay ? Number(form.delay) : null,
    on_cancel: form.onCancel,
    on_disruption: form.onDisruption,
    on_platform: form.onPlatform,
    days: form.days.join(","),
  };
}

export function lineAlertPayload(form) {
  return {
    on_disruption: form.onDisruption,
    on_cancel: form.onCancel,
    time_start: form.window ? form.timeStart : null,
    time_end: form.window ? form.timeEnd : null,
    days: form.days.join(","),
  };
}

const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** « tous les jours », « lun.–ven. », « lun., mer. » */
export function daysLabel(days) {
  const list = String(days).split(",").map(Number).sort();
  if (list.length === 7) return "tous les jours";
  if (list.join(",") === "1,2,3,4,5") return "lun.–ven.";
  if (list.join(",") === "6,7") return "le week-end";
  return list.map((d) => DAY_SHORT[d - 1]).join(", ");
}

/** Résumé d'une alerte : « Retard ≥ 10 min · suppression · perturbations — lun.–ven. » */
export function describeTrainAlert(a) {
  const parts = [];
  if (a.delay_threshold) parts.push(`retard ≥ ${a.delay_threshold} min`);
  if (a.on_cancel) parts.push(a.scope === "line" ? "trains supprimés" : "suppression");
  if (a.on_disruption) parts.push("perturbations");
  if (a.on_platform && a.scope !== "line") parts.push("voie");
  const what = parts.join(" · ");
  const when = a.scope === "line" && a.time_start ? ` de ${a.time_start} à ${a.time_end}` : "";
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} — ${daysLabel(a.days)}${when}`;
}

/** Nom d'un trajet favori : nom personnalisé, sinon « 16:53 Lille Flandres → Amiens ». */
export const favoriteTitle = (f) => f.label || `${f.departure_time} ${f.origin_name} → ${f.destination_name}`;

// ── Correspondance train ↔ Vélam ────────────────────────────────────────────

/** Distance à vol d'oiseau (km). */
function km(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const VELAM_MAX_KM = 1;

/**
 * Station Vélam utile près d'une gare (≤ 1 km) : `need` = "bikes" (vélos pour repartir
 * à l'arrivée) ou "docks" (places pour déposer son vélo au départ). La plus proche qui en
 * a au moins un, sinon la plus proche tout court (affichée « vide ») ; null si aucune
 * station dans le rayon (gare hors d'Amiens).
 */
export function nearbyVelam(stations, gare, need = "bikes") {
  if (!gare || gare.lat == null || gare.lon == null || !stations?.length) return null;
  const count = (s) => (need === "docks"
    ? (s.is_returning === false ? 0 : s.docks_available ?? 0)
    : (s.is_renting === false ? 0 : s.total_bikes ?? 0));
  const near = stations
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => ({ station: s, km: km(gare, s), count: count(s) }))
    .filter((x) => x.km <= VELAM_MAX_KM)
    .sort((a, b) => a.km - b.km);
  return near.find((x) => x.count > 0) ?? near[0] ?? null;
}
