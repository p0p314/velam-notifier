import { describe, test, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStations, useFavorites, useOnline, distanceKm, fmtDistance } from "../hooks";
import { saveCache, loadCache } from "../lib/offlineCache";
import { setToken } from "../api";
import { jsonResponse, setOnline } from "./setup";

const STATIONS = [{ station_id: "1", name: "Gare", electrical: 2, mechanical: 1 }];

describe("useOnline", () => {
  test("suit les événements online / offline", () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => setOnline(false));
    expect(result.current).toBe(false);
    act(() => setOnline(true));
    expect(result.current).toBe(true);
  });
});

describe("useStations", () => {
  test("succès : données fraîches, datées par l'âge fourni par le serveur", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations: STATIONS, stale: false, upstream_ok: true, data_age_s: 30 }));
    const before = Date.now();
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stations).toEqual(STATIONS);
    expect(result.current.stale).toBe(false);
    expect(result.current.staleReason).toBeNull();
    const age = before - result.current.lastUpd.getTime();
    expect(age).toBeGreaterThanOrEqual(29_000);
    expect(age).toBeLessThan(32_000);
    expect(loadCache("stations").data).toEqual(STATIONS);
  });

  test("flux Vélam en panne ou figé (verdict serveur) → stale « upstream »", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations: STATIONS, stale: true, upstream_ok: false, data_age_s: 420 }));
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.staleReason).toBe("upstream");
    expect(result.current.error).toBeNull();
    expect(result.current.stations).toEqual(STATIONS); // dernières données connues affichées
  });

  test("retour au premier plan → rafraîchissement immédiat", async () => {
    // Une Response neuve par appel (un corps ne se lit qu'une fois).
    fetch.mockImplementation(async () => jsonResponse({ ok: true, stations: STATIONS, stale: false, data_age_s: 0 }));
    renderHook(() => useStations());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    delete document.visibilityState; // rétablit la propriété d'origine de jsdom
  });

  test("réponse 200 sans liste de stations → échec géré, liste conservée", async () => {
    saveCache("stations", STATIONS, 1000);
    fetch.mockImplementation(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.staleReason).toBe("server");
    expect(result.current.stations).toEqual(STATIONS);
  });

  test("hors ligne avec cache : liste affichée, marquée périmée, heure du cache", async () => {
    setOnline(false, { emit: false });
    saveCache("stations", STATIONS, Date.parse("2025-09-24T08:00:00Z"));
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useStations());
    // Affichage immédiat depuis le cache, sans écran de chargement
    expect(result.current.loading).toBe(false);
    expect(result.current.stations).toEqual(STATIONS);
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.staleReason).toBe("server");
    expect(result.current.error).toBeNull(); // pas d'écran d'erreur : il y a des données
    expect(result.current.lastUpd.toISOString()).toBe("2025-09-24T08:00:00.000Z");
  });

  test("hors ligne sans cache : erreur", async () => {
    setOnline(false, { emit: false });
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/injoignable/);
    expect(result.current.stations).toEqual([]);
  });

  test("retour du réseau → rechargement automatique", async () => {
    setOnline(false, { emit: false });
    saveCache("stations", STATIONS, 1000);
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.stale).toBe(true));

    const fresh = [{ ...STATIONS[0], electrical: 9 }];
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations: fresh, stale: false, data_age_s: 0 }));
    act(() => setOnline(true));
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.stations[0].electrical).toBe(9);
  });

  test("échec après un succès : garde les données en mémoire", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, stations: STATIONS, stale: false, data_age_s: 0 }));
    const { result } = renderHook(() => useStations());
    await waitFor(() => expect(result.current.stations).toEqual(STATIONS));
    setOnline(false, { emit: false });
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(() => vi.advanceTimersByTimeAsync(61_000)); // poll 60 s
    expect(result.current.stale).toBe(true);
    expect(result.current.stations).toEqual(STATIONS);
  });
});

describe("useFavorites", () => {
  const FAVS = [{ station_id: "1", station_name: "Gare" }];

  test("charge, met en cache, toggle", async () => {
    setToken("t");
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, favorites: FAVS }));
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.favorites).toEqual(FAVS));
    expect(result.current.favIds.has("1")).toBe(true);
    expect(loadCache("favorites").data).toEqual(FAVS);

    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, favorites: [] }));
    await act(() => result.current.toggleFav({ station_id: "1", name: "Gare" }));
    expect(fetch.mock.calls.at(-1)[1].method).toBe("DELETE");
    expect(result.current.favorites).toEqual([]);
  });

  test("ajout d'un favori → POST", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, favorites: [] }));
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, favorites: FAVS }));
    await act(() => result.current.toggleFav({ station_id: "1", name: "Gare" }));
    const [, init] = fetch.mock.calls.at(-1);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ station_id: "1", station_name: "Gare" });
  });

  test("erreur passagère : la liste n'est PAS vidée (régression)", async () => {
    saveCache("favorites", FAVS);
    setOnline(false, { emit: false });
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.favorites).toEqual(FAVS);
  });
});

describe("distances", () => {
  test("distanceKm Amiens gare → cathédrale ≈ 0,9 km", () => {
    const d = distanceKm({ lat: 49.8906, lon: 2.3078 }, { lat: 49.8947, lon: 2.3022 });
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1);
  });
  test("coordonnées manquantes → Infinity", () => {
    expect(distanceKm(null, { lat: 1, lon: 1 })).toBe(Infinity);
  });
  test("fmtDistance", () => {
    expect(fmtDistance(0.85)).toBe("850 m");
    expect(fmtDistance(1.234)).toBe("1,2 km");
    expect(fmtDistance(Infinity)).toBeNull();
  });
});

describe("useFavorites — modifications concurrentes", () => {
  test("renommer puis déplacer vite : l'état final est celui de la dernière action", async () => {
    const A = { station_id: "1", station_name: "Gare", label: null };
    const B = { station_id: "2", station_name: "Zoo", label: null };
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, favorites: [A, B] }));
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(2));

    // Le PATCH répond lentement (ancien ordre), le PUT répond vite (nouvel ordre).
    let releasePatch;
    const order = [];
    fetch.mockImplementation((url, init) => {
      order.push(init.method);
      if (init.method === "PATCH") {
        return new Promise((r) => { releasePatch = () => r(jsonResponse({ ok: true, favorites: [{ ...A, label: "Maison" }, B] })); });
      }
      return Promise.resolve(jsonResponse({ ok: true, favorites: [B, { ...A, label: "Maison" }] }));
    });

    let p1, p2;
    act(() => {
      p1 = result.current.rename("1", "Maison");
      p2 = result.current.reorder(["2", "1"]);
    });
    // Ordre optimiste affiché immédiatement
    expect(result.current.favorites.map((f) => f.station_id)).toEqual(["2", "1"]);
    await waitFor(() => expect(releasePatch).toBeTypeOf("function"));
    expect(order).toEqual(["PATCH"]); // le PUT attend la fin du PATCH (file)
    await act(async () => { releasePatch(); await p1; await p2; });
    expect(order).toEqual(["PATCH", "PUT"]);
    expect(result.current.favorites.map((f) => [f.station_id, f.label])).toEqual([["2", null], ["1", "Maison"]]);
  });
});
