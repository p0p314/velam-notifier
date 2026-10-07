import { describe, test, expect } from "vitest";
import {
  fmtClock, delayLabel, timeInfo, statusInfo, agoLabel, freshnessInfo, applyFilters, filterOptions, activeFilterCount, journeyPhase,
  DEFAULT_FILTERS, searchFromQuery, queryFromSearch, apiSearchQuery, searchError, searchTitle,
  tripAlertForm, tripAlertPayload, lineAlertForm, lineAlertPayload, alertFormError, describeTrainAlert, daysLabel, favoriteTitle,
} from "../lib/trains";

// 16:53 à Paris le 7 octobre 2026 (UTC+2).
const j = (over = {}) => ({
  id: "t|2026-10-07|A|B", status: "scheduled", phase: "upcoming", disrupted: false, alerts: [],
  line: { name: "K44" }, departureStation: { id: "A", name: "Lille Flandres" }, arrivalStation: { id: "B", name: "Amiens" },
  scheduledDeparture: "2026-10-07T14:53:00.000Z", estimatedDeparture: null, departureDelay: null,
  scheduledArrival: "2026-10-07T16:10:00.000Z", estimatedArrival: null, arrivalDelay: null,
  ...over,
});

describe("affichage des horaires", () => {
  test("heure du réseau (Europe/Paris), quel que soit le fuseau de l'appareil", () => {
    expect(fmtClock("2026-10-07T14:53:00.000Z")).toBe("16:53");
    expect(fmtClock(null)).toBe("");
  });

  test("heure estimée seulement si elle diffère de l'heure prévue", () => {
    expect(timeInfo("2026-10-07T14:53:00.000Z", "2026-10-07T15:02:00.000Z", 9)).toEqual({ scheduled: "16:53", estimated: "17:02", delay: "+9 min" });
    expect(timeInfo("2026-10-07T14:53:00.000Z", "2026-10-07T14:53:00.000Z", 0)).toEqual({ scheduled: "16:53", estimated: null, delay: "" });
    expect(timeInfo("2026-10-07T14:53:00.000Z", null, null)).toEqual({ scheduled: "16:53", estimated: null, delay: "" });
    expect(delayLabel(-2)).toBe("−2 min");
  });

  test("statuts et phases", () => {
    expect(statusInfo(j({ status: "delayed" }))).toMatchObject({ label: "En retard", tone: "warn" });
    expect(statusInfo(j({ status: "cancelled", cancellation: { partial: false } })).label).toBe("Supprimé");
    expect(statusInfo(j({ status: "cancelled", cancellation: { partial: true } })).label).toBe("Arrêt supprimé");
    expect(statusInfo(j({ status: "on_time", phase: "en_route" }))).toMatchObject({ label: "À l'heure", phase: "Parti" });
    expect(statusInfo(j())).toMatchObject({ label: "Horaire théorique", tone: "neutral" });
  });

  test("fraîcheur : temps réel, indisponible, théorique", () => {
    const now = Date.parse("2026-10-07T15:00:00Z");
    expect(agoLabel("2026-10-07T14:59:00Z", now)).toBe("il y a 1 min");
    expect(agoLabel("2026-10-07T14:59:50Z", now)).toBe("à l'instant");
    expect(freshnessInfo({ applicable: true, available: true, updated_at: "2026-10-07T14:59:00Z" }, now).text).toBe("Temps réel — mis à jour il y a 1 min");
    expect(freshnessInfo({ applicable: true, available: false }, now).text).toBe("Temps réel indisponible — horaires théoriques");
    expect(freshnessInfo({ applicable: false }, now).text).toBe("Horaires théoriques");
  });
});

