import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Trains from "../pages/Trains";
import TrainJourney from "../pages/TrainJourney";
import { jsonResponse } from "./setup";

const LILLE = { id: "StopArea:OCE87286005", name: "Lille Flandres" };
const AMIENS = { id: "StopArea:OCE87313874", name: "Amiens" };
const journey = (n, dep, over = {}) => ({
  id: `trip${n}|2026-10-07|${LILLE.id}|${AMIENS.id}`, tripId: `trip${n}`, serviceDate: "2026-10-07",
  line: { id: "L44", name: "K44", longName: "Lille Flandres - Amiens", color: "BF005F", textColor: "FFFFFF" },
  lineId: "L44", lineName: "K44", trainNumber: String(n), brand: "TER", mode: "train", terminus: "Amiens",
  departureStation: LILLE, arrivalStation: AMIENS,
  scheduledDeparture: dep, estimatedDeparture: null, scheduledArrival: dep.replace("T14", "T16").replace("T15", "T17"),
  estimatedArrival: null, departureDelay: null, arrivalDelay: null, status: "scheduled", phase: "upcoming",
  cancellation: null, realtime: false, alerts: [], disrupted: false, ...over,
});
const J1 = journey(843924, "2026-10-07T14:53:00.000Z", {
  estimatedDeparture: "2026-10-07T15:02:00.000Z", departureDelay: 9, estimatedArrival: "2026-10-07T16:19:00.000Z", arrivalDelay: 9,
  status: "delayed", realtime: true,
});
const J2 = journey(843926, "2026-10-07T15:53:00.000Z", { status: "cancelled", cancellation: { partial: false, reason: "Train supprimé" }, realtime: true });
const RT = { applicable: true, available: true, updated_at: new Date(Date.now() - 60_000).toISOString() };

let calls, favorites, alerts, realtime;
function mockApi() {
  fetch.mockImplementation(async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, query: u.search, body });
    if (u.pathname === "/api/trains/stations") return jsonResponse({ ok: true, stations: [LILLE, { id: "x", name: "Lille Europe" }] });
    if (u.pathname === "/api/trains/search") {
      return jsonResponse({ ok: true, date: "2026-10-07", count: 2, lines: null, coverage: { from: "2026-10-06", until: "2027-03-31" }, out_of_coverage: false, realtime, journeys: [J1, J2] });
    }
    if (u.pathname === "/api/trains/journey") {
      return jsonResponse({ ok: true, realtime, journey: { ...J1, stops: [
        { station: LILLE, scheduledArrival: J1.scheduledDeparture, scheduledDeparture: J1.scheduledDeparture, estimatedDeparture: J1.estimatedDeparture, estimatedArrival: null, delay: 9, skipped: false, inJourney: true },
        { station: AMIENS, scheduledArrival: J1.scheduledArrival, scheduledDeparture: J1.scheduledArrival, estimatedArrival: J1.estimatedArrival, estimatedDeparture: null, delay: 9, skipped: false, inJourney: true },
      ] } });
    }
    if (u.pathname === "/api/trains/favorites" && method === "GET") return jsonResponse({ ok: true, schedule_available: true, realtime, favorites, line_alerts: [] });
    if (u.pathname === "/api/trains/favorites" && method === "POST") {
      favorites = [{ id: 7, origin_id: LILLE.id, origin_name: LILLE.name, destination_id: AMIENS.id, destination_name: AMIENS.name, departure_time: "16:53", train_number: "843924", line_name: "K44", label: null, alert: null, next: [J1] }];
      return jsonResponse({ ok: true, favorite: favorites[0] }, 201);
    }
    if (u.pathname === "/api/trains/alerts" && method === "POST") {
      alerts.push(body);
      favorites = favorites.map((f) => ({ ...f, alert: { id: 3, scope: "trip", active: true, ...body } }));
      return jsonResponse({ ok: true, alert: {} }, 201);
    }
    return jsonResponse({ ok: false, error: `non simulé ${method} ${u.pathname}` }, 404);
  });
}

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/trains" element={<Trains />} />
      <Route path="/trains/trajet" element={<TrainJourney />} />
    </Routes>
  </MemoryRouter>
);
const SEARCH = `/trains?from=${encodeURIComponent(LILLE.id)}&fromName=Lille+Flandres&to=${encodeURIComponent(AMIENS.id)}&toName=Amiens&date=2026-10-07`;

beforeEach(() => {
  calls = []; favorites = []; alerts = []; realtime = RT;
  mockApi();
});

