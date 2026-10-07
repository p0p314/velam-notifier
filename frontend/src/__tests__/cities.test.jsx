import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { setToken, setStoredUser, getStoredUser } from "../api";
import { CITIES, stationCity, userCity, cityById } from "../lib/cities";
import { stationsCacheKey } from "../hooks";
import { loadCache } from "../lib/offlineCache";
import { jsonResponse } from "./setup";

vi.mock("../push", () => ({
  syncPush: vi.fn(async () => true),
  unlinkPush: vi.fn(async () => {}),
  pushStatus: () => "on",
  currentPushEndpoint: vi.fn(async () => null),
  enablePush: vi.fn(async () => "granted"),
  disablePush: vi.fn(async () => {}),
}));

describe("lib/cities", () => {
  test("ville d'une station, ville de l'utilisateur, Amiens par défaut", () => {
    expect(stationCity("12")).toBe("amiens");
    expect(stationCity("lyon:12")).toBe("lyon");
    expect(userCity({ city: "nantes" })).toBe("nantes");
    expect(userCity({ city: "paris" })).toBe("amiens");
    expect(userCity(null)).toBe("amiens");
    expect(cityById("lyon").system).toBe("Vélo'v");
    expect(CITIES.every((c) => c.center && c.system && c.country)).toBe(true);
    expect(stationsCacheKey("amiens")).toBe("stations");
    expect(stationsCacheKey("lyon")).toBe("stations:lyon");
  });
});

const station = (id, name, bikes) => ({
  station_id: id, name, address: "", lat: 45.76, lon: 4.83, capacity: 20, mechanical: bikes, electrical: 0,
  total_bikes: bikes, docks_available: 5, is_renting: true, is_returning: true,
});

describe("application selon la ville du compte", () => {
  let calls;
  let city;
  beforeEach(() => {
    calls = [];
    city = "lyon";
    localStorage.setItem("velopulse-onboarding-done", "1");
    localStorage.setItem("velopulse-trajets-vue", "velos");
    fetch.mockImplementation(async (url, init = {}) => {
      const u = new URL(String(url), "http://localhost");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: u.pathname, query: u.search, body });
      const user = () => ({ id: 1, username: "alice", tutorial_done: true, modules: { bikes: true, trains: true }, city });
      if (u.pathname === "/api/auth/me") return jsonResponse({ ok: true, token: "t", user: user() });
      if (u.pathname === "/api/auth/city") { city = body.city; return jsonResponse({ ok: true, user: user() }); }
      if (u.pathname === "/api/stations") {
        const c = u.searchParams.get("city") ?? "amiens";
        const list = c === "lyon" ? [station("lyon:1", "Bellecour", 7)] : [station("1", "Gare du Nord", 3)];
        return jsonResponse({ ok: true, city: c, stations: list, stale: false, data_age_s: 0 });
      }
      if (u.pathname === "/api/favorites") {
        return jsonResponse({ ok: true, favorites: [
          { station_id: "lyon:1", station_name: "Bellecour", label: null, sort_order: null },
          { station_id: "1", station_name: "Gare du Nord", label: null, sort_order: null },
        ] });
      }
      if (u.pathname === "/api/alerts") {
        return jsonResponse({ ok: true, paused_until: null, alerts: [
          { id: 1, kind: "threshold", station_id: "lyon:1", station_name: "Bellecour", target: "bikes", bike_type: "any", comparison: "at_most", threshold: 1, time_start: "08:00", time_end: "09:00", days: "1,2,3,4,5", active: 1 },
          { id: 2, kind: "threshold", station_id: "1", station_name: "Gare du Nord", target: "bikes", bike_type: "any", comparison: "at_most", threshold: 1, time_start: "08:00", time_end: "09:00", days: "1,2,3,4,5", active: 1 },
        ] });
      }
      if (u.pathname === "/api/trains/favorites") return jsonResponse({ ok: true, favorites: [], line_alerts: [], realtime: null });
      if (u.pathname === "/api/trains/alerts") return jsonResponse({ ok: true, alerts: [] });
      if (u.pathname === "/api/notifications/preferences") return jsonResponse({ ok: true, preferences: { bikes: true, trains: true } });
      return jsonResponse({ ok: true });
    });
  });
  const start = (path) => {
    setToken("t");
    setStoredUser({ id: 1, username: "alice", tutorial_done: true, modules: { bikes: true, trains: true }, city });
    return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  };

  test("Mes trajets à Lyon : stations et favoris de Lyon seulement, jamais Amiens", async () => {
    start("/trajets");
    expect(await screen.findByRole("heading", { name: "Stations Vélo'v" })).toBeTruthy();
    expect(await screen.findByText("Bellecour")).toBeTruthy();
    expect(screen.queryByText("Gare du Nord")).toBeNull();
    const stationCalls = calls.filter((c) => c.path === "/api/stations");
    expect(stationCalls.length).toBeGreaterThan(0);
    expect(stationCalls.every((c) => c.query === "?city=lyon")).toBe(true);
    await waitFor(() => expect(loadCache("stations:lyon")?.data?.[0]?.station_id).toBe("lyon:1"));
    expect(loadCache("stations")).toBeNull(); // le cache d'Amiens n'est pas écrasé
  });

  test("Alertes : seulement celles de la ville choisie", async () => {
    start("/alertes");
    // Carte d'alerte + choix de station du formulaire : Lyon seulement.
    expect((await screen.findAllByText("Bellecour")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Gare du Nord")).toBeNull();
    expect(screen.queryAllByText("Gare du Nord", { selector: "option" })).toHaveLength(0);
  });

  test("Paramètres : changer de ville → Amiens, stations rechargées pour Amiens", async () => {
    start("/compte?onglet=preferences");
    const select = await screen.findByRole("combobox", { name: "Ville des vélos" });
    expect(select.value).toBe("lyon");
    expect(within(select).getByRole("option", { name: "Nantes — Naolib" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "amiens" } });
    await waitFor(() => expect(calls.find((c) => c.path === "/api/auth/city")?.body).toEqual({ city: "amiens" }));
    await waitFor(() => expect(getStoredUser().city).toBe("amiens"));
    expect(screen.getByText(/Service : Vélam/)).toBeTruthy();
  });

  test("vélos désactivés : pas de choix de ville", async () => {
    setToken("t");
    setStoredUser({ id: 1, username: "alice", tutorial_done: true, modules: { bikes: false, trains: true }, city });
    fetch.mockImplementation(async (url) => {
      const u = new URL(String(url), "http://localhost");
      if (u.pathname === "/api/auth/me") return jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice", tutorial_done: true, modules: { bikes: false, trains: true }, city } });
      return jsonResponse({ ok: true, preferences: { bikes: true, trains: true } });
    });
    render(<MemoryRouter initialEntries={["/compte?onglet=preferences"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("switch", { name: "Trains" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Ville des vélos" })).toBeNull();
  });
});
