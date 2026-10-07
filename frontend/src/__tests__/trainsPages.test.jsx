import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Trains from "../pages/Trains";
import TrainJourney from "../pages/TrainJourney";
import MyTrips from "../pages/MyTrips";
import Alerts from "../pages/Alerts";
import { jsonResponse } from "./setup";

const LILLE = { id: "StopArea:OCE87286005", name: "Lille Flandres", lat: 50.6366, lon: 3.0699 };
const AMIENS = { id: "StopArea:OCE87313874", name: "Amiens", lat: 49.8906, lon: 2.3083 };
// Stations Vélam : une à 150 m de la gare d'Amiens, une loin.
const VELAM = [
  { station_id: "1", name: "Gare du Nord", lat: 49.8915, lon: 2.3095, total_bikes: 4, docks_available: 6, is_renting: true, is_returning: true, electrical: 1, mechanical: 3, capacity: 10 },
  { station_id: "2", name: "Citadelle", lat: 49.9050, lon: 2.2950, total_bikes: 9, docks_available: 1, is_renting: true, is_returning: true, electrical: 2, mechanical: 7, capacity: 10 },
];
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
  status: "delayed", realtime: true, departurePlatform: "4", arrivalPlatform: null,
});
const J2 = journey(843926, "2026-10-07T15:53:00.000Z", { status: "cancelled", cancellation: { partial: false, reason: "Train supprimé" }, realtime: true });
const RT = { applicable: true, available: true, updated_at: new Date(Date.now() - 60_000).toISOString() };

let calls, favorites, alerts, realtime, trainAlerts, stationFavorites;
function mockApi() {
  fetch.mockImplementation(async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, query: u.search, body });
    if (u.pathname === "/api/trains/stations") return jsonResponse({ ok: true, stations: [LILLE, { id: "x", name: "Lille Europe" }] });
    if (u.pathname === "/api/trains/search" && u.searchParams.get("line")) {
      // Recherche par ligne : les deux sens.
      const back = journey(843925, "2026-10-07T05:00:00.000Z", { departureStation: AMIENS, arrivalStation: LILLE, terminus: "Lille Flandres", directionId: 0 });
      return jsonResponse({ ok: true, date: "2026-10-07", count: 3, lines: [J1.line], coverage: { from: "2026-10-06", until: "2027-03-31" }, out_of_coverage: false, realtime,
        directions: [{ id: 0, label: "Lille Flandres" }, { id: 1, label: "Amiens" }],
        journeys: [back, { ...J1, directionId: 1 }, { ...J2, directionId: 1 }] });
    }
    if (u.pathname === "/api/trains/search") {
      return jsonResponse({ ok: true, date: "2026-10-07", count: 2, lines: null, coverage: { from: "2026-10-06", until: "2027-03-31" }, out_of_coverage: false, realtime, journeys: [J1, J2] });
    }
    if (u.pathname === "/api/trains/journey") {
      return jsonResponse({ ok: true, realtime, journey: { ...J1, stops: [
        { station: LILLE, scheduledArrival: J1.scheduledDeparture, scheduledDeparture: J1.scheduledDeparture, estimatedDeparture: J1.estimatedDeparture, estimatedArrival: null, delay: 9, skipped: false, inJourney: true, platform: "4" },
        { station: AMIENS, scheduledArrival: J1.scheduledArrival, scheduledDeparture: J1.scheduledArrival, estimatedArrival: J1.estimatedArrival, estimatedDeparture: null, delay: 9, skipped: false, inJourney: true },
      ] } });
    }
    if (u.pathname === "/api/trains/favorites" && method === "GET") return jsonResponse({ ok: true, schedule_available: true, realtime, favorites, line_alerts: [] });
    if (u.pathname === "/api/trains/favorites" && method === "POST") {
      favorites = [{ id: 7, origin_id: LILLE.id, origin_name: LILLE.name, destination_id: AMIENS.id, destination_name: AMIENS.name, departure_time: "16:53", train_number: "843924", line_name: "K44", label: null, alert: null, next: [J1] }];
      return jsonResponse({ ok: true, favorite: favorites[0] }, 201);
    }
    if (u.pathname === "/api/stations") return jsonResponse({ ok: true, stations: VELAM, stale: false, data_age_s: 0 });
    if (u.pathname === "/api/favorites") return jsonResponse({ ok: true, favorites: stationFavorites });
    if (u.pathname === "/api/alerts" && method === "GET") return jsonResponse({ ok: true, alerts: [], paused_until: null });
    if (u.pathname === "/api/trains/alerts" && method === "GET") return jsonResponse({ ok: true, alerts: trainAlerts });
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
      <Route path="/trajets" element={<MyTrips />} />
      <Route path="/alertes" element={<Alerts />} />
    </Routes>
  </MemoryRouter>
);
const SEARCH = `/trains?from=${encodeURIComponent(LILLE.id)}&fromName=Lille+Flandres&to=${encodeURIComponent(AMIENS.id)}&toName=Amiens&date=2026-10-07`;

