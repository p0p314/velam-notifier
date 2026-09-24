import { describe, test, expect, vi } from "vitest";
import { saveCache, loadCache, removeCache, fmtUpdatedAt } from "../lib/offlineCache";

describe("offlineCache", () => {
  test("aller-retour avec horodatage", () => {
    saveCache("stations", [{ station_id: "1" }], 1234);
    expect(loadCache("stations")).toEqual({ at: 1234, data: [{ station_id: "1" }] });
  });

  test("absent, corrompu ou mal formé → null", () => {
    expect(loadCache("inconnu")).toBeNull();
    localStorage.setItem("velopulse_cache:x", "{pas du json");
    expect(loadCache("x")).toBeNull();
    localStorage.setItem("velopulse_cache:y", JSON.stringify({ data: [] })); // sans `at`
    expect(loadCache("y")).toBeNull();
  });

  test("removeCache", () => {
    saveCache("favorites", []);
    removeCache("favorites");
    expect(loadCache("favorites")).toBeNull();
  });

  test("stockage plein : aucune exception", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(() => saveCache("stations", [])).not.toThrow();
  });
});

describe("fmtUpdatedAt", () => {
  const now = new Date(2025, 8, 24, 18, 0);
  test("aujourd'hui → heure seule", () => {
    expect(fmtUpdatedAt(new Date(2025, 8, 24, 14, 32), now)).toBe("14:32");
  });
  test("autre jour → date + heure", () => {
    expect(fmtUpdatedAt(new Date(2025, 8, 23, 9, 5), now)).toBe("23/09 à 09:05");
  });
  test("valeur invalide → null", () => {
    expect(fmtUpdatedAt(null, now)).toBeNull();
    expect(fmtUpdatedAt(new Date("x"), now)).toBeNull();
  });
});