describe("page Trains", () => {
  test("autocomplétion des gares depuis le backend (pas de liste en dur)", async () => {
    renderAt("/trains");
    fireEvent.change(screen.getByRole("combobox", { name: "Gare de départ" }), { target: { value: "lill" } });
    const option = await screen.findByRole("option", { name: "Lille Flandres" }, { timeout: 2000 });
    expect(calls.some((c) => c.path === "/api/trains/stations" && c.query === "?q=lill")).toBe(true);
    fireEvent.click(option);
    expect(screen.getByRole("combobox", { name: "Gare de départ" }).value).toBe("Lille Flandres");
  });

  test("recherche sans critère : message, aucun appel", async () => {
    renderAt("/trains");
    fireEvent.click(screen.getByRole("button", { name: "Voir les trains" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Choisissez/);
    expect(calls.some((c) => c.path === "/api/trains/search")).toBe(false);
  });

  test("résultats : heure estimée seulement si modifiée, retard, suppression, fraîcheur", async () => {
    renderAt(SEARCH);
    await screen.findByText("Lille Flandres → Amiens", { selector: "h2" });
    expect(screen.getByText(/Temps réel — mis à jour il y a 1 min/)).toBeTruthy();
    const cards = screen.getAllByRole("link");
    expect(within(cards[0]).getByText("17:02")).toBeTruthy();
    expect(within(cards[0]).getAllByText("+9 min").length).toBe(2);
    expect(within(cards[0]).getByText("En retard")).toBeTruthy();
    expect(within(cards[1]).getByText("Supprimé")).toBeTruthy();
    expect(within(cards[1]).queryByText(/min/)).toBeNull();
  });

  test("bouton Actualiser : force la relecture du temps réel", async () => {
    renderAt(SEARCH);
    fireEvent.click(await screen.findByRole("button", { name: "Actualiser" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/trains/search" && c.query.includes("refresh=1"))).toBe(true));
  });

  test("temps réel indisponible : « horaires théoriques »", async () => {
    realtime = { applicable: true, available: false };
    renderAt(SEARCH);
    expect(await screen.findByText("Temps réel indisponible — horaires théoriques")).toBeTruthy();
  });

  test("filtre « Supprimés » (desktop)", async () => {
    renderAt(SEARCH);
    await screen.findByText("Lille Flandres → Amiens", { selector: "h2" });
    fireEvent.change(screen.getByRole("combobox", { name: "État" }), { target: { value: "cancelled" } });
    expect(screen.getAllByRole("link").length).toBe(1);
    expect(screen.getByText("Train supprimé")).toBeTruthy();
  });
});

describe("détail d'un train", () => {
  test("prévu / estimé / retard, puis favori et alerte", async () => {
    renderAt(`/trains/trajet?id=${encodeURIComponent(J1.id)}`);
    await screen.findByText("Statut");
    expect(screen.getAllByText("Prévu").length).toBe(2);
    expect(screen.getAllByText("Estimé").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter aux favoris" }));
    await screen.findByRole("button", { name: "Retirer des favoris" });
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/trains/favorites").body).toEqual({ journey_id: J1.id });

    fireEvent.click(screen.getByRole("button", { name: "Créer une alerte" }));
    fireEvent.click(await screen.findByRole("button", { name: "+15 min" }));
    fireEvent.click(screen.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(alerts).toEqual([{ scope: "trip", favorite_id: 7, delay_threshold: 15, on_cancel: true, on_disruption: true, days: "1,2,3,4,5,6,7" }]));
    expect(await screen.findByRole("button", { name: "Modifier l'alerte" })).toBeTruthy();
  });
});

describe("Mes trains", () => {
  test("favoris avec leur état actuel et l'alerte configurée", async () => {
    favorites = [{ id: 7, origin_id: LILLE.id, origin_name: LILLE.name, destination_id: AMIENS.id, destination_name: AMIENS.name, departure_time: "16:53", train_number: "843924", line_name: "K44", label: null,
      alert: { id: 3, scope: "trip", active: true, delay_threshold: 10, on_cancel: true, on_disruption: false, days: "1,2,3,4,5" }, next: [J1, J2] }];
    renderAt("/trains?onglet=mes-trains");
    expect(await screen.findByText("16:53 Lille Flandres → Amiens")).toBeTruthy();
    expect(screen.getByText("En retard")).toBeTruthy();
    expect(screen.getByText("Retard ≥ 10 min · suppression — lun.–ven.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Prochaines circulations" })).toBeTruthy();
  });

  test("aucun trajet suivi : invitation à rechercher", async () => {
    renderAt("/trains?onglet=mes-trains");
    expect(await screen.findByText("Aucun trajet suivi")).toBeTruthy();
  });
});