beforeEach(() => {
  calls = []; favorites = []; alerts = []; realtime = RT; trainAlerts = []; stationFavorites = [];
  window.PushManager = function PushManager() {};
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}) } });
  window.Notification = { permission: "granted", requestPermission: vi.fn() };
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
    const cards = screen.getAllByRole("article");
    expect(within(cards[0]).getByText("17:02")).toBeTruthy();
    expect(within(cards[0]).getAllByText("+9 min").length).toBe(2);
    expect(within(cards[0]).getByText("En retard")).toBeTruthy();
    expect(within(cards[1]).getByText("Supprimé")).toBeTruthy();
    // Voie connue (flux SIRI) : affichée au départ ; inconnue : rien.
    expect(within(cards[0]).getByText("Voie 4")).toBeTruthy();
    expect(within(cards[1]).queryByText(/Voie/)).toBeNull();
    expect(within(cards[1]).queryByText(/min/)).toBeNull();
    // Chaque carte : un lien vers le détail (toute la carte) et un lien « Carte ».
    expect(within(cards[0]).getByRole("link", { name: /^Lille Flandres Amiens/ }).getAttribute("href")).toMatch(/^\/trains\/trajet\?id=/);
    expect(within(cards[0]).getByRole("link", { name: /Voir sur la carte/ }).getAttribute("href")).toMatch(/^\/trains\/carte\?id=trip843924/);
  });

  test("tirer vers le bas force la relecture du temps réel ; plus de bouton Actualiser", async () => {
    renderAt(SEARCH);
    expect(await screen.findByText(/Temps réel — mis à jour il y a 1 min/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actualiser" })).toBeNull();
    const target = screen.getByText(/Temps réel — mis à jour/);
    fireEvent.touchStart(target, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(target);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/trains/search" && c.query.includes("refresh=1"))).toBe(true));
  });

  test("recherche par ligne : choix de la direction", async () => {
    renderAt("/trains?line=L44&lineName=K44&date=2026-10-07");
    await screen.findByText(/3 trains/);
    const dir = screen.getByRole("group", { name: "Direction" });
    fireEvent.click(within(dir).getByRole("button", { name: "Vers Lille Flandres" }));
    expect(screen.getByText(/1 train\b/)).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(within(dir).getByRole("button", { name: "Vers Amiens" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(within(dir).getByRole("button", { name: "Les deux sens" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  test("recherche d'un trajet (un seul sens) : pas de choix de direction", async () => {
    renderAt(SEARCH);
    await screen.findByText(/2 trains/);
    expect(screen.queryByRole("group", { name: "Direction" })).toBeNull();
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
    expect(screen.getAllByRole("article").length).toBe(1);
    expect(screen.getByText("Train supprimé")).toBeTruthy();
  });
});

describe("détail d'un train", () => {
  test("prévu / estimé / retard, puis favori et alerte", async () => {
    renderAt(`/trains/trajet?id=${encodeURIComponent(J1.id)}`);
    await screen.findByText("Statut");
    expect(screen.getAllByText("Prévu").length).toBe(2);
    expect(screen.getAllByText("Estimé").length).toBe(2);
    expect(screen.getByText("Voie 4")).toBeTruthy();          // bloc Départ
    expect(screen.getByText(/· voie 4/)).toBeTruthy();         // liste des arrêts

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

// jsdom n'a pas PointerEvent : sans lui, les coordonnées (clientX/Y) seraient perdues.
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  };
}

describe("Mes trajets", () => {
  const FAV = { id: 7, origin_id: LILLE.id, origin_name: LILLE.name, destination_id: AMIENS.id, destination_name: AMIENS.name, departure_time: "16:53", train_number: "843924", line_name: "K44", label: null,
    alert: { id: 3, scope: "trip", active: true, delay_threshold: 10, on_cancel: true, on_disruption: false, days: "1,2,3,4,5" }, next: [J1, J2] };

  test("trains favoris : prochain départ seulement, alerte, correspondance Vélam ; pas de stations dessous", async () => {
    favorites = [FAV];
    renderAt("/trajets");
    expect(await screen.findByText("16:53 Lille Flandres → Amiens")).toBeTruthy();
    expect(screen.getByText("En retard")).toBeTruthy();
    expect(screen.getByText("Retard ≥ 10 min · suppression — lun.–ven.")).toBeTruthy();
    // Les autres jours ne sont pas affichés d'emblée.
    expect(screen.queryByRole("list", { name: "Prochaines circulations" })).toBeNull();
    expect(screen.queryByText("Supprimé")).toBeNull();
    // À l'arrivée (Amiens) : la station Vélam la plus proche avec des vélos ; rien à Lille (trop loin).
    const velam = await screen.findByRole("list", { name: "Stations Vélam proches" });
    expect(velam.textContent).toMatch(/À l'arrivée : Gare du Nord · 4 vélos · 1\d\d m/);
    expect(velam.textContent).not.toMatch(/Au départ/);
    expect(screen.queryByRole("heading", { name: "Stations Vélam" })).toBeNull();
    expect(screen.getByRole("button", { name: "Trains", pressed: true })).toBeTruthy();
  });

  test("appui long sur le train : les autres jours, sans ouvrir le détail", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      favorites = [FAV];
      renderAt("/trajets");
      const route = await screen.findByRole("link", { name: /^Lille Flandres Amiens/ });
      fireEvent.pointerDown(route, { button: 0, clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(600); });
      const dialog = await screen.findByRole("dialog", { name: "Autres jours" });
      const others = within(dialog).getByRole("list", { name: "Prochaines circulations" });
      expect(within(others).getByText("Supprimé")).toBeTruthy();
      fireEvent.pointerUp(route);
      fireEvent.click(route); // le clic du lâcher est ignoré : on reste sur Mes trajets
      expect(screen.getByRole("heading", { name: "Mes trajets" })).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "Autres jours" })).toBeTruthy();
    } finally {
      act(() => { vi.advanceTimersByTime(4000); }); // fin de la fenêtre où le clic est ignoré
      vi.useRealTimers();
    }
  });

  test("appui court : ouvre le détail ; défilement : pas d'appui long", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      favorites = [FAV];
      renderAt("/trajets");
      const route = await screen.findByRole("link", { name: /^Lille Flandres Amiens/ });
      fireEvent.pointerDown(route, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(route, { clientX: 10, clientY: 60 });
      act(() => { vi.advanceTimersByTime(600); });
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(route);
      expect(await screen.findByText(/Chargement du trajet|Lille Flandres → Amiens/)).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Mes trajets" })).toBeNull();
    } finally {
      act(() => { vi.advanceTimersByTime(4000); }); // fin de la fenêtre où le clic est ignoré
      vi.useRealTimers();
    }
  });

  test("bouton « Autres jours » (clavier, lecteur d'écran)", async () => {
    favorites = [{ ...FAV, next: [J1] }];
    renderAt("/trajets");
    fireEvent.click(await screen.findByRole("button", { name: "Autres jours" }));
    expect(await screen.findByText("Aucune autre circulation dans les 8 prochains jours.")).toBeTruthy();
  });

  test("bascule Trains / Vélos : une catégorie à la fois, choix mémorisé", async () => {
    favorites = [FAV];
    renderAt("/trajets");
    await screen.findByText("16:53 Lille Flandres → Amiens");
    fireEvent.click(screen.getByRole("button", { name: "Vélos" }));
    expect(await screen.findByRole("heading", { name: "Stations Vélam" })).toBeTruthy();
    expect(screen.queryByText("16:53 Lille Flandres → Amiens")).toBeNull();
    expect(localStorage.getItem("velopulse-trajets-vue")).toBe("velos");
  });

  test("vue par défaut : vélos si aucun train suivi mais des stations favorites", async () => {
    stationFavorites = [{ station_id: "1", station_name: "Gare du Nord", label: null, sort_order: null }];
    renderAt("/trajets");
    expect(await screen.findByRole("heading", { name: "Stations Vélam" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vélos", pressed: true })).toBeTruthy();
  });

  test("aucun train suivi : invitation à rechercher", async () => {
    renderAt("/trajets");
    expect(await screen.findByText(/Aucun train suivi/)).toBeTruthy();
  });

  test("ancienne adresse « Mes trains » : redirigée vers Mes trajets", async () => {
    renderAt("/trains?onglet=mes-trains");
    expect(await screen.findByRole("heading", { name: "Mes trajets" })).toBeTruthy();
  });
});

describe("Alertes trains", () => {
  test("trajets et lignes suivis dans la page Alertes", async () => {
    trainAlerts = [
      { id: 3, scope: "trip", active: true, delay_threshold: 10, on_cancel: true, on_disruption: false, days: "1,2,3,4,5",
        favorite: { id: 7, label: null, line_name: "K44", departure_time: "16:53", origin_name: "Lille Flandres", destination_name: "Amiens" } },
      { id: 4, scope: "line", active: false, line_name: "K44", line_long_name: "Lille Flandres - Amiens", delay_threshold: null, on_cancel: false, on_disruption: true, days: "1,2,3,4,5,6,7", time_start: null },
    ];
    renderAt("/alertes?type=trains");
    expect(await screen.findByText("16:53 Lille Flandres → Amiens")).toBeTruthy();
    expect(screen.getByText("Lille Flandres - Amiens")).toBeTruthy();
    expect(screen.getByText("Perturbations — tous les jours")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suivre une ligne" })).toBeTruthy();
    // Pas de bouton « + » (création d'alerte vélo) côté trains.
    expect(screen.queryByRole("button", { name: "Créer une alerte" })).toBeNull();
  });
});
