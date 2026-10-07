import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { setToken, setStoredUser, getStoredUser } from "../api";
import { modulesOf, canDisable } from "../lib/modules";
import { landingPath, landingsFor } from "../lib/prefs";
import { tutorialSlides } from "../lib/tutorial";
import { jsonResponse } from "./setup";

vi.mock("../push", () => ({
  syncPush: vi.fn(async () => true),
  unlinkPush: vi.fn(async () => {}),
  pushStatus: () => "on",
  currentPushEndpoint: vi.fn(async () => null),
  enablePush: vi.fn(async () => "granted"),
  disablePush: vi.fn(async () => {}),
}));

describe("lib : fonctionnalités", () => {
  test("modulesOf : les deux par défaut, jamais aucune", () => {
    expect(modulesOf(null)).toEqual({ bikes: true, trains: true });
    expect(modulesOf({ modules: { bikes: false, trains: true } })).toEqual({ bikes: false, trains: true });
    expect(modulesOf({ modules: { bikes: false, trains: false } })).toEqual({ bikes: true, trains: true });
    expect(canDisable({ bikes: true, trains: true }, "bikes")).toBe(true);
    expect(canDisable({ bikes: true, trains: false }, "bikes")).toBe(false);
    expect(canDisable({ bikes: true, trains: false }, "trains")).toBe(true); // déjà coupée : réactivable
  });

  test("page d'ouverture : une page désactivée → Mes trajets ; options filtrées", () => {
    const noBikes = { bikes: false, trains: true };
    const noTrains = { bikes: true, trains: false };
    expect(landingPath("auto", false, noBikes)).toBe("/trajets");
    expect(landingPath("velos", true, noBikes)).toBe("/trajets");
    expect(landingPath("trains", true, noTrains)).toBe("/trajets");
    expect(landingPath("auto", false, noTrains)).toBe("/velos");
    expect(landingsFor(noBikes).map((o) => o.value)).toEqual(["auto", "trajets", "trains"]);
    expect(landingsFor(noTrains).map((o) => o.value)).toEqual(["auto", "trajets", "velos"]);
  });

  test("tutoriel : sans la diapositive d'une fonctionnalité désactivée", () => {
    expect(tutorialSlides({ bikes: true, trains: false }).map((s) => s.title)).not.toContain("Trains");
    expect(tutorialSlides({ bikes: false, trains: true }).map((s) => s.title)).not.toContain("Vélos");
    expect(tutorialSlides().length).toBeGreaterThan(tutorialSlides({ bikes: false, trains: true }).length);
  });
});