describe("filtres et tris", () => {
  const list = [
    j({ id: "1", trainNumber: "1" }),
    j({ id: "2", status: "delayed", departureDelay: 12, scheduledDeparture: "2026-10-07T15:53:00.000Z", scheduledArrival: "2026-10-07T17:10:00.000Z", line: { name: "K45" } }),
    j({ id: "3", status: "cancelled", scheduledDeparture: "2026-10-07T18:53:00.000Z", scheduledArrival: "2026-10-07T20:10:00.000Z", arrivalStation: { id: "C", name: "Albert" } }),
  ];
  const ids = (f) => applyFilters(list, { ...DEFAULT_FILTERS, ...f }).map((x) => x.id);

  test("heure min / max, ligne, gares, état", () => {
    expect(ids({ minTime: "17:00" })).toEqual(["2", "3"]);
    expect(ids({ maxTime: "17:00" })).toEqual(["1"]);
    expect(ids({ line: "K45" })).toEqual(["2"]);
    expect(ids({ to: "C" })).toEqual(["3"]);
    expect(ids({ status: "delayed" })).toEqual(["2"]);
    expect(ids({ status: "cancelled" })).toEqual(["3"]);
  });

  test("trains passés : phase recalculée à l'instant, heures estimées, supprimés à l'horaire prévu", () => {
    const at = (iso) => Date.parse(iso);
    // Heures de Paris : 1 = 16:53 → 18:10, 2 = 17:53 → 19:10, 3 (supprimé) = 20:53 → 22:10.
    const late = j({ id: "4", estimatedDeparture: "2026-10-07T15:10:00.000Z", estimatedArrival: "2026-10-07T16:30:00.000Z" });
    expect(journeyPhase(late, at("2026-10-07T15:00:00Z"))).toBe("upcoming"); // prévu 16:53, estimé 17:10
    expect(journeyPhase(late, at("2026-10-07T16:20:00Z"))).toBe("left");     // arrivée estimée 18:30
    expect(journeyPhase(late, at("2026-10-07T16:30:00Z"))).toBe("arrived");
    const now = at("2026-10-07T17:30:00Z"); // 19:30 : 1 arrivé, 2 arrivé, 3 à venir
    expect(applyFilters(list, { ...DEFAULT_FILTERS, past: "arrived" }, now).map((x) => x.id)).toEqual(["3"]);
    const mid = at("2026-10-07T16:00:00Z"); // 18:00 : 1 parti, 2 parti (17:53), 3 à venir
    expect(applyFilters(list, { ...DEFAULT_FILTERS, past: "arrived" }, mid).map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(applyFilters(list, { ...DEFAULT_FILTERS, past: "left" }, mid).map((x) => x.id)).toEqual(["3"]);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, past: "left" })).toBe(1);
  });

  test("tris : départ, arrivée, retard (supprimés en tête)", () => {
    expect(ids({ sort: "departure" })).toEqual(["1", "2", "3"]);
    expect(ids({ sort: "delay" })).toEqual(["3", "2", "1"]);
    expect(ids({ sort: "arrival" })).toEqual(["1", "2", "3"]);
  });

  test("options proposées et compteur de filtres actifs", () => {
    const o = filterOptions(list);
    expect(o.lines.map((x) => x.value)).toEqual(["K44", "K45"]);
    expect(o.to.map((x) => x.label)).toEqual(["Albert", "Amiens"]);
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, status: "delayed", minTime: "08:00" })).toBe(2);
  });
});

describe("recherche", () => {
  const s = { from: { id: "A", name: "Lille Flandres" }, to: { id: "B", name: "Amiens" }, line: { id: "L1", name: "K44", longName: "Lille Flandres - Amiens" }, date: "2026-10-07", after: "16:00" };

  test("aller-retour URL ↔ recherche (les noms sont conservés)", () => {
    expect(searchFromQuery(queryFromSearch(s))).toEqual(s);
    expect(apiSearchQuery(s, { refresh: true })).toBe("from=A&to=B&line=L1&date=2026-10-07&after=16%3A00&refresh=1");
  });

  test("validation et titre", () => {
    expect(searchError({})).toMatch(/gare/);
    expect(searchError({ from: s.from, to: s.from })).toMatch(/différentes/);
    expect(searchError({ line: s.line })).toBeNull();
    expect(searchTitle(s)).toBe("Lille Flandres → Amiens · Ligne K44 (Lille Flandres - Amiens)");
    expect(searchTitle({ from: s.from })).toBe("Départs de Lille Flandres");
  });
});

describe("alertes", () => {
  test("formulaire de trajet → API, et retour", () => {
    const form = tripAlertForm();
    expect(tripAlertPayload(form)).toEqual({ delay_threshold: 10, on_cancel: true, on_disruption: true, days: "1,2,3,4,5,6,7" });
    expect(tripAlertForm({ delay_threshold: null, on_cancel: true, on_disruption: false, days: "1,2" })).toEqual({ delay: "", onCancel: true, onDisruption: false, days: [1, 2] });
    expect(alertFormError({ ...form, delay: "", onCancel: false, onDisruption: false })).toMatch(/au moins un motif/);
  });

  test("formulaire de ligne : créneau facultatif", () => {
    const form = lineAlertForm();
    expect(lineAlertPayload(form)).toEqual({ on_disruption: true, on_cancel: false, time_start: null, time_end: null, days: "1,2,3,4,5" });
    expect(lineAlertPayload({ ...form, window: true })).toMatchObject({ time_start: "06:00", time_end: "20:00" });
  });

  test("résumés lisibles", () => {
    expect(describeTrainAlert({ scope: "trip", delay_threshold: 10, on_cancel: true, on_disruption: false, days: "1,2,3,4,5" })).toBe("Retard ≥ 10 min · suppression — lun.–ven.");
    expect(describeTrainAlert({ scope: "line", on_cancel: true, on_disruption: true, days: "6,7", time_start: "07:00", time_end: "09:00" })).toBe("Trains supprimés · perturbations — le week-end de 07:00 à 09:00");
    expect(daysLabel("1,3")).toBe("lun., mer.");
    expect(favoriteTitle({ departure_time: "16:53", origin_name: "Lille Flandres", destination_name: "Amiens" })).toBe("16:53 Lille Flandres → Amiens");
    expect(favoriteTitle({ label: "Retour", departure_time: "16:53" })).toBe("Retour");
  });
});
