import { describe, test, expect } from "vitest";
import {
  defaultForm, formFromAlert, validateForm, payloadFromForm, describeAlert,
  tripAllowed, groupRuleText, localYmd, addDaysYmd, fmtDay,
  visibleAlerts, hasBothKinds, loadListPrefs, saveListPrefs, nextSendTime,
} from "../lib/alerts";

const names = { 1: "Gare", 2: "Zoo" };

describe("defaultForm", () => {
  test("formulaire vierge : vélos, au plus 1, tous les jours", () => {
    const f = defaultForm();
    expect(f).toMatchObject({ stationId: "", target: "bikes", comparison: "at_most", threshold: 1, trip: false, oneShot: false });
    expect(f.days).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("créneau : de l'heure actuelle (à la minute) à +30 min", () => {
    const f = defaultForm(null, new Date(2025, 8, 24, 7, 52));
    expect([f.timeStart, f.timeEnd]).toEqual(["07:52", "08:22"]);
  });

  test("depuis une station : même créneau, station présélectionnée", () => {
    const f = defaultForm({ station_id: "1", name: "Gare" }, new Date(2025, 8, 24, 13, 5));
    expect(f.stationId).toBe("1");
    expect([f.timeStart, f.timeEnd]).toEqual(["13:05", "13:35"]);
  });

  test("tard le soir : fin bornée à 23:59", () => {
    const f = defaultForm(null, new Date(2025, 8, 24, 23, 40));
    expect([f.timeStart, f.timeEnd]).toEqual(["23:40", "23:59"]);
  });
});

describe("validateForm", () => {
  const ok = { ...defaultForm(), stationId: "1" };
  test("valide", () => expect(validateForm(ok)).toBeNull());
  test("station requise", () => expect(validateForm({ ...ok, stationId: "" })).toMatch(/station/));
  test("fin après début", () => expect(validateForm({ ...ok, timeStart: "08:00", timeEnd: "07:00" })).toMatch(/fin/));
  test("seuil : 0 permis en « au plus », pas en « au moins »", () => {
    expect(validateForm({ ...ok, threshold: 0 })).toBeNull();
    expect(validateForm({ ...ok, threshold: 0, comparison: "at_least" })).toMatch(/entre 1 et 50/);
    expect(validateForm({ ...ok, threshold: "abc" })).toMatch(/seuil/);
  });
  test("trajet : arrivée requise et différente", () => {
    expect(validateForm({ ...ok, trip: true })).toMatch(/arrivée/);
    expect(validateForm({ ...ok, trip: true, arrivalId: "1" })).toMatch(/différente/);
    expect(validateForm({ ...ok, trip: true, arrivalId: "2" })).toBeNull();
  });
  test("trajet ignoré hors « vélos, au plus »", () => {
    expect(tripAllowed({ target: "docks", comparison: "at_most" })).toBe(false);
    expect(validateForm({ ...ok, target: "docks", trip: true })).toBeNull();
  });
});

describe("payloadFromForm", () => {
  const base = { ...defaultForm(null, new Date(2025, 8, 24, 8, 0)), stationId: "1", threshold: "2" };

  test("alerte vélos classique", () => {
    expect(payloadFromForm({ ...base, bikeType: "ebike", days: [1, 3] }, names, "2025-09-24")).toEqual({
      kind: "threshold", station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "ebike",
      threshold: 2, arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
      group_stations: null, group_name: null,
      time_start: "08:00", time_end: "08:30", days: "1,3", valid_on: null,
    });
  });

  test("places : type de vélo neutralisé", () => {
    expect(payloadFromForm({ ...base, target: "docks", bikeType: "ebike" }, names).bike_type).toBe("any");
  });

  test("trajet", () => {
    const p = payloadFromForm({ ...base, trip: true, arrivalId: "2", arrivalThreshold: "0" }, names);
    expect(p).toMatchObject({ arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 0 });
  });

  test("trajet coché mais mode incompatible → pas envoyé", () => {
    const p = payloadFromForm({ ...base, comparison: "at_least", trip: true, arrivalId: "2" }, names);
    expect(p.arrival_station_id).toBeNull();
  });

  test("ponctuelle : date du jour, ou date existante conservée", () => {
    expect(payloadFromForm({ ...base, oneShot: true }, names, "2025-09-24").valid_on).toBe("2025-09-24");
    expect(payloadFromForm({ ...base, oneShot: true, validOn: "2025-09-20" }, names, "2025-09-24").valid_on).toBe("2025-09-20");
  });
});

describe("formFromAlert ↔ payloadFromForm", () => {
  test("aller-retour sans perte", () => {
    const alert = {
      id: 3, kind: "threshold", station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "mechanical",
      threshold: 1, arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 2,
      group_stations: null, group_name: null,
      time_start: "07:30", time_end: "08:30", days: "1,2,3,4,5", valid_on: null,
    };
    const { id, ...rest } = alert;
    expect(payloadFromForm(formFromAlert(alert), names)).toEqual(rest);
  });

  test("aller-retour d'un groupe", () => {
    const alert = {
      id: 4, kind: "threshold", station_id: "2", station_name: "Zoo", target: "docks", comparison: "at_least", bike_type: "any",
      threshold: 3, arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
      group_stations: [{ station_id: "2", station_name: "Zoo" }, { station_id: "1", station_name: "Gare" }],
      group_name: "Maison", time_start: "07:30", time_end: "08:30", days: "1,2,3,4,5", valid_on: null,
    };
    const { id, ...rest } = alert;
    expect(payloadFromForm(formFromAlert(alert), names)).toEqual(rest);
  });
});

describe("résumé à heure fixe", () => {
  const summary = { ...defaultForm(), kind: "summary", groupIds: ["1"], sendTimes: ["07:45"], bikeType: "ebike", days: [1, 2] };

  test("validation : 1 à 5 stations, heure requise", () => {
    expect(validateForm(summary)).toBeNull();
    expect(validateForm({ ...summary, groupIds: [] })).toMatch(/de 1 à 5 stations/);
    expect(validateForm({ ...summary, sendTimes: [""] })).toMatch(/heure d'envoi/);
    expect(validateForm({ ...summary, sendTimes: ["07:45", ""] })).toMatch(/heure d'envoi/);
    expect(validateForm({ ...summary, sendTimes: ["07:45", "07:45"] })).toMatch(/qu'une fois/);
    expect(validateForm({ ...summary, sendTimes: ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"] })).toMatch(/6 heures/);
    expect(validateForm({ ...summary, sendTimes: ["18:00", "07:45"] })).toBeNull();
    // Le seuil et le créneau d'une alerte ne s'appliquent pas.
    expect(validateForm({ ...summary, threshold: "abc", timeEnd: "00:00" })).toBeNull();
  });
  test("payload : heure d'envoi, champs de seuil neutres", () => {
    expect(payloadFromForm({ ...summary, groupIds: ["2", "1"], groupName: " Maison " }, names)).toEqual({
      kind: "summary", station_id: "2", station_name: "Zoo", group_name: "Maison",
      group_stations: [{ station_id: "2", station_name: "Zoo" }, { station_id: "1", station_name: "Gare" }],
      target: "bikes", comparison: "at_most", bike_type: "ebike", threshold: 0,
      arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
      send_times: ["07:45"], time_start: "07:45", time_end: "07:45", days: "1,2", valid_on: null,
    });
  });
  test("plusieurs heures : triées, la première sert de time_start", () => {
    expect(payloadFromForm({ ...summary, sendTimes: ["18:00", "07:45"] }, names))
      .toMatchObject({ send_times: ["07:45", "18:00"], time_start: "07:45", time_end: "07:45" });
  });
  test("heure proposée à l'ajout : +1 h, sans doublon", () => {
    expect(nextSendTime(["07:45"])).toBe("08:45");
    expect(nextSendTime(["23:30"])).toBe("00:30");
    expect(nextSendTime(["07:00", "09:00", "08:00"])).toBe("10:00"); // 08:00 + 1 h = 09:00 déjà pris
  });
  test("résumé d'avant la v1.5 (sans send_times) : son heure unique", () => {
    const a = { ...payloadFromForm(summary, names), send_times: undefined };
    expect(formFromAlert(a).sendTimes).toEqual(["07:45"]);
    expect(describeAlert(a).detail).toBe("Résumé à 07:45 · vélos électriques");
  });
  test("aller-retour d'un résumé ; repassé en alerte : station unique", () => {
    const alert = payloadFromForm(summary, names);
    const form = formFromAlert(alert);
    expect(payloadFromForm(form, names)).toEqual(alert);
    expect(form.group).toBe(false);
    expect(payloadFromForm({ ...form, kind: "threshold" }, names)).toMatchObject({ kind: "threshold", station_id: "1", group_stations: null });
  });
  test("résumé de la carte", () => {
    const a = payloadFromForm(summary, names);
    expect(describeAlert(a)).toEqual({ title: "Gare", detail: "Résumé à 07:45 · vélos électriques" });
    expect(describeAlert({ ...a, bike_type: "any", group_name: "Maison" }))
      .toEqual({ title: "Maison", detail: "Résumé à 07:45 · vélos" });
    expect(describeAlert({ ...a, send_times: ["07:45", "18:00"] }).detail).toBe("Résumé à 07:45, 18:00 · vélos électriques");
  });
});

describe("groupe de stations", () => {
  const group = { ...defaultForm(), stationId: "1", group: true, groupIds: ["1", "2"], groupName: " Maison " };

  test("validation : 2 à 5 stations, nom ≤ 40 caractères", () => {
    expect(validateForm(group)).toBeNull();
    expect(validateForm({ ...group, groupIds: ["1"] })).toMatch(/de 2 à 5 stations/);
    expect(validateForm({ ...group, groupIds: ["1", "2", "3", "4", "5", "6"] })).toMatch(/de 2 à 5 stations/);
    expect(validateForm({ ...group, groupName: "x".repeat(41) })).toMatch(/40 caractères/);
  });
  test("payload : stations nommées, 1re station recopiée, nom nettoyé", () => {
    const p = payloadFromForm({ ...group, groupIds: ["2", "1"] }, names);
    expect(p).toMatchObject({
      station_id: "2", station_name: "Zoo", group_name: "Maison",
      group_stations: [{ station_id: "2", station_name: "Zoo" }, { station_id: "1", station_name: "Gare" }],
    });
    expect(payloadFromForm({ ...group, groupName: "  " }, names).group_name).toBeNull();
  });
  test("pas de trajet sur un groupe", () => {
    expect(tripAllowed(group)).toBe(false);
    expect(payloadFromForm({ ...group, trip: true, arrivalId: "2" }, names).arrival_station_id).toBeNull();
  });
  test("règle en toutes lettres", () => {
    expect(groupRuleText({ ...group, threshold: 1 })).toBe("Alerte seulement quand toutes les stations ont au plus 1 vélo.");
    expect(groupRuleText({ ...group, comparison: "at_least", bikeType: "ebike", threshold: 2 }))
      .toBe("Alerte dès qu'une des stations a au moins 2 vélos électriques.");
    expect(groupRuleText({ ...group, target: "docks", threshold: 3 }))
      .toBe("Alerte seulement quand toutes les stations ont au plus 3 places libres.");
  });
});

describe("describeAlert", () => {
  const a = { station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "ebike", threshold: 2, time_start: "08:00", time_end: "09:00" };
  test("vélos", () => expect(describeAlert(a)).toEqual({ title: "Gare", detail: "≤ 2 vélos électriques · 08:00–09:00" }));
  test("singulier", () => expect(describeAlert({ ...a, threshold: 1 }).detail).toMatch(/^≤ 1 vélo électrique ·/));
  test("places au moins", () => expect(describeAlert({ ...a, target: "docks", comparison: "at_least", threshold: 3 }).detail).toMatch(/^≥ 3 places ·/));
  test("trajet", () => {
    const d = describeAlert({ ...a, bike_type: "any", threshold: 1, arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 0 });
    expect(d).toEqual({ title: "Gare → Zoo", detail: "Départ ≤ 1 vélo · Arrivée ≤ 0 place · 08:00–09:00" });
  });
  test("groupe nommé / sans nom", () => {
    const g = { ...a, bike_type: "any", threshold: 1, group_name: "Maison",
      group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "2", station_name: "Zoo" }] };
    expect(describeAlert(g)).toEqual({ title: "Maison", detail: "Toutes ≤ 1 vélo · 08:00–09:00" });
    expect(describeAlert({ ...g, group_name: null, comparison: "at_least" }))
      .toEqual({ title: "Gare, Zoo", detail: "L'une ≥ 1 vélo · 08:00–09:00" });
  });
});

describe("liste : filtre et tri", () => {
  const mk = (id, station_name, time_start, extra = {}) => ({
    id, station_name, time_start, time_end: time_start, active: 1, kind: "threshold",
    target: "bikes", comparison: "at_most", bike_type: "any", threshold: 1, ...extra,
  });
  const list = [
    mk(1, "Zoo", "08:00"),
    mk(2, "Gare", "17:30"),
    mk(3, "Beffroi", "07:15", { kind: "summary", group_stations: [{ station_id: "3", station_name: "Beffroi" }] }),
    mk(4, "Cirque", "06:00", { active: 0 }),
  ];
  const ids = (opts) => visibleAlerts(list, opts).map((a) => a.id);

  test("par heure (défaut), désactivées en dernier", () => expect(ids()).toEqual([3, 1, 2, 4]));
  test("par nom affiché", () => expect(ids({ sort: "name" })).toEqual([3, 2, 1, 4]));
  test("plus récentes", () => expect(ids({ sort: "recent" })).toEqual([3, 2, 1, 4]));
  test("filtre par type", () => {
    expect(ids({ filter: "summary" })).toEqual([3]);
    expect(ids({ filter: "threshold" })).toEqual([1, 2, 4]);
  });
  test("ne modifie pas la liste d'origine", () => {
    visibleAlerts(list, { sort: "name" });
    expect(list.map((a) => a.id)).toEqual([1, 2, 3, 4]);
  });
  test("deux types présents ?", () => {
    expect(hasBothKinds(list)).toBe(true);
    expect(hasBothKinds(list.filter((a) => a.kind !== "summary"))).toBe(false);
  });
  test("préférences mémorisées, valeurs inconnues ignorées", () => {
    expect(loadListPrefs()).toEqual({ filter: "all", sort: "time" });
    saveListPrefs({ filter: "summary", sort: "name" });
    expect(loadListPrefs()).toEqual({ filter: "summary", sort: "name" });
    localStorage.setItem("velopulse-alerts-list", JSON.stringify({ filter: "x", sort: "y" }));
    expect(loadListPrefs()).toEqual({ filter: "all", sort: "time" });
    localStorage.setItem("velopulse-alerts-list", "{");
    expect(loadListPrefs()).toEqual({ filter: "all", sort: "time" });
  });
});

describe("dates", () => {
  test("localYmd / addDaysYmd / fmtDay", () => {
    expect(localYmd(new Date(2025, 0, 5))).toBe("2025-01-05");
    expect(addDaysYmd("2025-12-31", 1)).toBe("2026-01-01");
    expect(fmtDay("2025-09-30")).toBe("30/09");
  });
});
