// Logique des alertes côté client : valeurs par défaut, conversion formulaire ↔ API,
// résumés lisibles. Sans React → testable unitairement.

import { getBikePref } from "./prefs";

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

// Groupe de stations : bornes alignées sur le serveur (routes/alerts.js).
export const GROUP_MIN = 2;
export const GROUP_MAX = 5;
export const GROUP_NAME_MAX = 40;
// Heures d'envoi d'un résumé (alignées sur le serveur).
export const SEND_TIMES_MAX = 6;

const BIKE_WORD = { mechanical: " mécanique", ebike: " électrique", any: "" };

/** Date locale de l'appareil au format YYYY-MM-DD (l'API compare en heure de Paris). */
export function localYmd(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Durée du créneau proposé à la création : de maintenant à +30 min.
export const DEFAULT_WINDOW_MIN = 30;

/**
 * Formulaire vierge (`station` : création depuis la fiche d'une station). Le créneau
 * proposé démarre à l'heure actuelle et dure 30 min ; s'il déborderait après minuit,
 * il s'arrête à 23:59.
 */
export function defaultForm(station = null, now = new Date()) {
  const end = new Date(now.getTime() + DEFAULT_WINDOW_MIN * 60_000);
  return {
    kind: "threshold",
    stationId: station?.station_id ?? "",
    group: false,
    groupIds: [],
    groupName: "",
    target: "bikes",
    comparison: "at_most",
    bikeType: getBikePref(),
    threshold: 1,
    trip: false,
    arrivalId: "",
    arrivalThreshold: 1,
    timeStart: hhmm(now),
    timeEnd: end.getDate() === now.getDate() ? hhmm(end) : "23:59",
    sendTimes: ["08:00"],
    days: [...ALL_DAYS],
    oneShot: false,
  };
}

/**
 * Heure proposée pour un nouvel envoi de résumé : 1 h après la dernière, en évitant
 * les heures déjà prises (tour du cadran au besoin).
 */
export function nextSendTime(times) {
  const last = times[times.length - 1] || "08:00";
  const base = Number(last.slice(0, 2)) * 60 + Number(last.slice(3, 5));
  for (let h = 1; h <= 24; h++) {
    const m = (base + h * 60) % 1440;
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (!times.includes(t)) return t;
  }
  return last;
}

/** Alerte API → état du formulaire (édition). */
export function formFromAlert(a) {
  const summary = a.kind === "summary";
  return {
    kind: summary ? "summary" : "threshold",
    stationId: a.station_id,
    // Un résumé repassé en alerte part d'une station unique (sa 1re station).
    group: !summary && !!a.group_stations?.length,
    groupIds: a.group_stations?.map((s) => s.station_id) ?? [],
    groupName: a.group_name ?? "",
    target: a.target ?? "bikes",
    comparison: a.comparison ?? "at_most",
    bikeType: a.bike_type ?? "any",
    threshold: a.threshold ?? 1,
    trip: !!a.arrival_station_id,
    arrivalId: a.arrival_station_id ?? "",
    arrivalThreshold: a.arrival_threshold ?? 1,
    timeStart: a.time_start,
    timeEnd: a.time_end,
    sendTimes: a.send_times?.length ? [...a.send_times] : [a.time_start],
    days: a.days ? a.days.split(",").map(Number) : [...ALL_DAYS],
    oneShot: !!a.valid_on,
    validOn: a.valid_on ?? null,
  };
}

/**
 * Copie d'une alerte → formulaire de création pré-rempli (rien n'est créé avant validation :
 * on ajuste d'abord la station, l'heure…). Un groupe nommé prend « (copie) » pour être
 * distinguable dans la liste ; une ponctuelle copiée vaut pour aujourd'hui.
 */
export function copyForm(a) {
  const form = formFromAlert(a);
  const name = form.groupName.trim();
  if (name) form.groupName = `${name.slice(0, GROUP_NAME_MAX - 8)} (copie)`;
  form.validOn = null;
  return form;
}

/** Le trajet n'a de sens que pour « vélos, il en reste peu », sur une seule station. */
export const tripAllowed = (form) => !form.group && form.target === "bikes" && form.comparison === "at_most";

/**
 * Règle d'un groupe en toutes lettres (sous le seuil du formulaire) :
 * « au plus N » ⇒ toutes les stations ; « au moins N » ⇒ une seule suffit.
 */
export function groupRuleText(form) {
  const n = Number(form.threshold) || 0;
  const what = form.target === "docks" ? `${n} ${docksWord(n)} libre${n > 1 ? "s" : ""}` : `${n} ${bikesWord(form.bikeType, n)}`;
  return form.comparison === "at_least"
    ? `Alerte dès qu'une des stations a au moins ${what}.`
    : `Alerte seulement quand toutes les stations ont au plus ${what}.`;
}

/**
 * Contrôles côté client (le serveur revalide tout). Renvoie un message ou null.
 */
export function validateForm(form) {
  if (form.kind === "summary") {
    if (form.groupIds.length < 1 || form.groupIds.length > GROUP_MAX) return `Choisissez de 1 à ${GROUP_MAX} stations`;
    if (form.groupName.trim().length > GROUP_NAME_MAX) return `Nom du groupe : ${GROUP_NAME_MAX} caractères maximum`;
    const times = form.sendTimes.filter(Boolean);
    if (times.length < form.sendTimes.length || times.length === 0) return "Choisissez chaque heure d'envoi";
    if (times.length > SEND_TIMES_MAX) return `${SEND_TIMES_MAX} heures d'envoi maximum`;
    if (new Set(times).size < times.length) return "Chaque heure d'envoi ne peut figurer qu'une fois";
    return null;
  }
  if (form.group) {
    if (form.groupIds.length < GROUP_MIN || form.groupIds.length > GROUP_MAX) {
      return `Choisissez de ${GROUP_MIN} à ${GROUP_MAX} stations`;
    }
    if (form.groupName.trim().length > GROUP_NAME_MAX) return `Nom du groupe : ${GROUP_NAME_MAX} caractères maximum`;
  } else if (!form.stationId) return "Choisissez une station";
  if (!form.timeStart || !form.timeEnd || form.timeEnd <= form.timeStart) {
    return "L'heure de fin doit être postérieure à l'heure de début";
  }
  const n = Number(form.threshold);
  const min = form.comparison === "at_least" ? 1 : 0;
  if (!Number.isInteger(n) || n < min || n > 50) return `Le seuil doit être un entier entre ${min} et 50`;
  if (form.trip && tripAllowed(form)) {
    if (!form.arrivalId) return "Choisissez la station d'arrivée";
    if (form.arrivalId === form.stationId) return "L'arrivée doit être différente du départ";
    const a = Number(form.arrivalThreshold);
    if (!Number.isInteger(a) || a < 0 || a > 50) return "Le seuil d'arrivée doit être un entier entre 0 et 50";
  }
  return null;
}

/**
 * Formulaire → payload API. `names` : { station_id: nom } pour les stations proposées.
 * Une alerte ponctuelle déjà datée garde sa date ; une nouvelle prend `today`.
 */
export function payloadFromForm(form, names, today = localYmd()) {
  if (form.kind === "summary") return summaryPayload(form, names);
  const trip = form.trip && tripAllowed(form);
  const stationId = form.group ? form.groupIds[0] : form.stationId;
  return {
    kind: "threshold",
    station_id: stationId,
    station_name: names[stationId] ?? stationId,
    // Toujours envoyés (null en mode simple) : un PATCH repasse ainsi un groupe en simple.
    group_stations: form.group ? namedStations(form.groupIds, names) : null,
    group_name: form.group ? (form.groupName.trim() || null) : null,
    target: form.target,
    comparison: form.comparison,
    bike_type: form.target === "bikes" ? form.bikeType : "any",
    threshold: Number(form.threshold),
    arrival_station_id: trip ? form.arrivalId : null,
    arrival_station_name: trip ? (names[form.arrivalId] ?? form.arrivalId) : null,
    arrival_threshold: trip ? Number(form.arrivalThreshold) : null,
    time_start: form.timeStart,
    time_end: form.timeEnd,
    days: form.days.join(","),
    valid_on: form.oneShot ? (form.validOn ?? today) : null,
  };
}

const namedStations = (ids, names) => ids.map((id) => ({ station_id: id, station_name: names[id] ?? id }));

/** Résumé à heure fixe : champs de seuil / trajet neutres (le serveur les force aussi). */
function summaryPayload(form, names) {
  const id = form.groupIds[0];
  const times = [...form.sendTimes].sort();
  return {
    kind: "summary",
    station_id: id,
    station_name: names[id] ?? id,
    group_stations: namedStations(form.groupIds, names),
    group_name: form.groupName.trim() || null,
    target: "bikes",
    comparison: "at_most",
    bike_type: form.bikeType,
    threshold: 0,
    arrival_station_id: null,
    arrival_station_name: null,
    arrival_threshold: null,
    send_times: times,
    time_start: times[0],
    time_end: times[0],
    days: form.days.join(","),
    valid_on: null,
  };
}

const bikesWord = (type, n) => `vélo${n > 1 ? "s" : ""}${BIKE_WORD[type] ?? ""}${type !== "any" && n > 1 ? "s" : ""}`;
const docksWord = (n) => `place${n > 1 ? "s" : ""}`;

/**
 * Résumé d'une alerte pour sa carte : { title, detail, bikeType }. Le type (alerte /
 * résumé) et les vélos sont montrés en icônes par la carte, pas en texte : le seuil
 * s'écrit « ≤ 1 » (vélos) ou « ≤ 1 place » (places libres, qui gardent leur mot).
 * `bikeType` = "mechanical" | "ebike" | "any", ou null (places libres).
 */
export function describeAlert(a) {
  const cmp = a.comparison === "at_least" ? "≥" : "≤";
  const n = a.threshold ?? 0;
  const what = a.target === "docks" ? ` ${docksWord(n)}` : "";
  const window = `${a.time_start}–${a.time_end}`;
  const bikeType = a.target === "docks" ? null : a.bike_type ?? "any";
  if (a.kind === "summary") {
    const list = (a.group_stations ?? []).map((s) => s.station_name).join(", ");
    const detail = (a.send_times?.length ? a.send_times : [a.time_start]).join(", ");
    // Groupe nommé : le nom suffit (stations visibles en modifiant l'alerte).
    return { title: a.group_name || list, detail, bikeType };
  }
  if (a.group_stations?.length) {
    const list = a.group_stations.map((s) => s.station_name).join(", ");
    const rule = a.comparison === "at_least" ? `l'une ≥ ${n}${what}` : `≤ ${n}${what}`;
    const detail = `${rule[0].toUpperCase()}${rule.slice(1)} · ${window}`;
    return { title: a.group_name || list, detail, bikeType };
  }
  if (a.arrival_station_id) {
    const arr = a.arrival_threshold ?? 0;
    return {
      title: `${a.station_name} → ${a.arrival_station_name}`,
      detail: `Départ ${cmp} ${n}${what} · Arrivée ≤ ${arr} ${docksWord(arr)} · ${window}`,
      bikeType,
    };
  }
  return { title: a.station_name, detail: `${cmp} ${n}${what} · ${window}`, bikeType };
}

// ── Liste : filtre et tri ─────────────────────────────────────────────────────

export const LIST_FILTERS = [
  { value: "all",       label: "Toutes" },
  { value: "threshold", label: "Disponibilité" },
  { value: "summary",   label: "Résumés" },
];
export const LIST_SORTS = [
  { value: "time",   label: "Par heure" },
  { value: "name",   label: "Par nom" },
  { value: "recent", label: "Plus récentes" },
];
const LIST_PREFS_KEY = "velopulse-alerts-list";

/** Préférences de liste mémorisées sur l'appareil (confort : défaut si absentes/illisibles). */
export function loadListPrefs() {
  const def = { filter: "all", sort: "time" };
  try {
    const p = JSON.parse(localStorage.getItem(LIST_PREFS_KEY)) ?? {};
    return {
      filter: LIST_FILTERS.some((f) => f.value === p.filter) ? p.filter : def.filter,
      sort: LIST_SORTS.some((o) => o.value === p.sort) ? p.sort : def.sort,
    };
  } catch { return def; }
}
export function saveListPrefs(prefs) {
  try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(prefs)); } catch { /* facultatif */ }
}

const kindOf = (a) => (a.kind === "summary" ? "summary" : "threshold");

/**
 * Alertes à afficher : filtrées par type, triées (heure de début / d'envoi, nom affiché,
 * ou création la plus récente). Les alertes désactivées passent toujours en fin de liste.
 */
export function visibleAlerts(alerts, { filter = "all", sort = "time" } = {}) {
  const title = (a) => describeAlert(a).title;
  const byName = (a, b) => title(a).localeCompare(title(b), "fr");
  const cmp = {
    time:   (a, b) => a.time_start.localeCompare(b.time_start) || byName(a, b),
    name:   (a, b) => byName(a, b) || a.time_start.localeCompare(b.time_start),
    recent: (a, b) => b.id - a.id,
  }[sort] ?? (() => 0);
  return alerts
    .filter((a) => filter === "all" || kindOf(a) === filter)
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || cmp(a, b));
}

/** Le filtre par type n'a d'intérêt que si les deux types coexistent. */
export const hasBothKinds = (alerts) => new Set(alerts.map(kindOf)).size > 1;

/** « 30/09 » pour les bandeaux (pause, alerte ponctuelle). */
export function fmtDay(ymd) {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}