describe("application selon les fonctionnalités du compte", () => {
  let calls;
  let modules;
  let failModules;
  beforeEach(() => {
    calls = [];
    modules = { bikes: true, trains: true };
    failModules = false;
    localStorage.setItem("velopulse-onboarding-done", "1");
    fetch.mockImplementation(async (url, init = {}) => {
      const u = new URL(String(url), "http://localhost");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: u.pathname, body });
      const user = () => ({ id: 1, username: "alice", tutorial_done: true, modules });
      if (u.pathname === "/api/auth/me") return jsonResponse({ ok: true, token: "t", user: user() });
      if (u.pathname === "/api/auth/modules") {
        if (failModules) return jsonResponse({ ok: false, error: "Serveur indisponible" }, 500);
        modules = { ...modules, ...body };
        return jsonResponse({ ok: true, user: user() });
      }
      if (u.pathname === "/api/trains/favorites") return jsonResponse({ ok: true, favorites: [], line_alerts: [], realtime: null });
      if (u.pathname === "/api/trains/alerts") return jsonResponse({ ok: true, alerts: [] });
      if (u.pathname === "/api/stations") return jsonResponse({ ok: true, stations: [], stale: false, data_age_s: 0 });
      if (u.pathname === "/api/favorites") return jsonResponse({ ok: true, favorites: [] });
      if (u.pathname === "/api/alerts") return jsonResponse({ ok: true, alerts: [], paused_until: null });
      if (u.pathname === "/api/notifications/preferences") return jsonResponse({ ok: true, preferences: { bikes: true, trains: true } });
      return jsonResponse({ ok: true });
    });
  });
  const start = (path, m) => {
    modules = m;
    setToken("t");
    setStoredUser({ id: 1, username: "alice", tutorial_done: true, modules: m });
    return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  };
  const tabs = () => within(document.querySelector(".bottom-nav")).getAllByRole("link").map((a) => a.textContent);

  test("trains seuls : pas d'onglet Vélos, Mes trajets sans bascule ni données Vélam", async () => {
    start("/trajets", { bikes: false, trains: true });
    expect(await screen.findByText(/Aucun train suivi/)).toBeTruthy();
    expect(tabs()).toEqual(["Mes trajets", "Trains", "Alertes"]);
    expect(screen.queryByRole("button", { name: "Vélos" })).toBeNull();
    expect(calls.some((c) => c.path === "/api/stations" || c.path === "/api/favorites")).toBe(false);
  });

  test("vélos seuls : pas d'onglet Trains, Mes trajets sans bascule ni appel trains", async () => {
    start("/trajets", { bikes: true, trains: false });
    expect(await screen.findByRole("heading", { name: "Stations Vélam" })).toBeTruthy();
    expect(tabs()).toEqual(["Mes trajets", "Vélos", "Alertes"]);
    expect(screen.queryByRole("button", { name: "Trains" })).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/api/trains"))).toBe(false);
  });

  test("adresse d'une fonctionnalité désactivée (lien, raccourci, notification) → Mes trajets", async () => {
    start("/trains/trajet?id=x", { bikes: true, trains: false });
    expect(await screen.findByRole("heading", { name: "Mes trajets" })).toBeTruthy();
  });

  test("Alertes : une seule catégorie, sans bascule", async () => {
    start("/alertes", { bikes: false, trains: true });
    expect(await screen.findByRole("button", { name: "Suivre une ligne" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Type d'alertes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Créer une alerte" })).toBeNull(); // bouton « + » des vélos
  });

  test("Paramètres : couper les trains, impossible de couper aussi les vélos ; réglages adaptés", async () => {
    start("/compte?onglet=preferences", { bikes: true, trains: true });
    const trains = await screen.findByRole("switch", { name: "Trains" });
    fireEvent.click(trains);
    await waitFor(() => expect(calls.find((c) => c.path === "/api/auth/modules")?.body).toEqual({ trains: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Vélos" }).disabled).toBe(true));
    expect(screen.getByText(/Au moins une fonctionnalité reste active/)).toBeTruthy();
    expect(getStoredUser().modules).toEqual({ bikes: true, trains: false });
    // Onglet et page d'ouverture « Trains » disparus.
    expect(tabs()).toEqual(["Mes trajets", "Vélos", "Alertes"]);
    expect(within(screen.getByRole("group", { name: "Page d'ouverture" })).queryByRole("button", { name: "Trains" })).toBeNull();
    // Notifications : plus d'interrupteur « Alertes trains ».
    fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(await screen.findByRole("switch", { name: "Alertes vélos" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Alertes trains" })).toBeNull();
  });

  test("Paramètres : vélos coupés → pas de type de vélo par défaut", async () => {
    start("/compte?onglet=preferences", { bikes: false, trains: true });
    expect(await screen.findByRole("switch", { name: "Trains" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Trains" }).disabled).toBe(true);
    expect(screen.queryByRole("group", { name: "Type de vélo par défaut" })).toBeNull();
  });

  test("échec du serveur : réglage rétabli et message", async () => {
    failModules = true;
    start("/compte?onglet=preferences", { bikes: true, trains: true });
    fireEvent.click(await screen.findByRole("switch", { name: "Trains" }));
    expect(await screen.findByText("Serveur indisponible")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Trains" }).getAttribute("aria-checked")).toBe("true");
    expect(getStoredUser().modules).toEqual({ bikes: true, trains: true });
  });
});
