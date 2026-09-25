import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Alerts from "../pages/Alerts";
import { jsonResponse, setMobileViewport } from "./setup";
import { localYmd } from "../lib/alerts";

const FAVS = [{ station_id: "1", station_name: "Gare" }, { station_id: "2", station_name: "Zoo" }];
let alerts, pausedUntil, calls;

/** Faux backend : routes minimales utilisées par la page Alertes. */
function mockApi() {
  fetch.mockImplementation(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === "/api/favorites") return jsonResponse({ ok: true, favorites: FAVS });
    if (path === "/api/alerts" && method === "GET") return jsonResponse({ ok: true, alerts, paused_until: pausedUntil });
    if (path === "/api/alerts" && method === "POST") {
      alerts = [{ id: 1, active: 1, ...body }];
      return jsonResponse({ ok: true, alert: alerts[0] }, 201);
    }
    if (path === "/api/alerts/pause") { pausedUntil = body.until; return jsonResponse({ ok: true, paused_until: body.until }); }
    if (path.startsWith("/api/alerts/") && method === "PATCH") return jsonResponse({ ok: true, alert: {} });
    if (path === "/api/push/test") return jsonResponse({ ok: true, sent: 2, total: 2 });
    return jsonResponse({ ok: false, error: `route non simulée ${method} ${path}` }, 404);
  });
}

const renderPage = (state) => render(
  <MemoryRouter initialEntries={[{ pathname: "/alertes", state }]}>
    <Routes><Route path="/alertes" element={<Alerts />} /></Routes>
  </MemoryRouter>
);
const lastPost = () => calls.filter((c) => c.method === "POST" && c.path === "/api/alerts").at(-1)?.body;
const form = () => screen.getByRole("form", { name: "Formulaire d'alerte" });

beforeEach(() => {
  alerts = [];
  pausedUntil = null;
  calls = [];
  window.PushManager = function PushManager() {};
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}) } });
  window.Notification = { permission: "granted", requestPermission: vi.fn() };
  mockApi();
});

async function ready() {
  renderPage();
  await screen.findByRole("option", { name: "Zoo" });
}

describe("création d'alertes", () => {
  test("alerte places libres : pas de type de vélo, payload correct", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Places libres" }));
    expect(f.queryByRole("group", { name: "Type de vélo" })).toBeNull();
    fireEvent.change(f.getByLabelText("Seuil"), { target: { value: "2" } });
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({ station_id: "1", target: "docks", comparison: "at_most", threshold: 2, bike_type: "any" });
  });

  test("« il y en a de nouveau » : libellé « Au moins »", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Il y en a de nouveau" }));
    expect(f.getByText("Au moins")).toBeTruthy();
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()?.comparison).toBe("at_least"));
  });

  test("trajet : station d'arrivée parmi les autres favoris", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByLabelText(/Trajet/));
    const arrival = f.getByLabelText("Station d'arrivée");
    expect(within(arrival).queryByRole("option", { name: "Gare" })).toBeNull(); // départ exclu
    fireEvent.change(arrival, { target: { value: "2" } });
    fireEvent.change(f.getByLabelText("Seuil d'arrivée"), { target: { value: "0" } });
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({ arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 0 });
  });

  test("trajet masqué pour les places libres", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Places libres" }));
    expect(f.queryByLabelText(/Trajet/)).toBeNull();
  });

  test("trajet sans arrivée → erreur, aucun envoi", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByLabelText(/Trajet/));
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    expect((await f.findByRole("alert")).textContent).toMatch(/arrivée/);
    expect(lastPost()).toBeUndefined();
  });

  test("aujourd'hui seulement : jours masqués, date du jour envoyée", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByLabelText(/Aujourd'hui seulement/));
    expect(f.queryByText("Jours")).toBeNull();
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()?.valid_on).toBe(localYmd()));
  });
});

