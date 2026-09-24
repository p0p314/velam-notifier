// Logique des alertes côté client : valeurs par défaut, conversion formulaire ↔ API,
// résumés lisibles. Sans React → testable unitairement.

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

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

/**
 * Formulaire vierge. Avec `station` (création depuis un favori), propose un créneau
 * qui démarre maintenant (arrondi au quart d'heure) pour 1 h 30.
 */
export function defaultForm(station = null, now = new Date()) {
  const form = {
    stationId: station?.station_id ?? "",
    target: "bikes",
    comparison: "at_most",
    bikeType: "any",
    threshold: 1,
    trip: false,
    arrivalId: "",
    arrivalThreshold: 1,
    timeStart: "08:00",
    timeEnd: "10:00",
    days: [...ALL_DAYS],
    oneShot: false,
  };
  if (station) {
    const start = new Date(now);
    start.setMinutes(Math.floor(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + 90 * 60_000);
    // Créneau qui déborderait après minuit : on s'arrête à 23:59.
    form.timeStart = hhmm(start);
    form.timeEnd = end.getDate() === start.getDate() ? hhmm(end) : "23:59";
  }
  return form;
}

/** Alerte API → état du formulaire (édition). */
export function formFromAlert(a) {
  return {
    stationId: a.station_id,
    target: a.target ?? "bikes",
    comparison: a.comparison ?? "at_most",
    bikeType: a.bike_type ?? "any",
    threshold: a.threshold ?? 1,
    trip: !!a.arrival_station_id,
    arrivalId: a.arrival_station_id ?? "",
    arrivalThreshold: a.arrival_threshold ?? 1,
    timeStart: a.time_start,
    timeEnd: a.time_end,
    days: a.days ? a.days.split(",").map(Number) : [...ALL_DAYS],
    oneShot: !!a.valid_on,
    validOn: a.valid_on ?? null,
  };
}

/** Le trajet n'a de sens que pour « vélos, il en reste peu ». */
export const tripAllowed = (form) => form.target === "bikes" && form.comparison === "at_most";

/**
 * Contrôles côté client (le serveur revalide tout). Renvoie un message ou null.
 */
export function validateForm(form) {
  if (!form.stationId) return "Choisissez une station";
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
  const trip = form.trip && tripAllowed(form);
  return {
    station_id: form.stationId,
    station_name: names[form.stationId] ?? form.stationId,
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

const bikesWord = (type, n) => `vélo${n > 1 ? "s" : ""}${BIKE_WORD[type] ?? ""}${type !== "any" && n > 1 ? "s" : ""}`;
const docksWord = (n) => `place${n > 1 ? "s" : ""}`;

/** Résumé d'une alerte pour sa carte : { title, detail }. */
export function describeAlert(a) {
  const cmp = a.comparison === "at_least" ? "≥" : "≤";
  const n = a.threshold ?? 0;
  const what = a.target === "docks" ? docksWord(n) : bikesWord(a.bike_type, n);
  const window = `${a.time_start}–${a.time_end}`;
  if (a.arrival_station_id) {
    const arr = a.arrival_threshold ?? 0;
    return {
      title: `${a.station_name} → ${a.arrival_station_name}`,
      detail: `Départ ${cmp} ${n} ${what} · Arrivée ≤ ${arr} ${docksWord(arr)} · ${window}`,
    };
  }
  return { title: a.station_name, detail: `${cmp} ${n} ${what} · ${window}` };
}

/** « 30/09 » pour les bandeaux (pause, alerte ponctuelle). */
export function fmtDay(ymd) {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}
