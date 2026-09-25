import { describe, test, expect } from "vitest";
import {
  defaultForm, formFromAlert, validateForm, payloadFromForm, describeAlert,
  tripAllowed, localYmd, addDaysYmd, fmtDay,
} from "../lib/alerts";

const names = { 1: "Gare", 2: "Zoo" };

describe("defaultForm", () => {
  test("formulaire vierge : vélos, au plus 1, tous les jours", () => {
    const f = defaultForm();
    expect(f).toMatchObject({ stationId: "", target: "bikes", comparison: "at_most", threshold: 1, trip: false, oneShot: false });
    expect(f.days).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("depuis une station : créneau qui démarre maintenant (quart d'heure) pour 1 h 30", () => {
    const f = defaultForm({ station_id: "1", name: "Gare" }, new Date(2025, 8, 24, 7, 52));
    expect(f.stationId).toBe("1");
    expect([f.timeStart, f.timeEnd]).toEqual(["07:45", "09:15"]);
  });

  test("tard le soir : fin bornée à 23:59", () => {
    const f = defaultForm({ station_id: "1" }, new Date(2025, 8, 24, 23, 10));
    expect([f.timeStart, f.timeEnd]).toEqual(["23:00", "23:59"]);
  });
});

describe("validateForm", () => {
  const ok = { ...defaultForm(), stationId: "1" };
  test("valide", () => expect(validateForm(ok)).toBeNull());
  test("station requise", () => expect(validateForm({ ...ok, stationId: "" })).toMatch(/station/));
  test("fin après début", () => expect(validateForm({ ...ok, timeEnd: "07:00" })).toMatch(/fin/));
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
  const base = { ...defaultForm(), stationId: "1", threshold: "2" };

  test("alerte vélos classique", () => {
    expect(payloadFromForm({ ...base, bikeType: "ebike", days: [1, 3] }, names, "2025-09-24")).toEqual({
      station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "ebike",
      threshold: 2, arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
      time_start: "08:00", time_end: "10:00", days: "1,3", valid_on: null,
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
      id: 3, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "mechanical",
      threshold: 1, arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 2,
      time_start: "07:30", time_end: "08:30", days: "1,2,3,4,5", valid_on: null,
    };
    const { id, ...rest } = alert;
    expect(payloadFromForm(formFromAlert(alert), names)).toEqual(rest);
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
});

describe("dates", () => {
  test("localYmd / addDaysYmd / fmtDay", () => {
    expect(localYmd(new Date(2025, 0, 5))).toBe("2025-01-05");
    expect(addDaysYmd("2025-12-31", 1)).toBe("2026-01-01");
    expect(fmtDay("2025-09-30")).toBe("30/09");
  });
});