describe("liste", () => {
  test("résumés : trajet, ponctuelle", async () => {
    alerts = [
      { id: 1, active: 1, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most", bike_type: "any",
        threshold: 1, arrival_station_id: "2", arrival_station_name: "Zoo", arrival_threshold: 0,
        time_start: "08:00", time_end: "09:00", days: "1,2,3,4,5", valid_on: null },
      { id: 2, active: 1, station_id: "2", station_name: "Zoo", target: "docks", comparison: "at_least", bike_type: "any",
        threshold: 3, time_start: "17:00", time_end: "18:00", days: "1,2,3,4,5,6,7", valid_on: "2025-09-30" },
    ];
    renderPage();
    expect(await screen.findByText("Gare → Zoo")).toBeTruthy();
    expect(screen.getByText("Départ ≤ 1 vélo · Arrivée ≤ 0 place · 08:00–09:00")).toBeTruthy();
    expect(screen.getByText("≥ 3 places · 17:00–18:00")).toBeTruthy();
    expect(screen.getByText(/Uniquement le 30\/09/)).toBeTruthy();
  });

  test("modifier : PATCH avec les valeurs du formulaire", async () => {
    alerts = [{ id: 7, active: 1, station_id: "2", station_name: "Zoo", target: "docks", comparison: "at_most", bike_type: "any",
      threshold: 2, time_start: "17:00", time_end: "18:00", days: "1,2", valid_on: null }];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const f = within(form());
    expect(f.getByLabelText("Seuil").value).toBe("2");
    fireEvent.change(f.getByLabelText("Seuil"), { target: { value: "4" } });
    fireEvent.click(f.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.path).toBe("/api/alerts/7");
    expect(patch.body).toMatchObject({ station_id: "2", target: "docks", threshold: 4, days: "1,2" });
  });
});

describe("pause globale", () => {
  const one = [{ id: 1, active: 1, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most",
    bike_type: "any", threshold: 1, time_start: "08:00", time_end: "09:00", days: "1,2,3,4,5,6,7" }];

  test("suspendre puis reprendre", async () => {
    alerts = one;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Mettre toutes les alertes en pause/ }));
    fireEvent.change(screen.getByLabelText("Suspendre jusqu'au"), { target: { value: "2099-01-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspendre" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/pause jusqu'au 15\/01 inclus/);
    expect(calls.find((c) => c.path === "/api/alerts/pause").body).toEqual({ until: "2099-01-15" });

    fireEvent.click(screen.getByRole("button", { name: "Reprendre" }));
    await screen.findByRole("button", { name: /Mettre toutes les alertes en pause/ });
    expect(calls.filter((c) => c.path === "/api/alerts/pause").at(-1).body).toEqual({ until: null });
  });

  test("pause active affichée au chargement, cartes grisées", async () => {
    alerts = one;
    pausedUntil = "2099-02-01";
    const { container } = renderPage();
    expect((await screen.findByRole("status")).textContent).toMatch(/01\/02/);
    expect(container.querySelector(".alert-card.off")).toBeTruthy();
  });
});

describe("notification de test", () => {
  test("bouton Tester quand les notifications sont accordées", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tester" }));
    expect(await screen.findByText("Notification envoyée à 2 appareils.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/push/test")).toBe(true);
  });

  test("erreur serveur affichée", async () => {
    await ready();
    fetch.mockImplementationOnce(async () => jsonResponse({ ok: false, error: "Aucun appareil enregistré" }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Tester" }));
    expect(await screen.findByText("Aucun appareil enregistré")).toBeTruthy();
  });
});

describe("création depuis une station (fiche)", () => {
  test("formulaire pré-rempli, même pour une station hors favoris", async () => {
    renderPage({ alertStation: { station_id: "9", name: "Cirque" } });
    await screen.findByRole("option", { name: "Zoo" });
    const f = within(form());
    expect(f.getByLabelText("Station").value).toBe("9");
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()).toMatchObject({ station_id: "9", station_name: "Cirque" }));
  });

  test("mobile : le formulaire s'ouvre directement", async () => {
    setMobileViewport(true);
    renderPage({ alertStation: { station_id: "1", name: "Gare" } });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
