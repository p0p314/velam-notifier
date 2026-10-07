import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  ageLabel, positionInfo, positionNote, routeNote, progressInfo, stopPopup, stopState,
  segmentCoords, routeGeoJSON, stationsGeoJSON, initialView, mapRefreshMs, routeNear, trainMapPath,
} from "../lib/trainMap";
import { jsonResponse } from "./setup";

// La carte Mapbox n'est pas testable sous jsdom : remplacée par un témoin des props.
vi.mock("../components/map/TrainMap", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function TrainMapMock({ route, position, bikeStations }, _ref) {
      return (
        <div data-testid="train-map" data-geometry={route?.geometrySource ?? ""} data-vehicle={position?.vehicle ? "1" : "0"}
          data-bikes={bikeStations ? String(bikeStations.length) : "off"} />
      );
    }),
  };
});
// Token simulé : les boutons de cadrage n'apparaissent qu'avec une carte disponible.
vi.mock("../lib/mapConfig", async (importOriginal) => ({ ...(await importOriginal()), MAPBOX_TOKEN: "pk.test" }));
const { default: TrainMapPage } = await import("../pages/TrainMapPage");

const LILLE = { id: "SA:LILLE", name: "Lille Flandres", lat: 50.6366, lon: 3.0699 };
const DOUAI = { id: "SA:DOUAI", name: "Douai", lat: 50.371, lon: 3.09 };
const ARRAS = { id: "SA:ARRAS", name: "Arras", lat: 50.286, lon: 2.781 };
const AMIENS = { id: "SA:AMIENS", name: "Amiens", lat: 49.8906, lon: 2.3083 };
const T = (hhmm) => `2026-10-07T${String(Number(hhmm.slice(0, 2)) - 2).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`; // Paris (UTC+2)

const stop = (station, arr, dep, over = {}) => ({
  station, seq: 0, stopId: null, scheduledArrival: T(arr), scheduledDeparture: T(dep),
  estimatedArrival: null, estimatedDeparture: null, delay: null, skipped: false, inJourney: true, ...over,
});
const JOURNEY = {
  id: "trip1|2026-10-07|SA:LILLE|SA:AMIENS", status: "on_time", phase: "en_route", serviceDate: "2026-10-07",
  line: { id: "L", name: "K44", color: "BF005F", textColor: "FFFFFF" }, lineName: "K44", trainNumber: "843924", brand: "TER",
  mode: "train", terminus: "Amiens", departureStation: LILLE, arrivalStation: AMIENS,
  scheduledDeparture: T("16:53"), scheduledArrival: T("18:10"), estimatedDeparture: null, estimatedArrival: null,
  departureDelay: null, arrivalDelay: null, cancellation: null, realtime: true, alerts: [], disrupted: false,
  stops: [
    stop(LILLE, "16:53", "16:53"),
    stop(DOUAI, "17:12", "17:14"),
    stop(ARRAS, "17:27", "17:29", { estimatedArrival: T("17:30"), estimatedDeparture: T("17:32"), delay: 3 }),
    stop(AMIENS, "18:10", "18:10"),
  ],
};
const ROUTE = {
  tripId: "trip1", shapeId: null, geometrySource: "stops", direction: 1, distanceKm: 120.4,
  geometry: { type: "LineString", coordinates: [[3.0699, 50.6366], [3.09, 50.371], [2.781, 50.286], [2.3083, 49.8906]] },
  bbox: [2.3083, 49.8906, 3.09, 50.6366],
  stops: [LILLE, DOUAI, ARRAS, AMIENS].map((station, seq) => ({ station, seq })),
  segment: { from: 0, to: 3 }, line: { name: "K44", color: "BF005F" }, trainNumber: "843924",
};
const BETWEEN = { basis: "schedule", state: "between", previous: 1, next: 2, upcoming: [2, 3] };

describe("lib/trainMap", () => {
  test("âge et fraîcheur de la position (actuelle / ancienne)", () => {
    expect(ageLabel(30)).toBe("30 s");
    expect(ageLabel(480)).toBe("8 min");
    const now = Date.parse("2026-10-07T15:20:00Z");
    expect(positionInfo({ vehicle: { updatedAt: "2026-10-07T15:19:30Z", stale: false } }, now))
      .toMatchObject({ tone: "ok", text: "Position mise à jour il y a 30 s" });
    expect(positionInfo({ vehicle: { updatedAt: "2026-10-07T15:12:00Z", stale: true } }, now))
      .toMatchObject({ tone: "warn", text: "Position connue il y a 8 min" });
    // Devenue ancienne entre deux actualisations : jamais présentée comme actuelle.
    expect(positionInfo({ vehicle: { updatedAt: "2026-10-07T15:14:00Z", stale: false } }, now).stale).toBe(true);
    expect(positionInfo({ vehicle: null }, now)).toBeNull();
  });

  test("notes : positions non publiées (SNCF), flux en panne, position absente, supprimé, tracé approximatif", () => {
    expect(positionNote({ available: false }, JOURNEY, "sncf")).toMatch(/pas publiée par la SNCF.*horaires/);
    expect(positionNote({ available: true, upstream_ok: false, vehicle: null }, JOURNEY)).toMatch(/indisponibles pour le moment/);
    expect(positionNote({ available: true, upstream_ok: true, vehicle: null }, JOURNEY)).toMatch(/Position de ce train indisponible/);
    expect(positionNote({ available: true, vehicle: { stale: true } }, JOURNEY)).toMatch(/Position ancienne/);
    expect(positionNote({ available: true, vehicle: { stale: false } }, JOURNEY)).toBeNull();
    expect(positionNote({ available: true, vehicle: null }, { ...JOURNEY, phase: "upcoming" })).toBeNull();
    expect(positionNote({ available: false }, { ...JOURNEY, status: "cancelled" })).toMatch(/supprimé/);
    expect(routeNote(ROUTE, "sncf")).toMatch(/approximatif.*SNCF/);
    expect(routeNote({ ...ROUTE, geometrySource: "shape" })).toBeNull();
  });

  test("progression : prochaine gare (heure estimée, retard), base du calcul, prochaines gares", () => {
    const p = progressInfo(JOURNEY, BETWEEN);
    expect(p.title).toBe("Prochaine gare : Arras");
    expect(p.sub).toBe("Arrivée 17:30 · +3 min · depuis Douai");
    expect(p.basisLabel).toBe("Estimé d'après les horaires");
    expect(p.upcoming.map((s) => s.name)).toEqual(["Arras", "Amiens"]);
    expect(progressInfo(JOURNEY, { ...BETWEEN, basis: "position" }).basisLabel).toBe("D'après la position du train");
    expect(progressInfo(JOURNEY, { basis: "schedule", state: "at_stop", previous: 1, next: 2, upcoming: [2, 3] }).title).toBe("En gare de Douai");
    expect(progressInfo(JOURNEY, { basis: "schedule", state: "not_departed", previous: null, next: 0, upcoming: [0, 1, 2, 3] }))
      .toMatchObject({ title: "Pas encore parti", sub: "Départ de Lille Flandres à 16:53" });
    expect(progressInfo(JOURNEY, { basis: "schedule", state: "arrived", previous: 3, next: null, upcoming: [] }).title).toBe("Arrivé à Amiens");
    expect(progressInfo(JOURNEY, null)).toBeNull();
  });

  test("gares : état (montée, descente, desservie, prochaine, supprimée) et popup", () => {
    const sub = { ...ROUTE, segment: { from: 1, to: 2 } };
    expect([0, 1, 2, 3].map((i) => stopState(JOURNEY, BETWEEN, ROUTE, i))).toEqual(["board", "passed", "next", "alight"]);
    expect(stopState(JOURNEY, BETWEEN, sub, 0)).toBe("passed");
    const skipped = { ...JOURNEY, stops: JOURNEY.stops.map((s, i) => (i === 2 ? { ...s, skipped: true } : s)) };
    expect(stopState(skipped, BETWEEN, ROUTE, 2)).toBe("skipped");

    const p = stopPopup(JOURNEY, BETWEEN, ROUTE, 2);
    expect(p).toMatchObject({ name: "Arras", status: "Prochain arrêt", delay: "+3 min" });
    expect(p.rows).toEqual([
      { label: "Arrivée", scheduled: "17:27", estimated: "17:30" },
      { label: "Départ", scheduled: "17:29", estimated: "17:32" },
    ]);
    expect(stopPopup(JOURNEY, BETWEEN, ROUTE, 0).rows.map((r) => r.label)).toEqual(["Départ"]);
    expect(stopPopup(JOURNEY, BETWEEN, ROUTE, 3).rows.map((r) => r.label)).toEqual(["Arrivée"]);
    expect(stopPopup({ ...JOURNEY, status: "cancelled" }, null, ROUTE, 1).status).toBe("Train supprimé");
  });

  test("GeoJSON : tracé complet, portion du voyageur, gares", () => {
    const sub = { ...ROUTE, segment: { from: 1, to: 2 } };
    expect(segmentCoords(sub)).toEqual([[3.09, 50.371], [2.781, 50.286]]);
    // Tracé réel : découpé aux sommets les plus proches des gares.
    const shape = { ...sub, geometrySource: "shape", geometry: { type: "LineString", coordinates: [[3.07, 50.63], [3.08, 50.5], [3.091, 50.37], [2.9, 50.3], [2.78, 50.285], [2.31, 49.89]] } };
    expect(segmentCoords(shape)).toEqual([[3.091, 50.37], [2.9, 50.3], [2.78, 50.285]]);
    const geo = routeGeoJSON(ROUTE);
    expect(geo.full.features[0].geometry.coordinates).toHaveLength(4);
    expect(routeGeoJSON(null).full.features).toEqual([]);
    const pts = stationsGeoJSON(ROUTE, JOURNEY, BETWEEN);
    expect(pts.features.map((f) => [f.properties.name, f.properties.state, f.properties.label])).toEqual([
      ["Lille Flandres", "board", "Lille Flandres"], ["Douai", "passed", ""], ["Arras", "next", ""], ["Amiens", "alight", "Amiens"],
    ]);
  });

  test("vue initiale : le train si sa position est actuelle, sinon tout le trajet", () => {
    expect(initialView(ROUTE, { vehicle: { lat: 50.3, lon: 2.9, stale: false } })).toEqual({ center: [2.9, 50.3], zoom: 11 });
    expect(initialView(ROUTE, { vehicle: { lat: 50.3, lon: 2.9, stale: true } })).toEqual({ bounds: [[2.3083, 49.8906], [3.09, 50.6366]] });
    expect(initialView(ROUTE, null).bounds).toBeTruthy();
  });

  test("actualisation : 30 s seulement si des positions sont publiées pour un train en route", () => {
    expect(mapRefreshMs({ journey: JOURNEY, position: { available: true } }, 120_000)).toBe(30_000);
    expect(mapRefreshMs({ journey: JOURNEY, position: { available: false } }, 120_000)).toBe(120_000);
    expect(mapRefreshMs({ journey: { ...JOURNEY, phase: "arrived" }, position: { available: true } }, 120_000)).toBe(120_000);
    expect(routeNear(ROUTE, { lat: 49.894, lng: 2.2957 })).toBe(true);
    expect(routeNear({ stops: [{ station: { lat: 45.7, lon: 4.8 } }] }, { lat: 49.894, lng: 2.2957 })).toBe(false);
    expect(trainMapPath("a|b")).toBe("/trains/carte?id=a%7Cb");
  });
});

describe("page Carte d'un train", () => {
  let position;
  let calls;
  beforeEach(() => {
    calls = [];
    position = { available: false, upstream_ok: null, vehicle: null, progress: BETWEEN };
    fetch.mockImplementation(async (url, init = {}) => {
      const u = new URL(String(url));
      calls.push({ path: u.pathname, cache: init.cache });
      if (u.pathname === "/api/trains/journey") {
        return jsonResponse({ ok: true, provider: "sncf", journey: JOURNEY, position, realtime: { applicable: true, available: true, updated_at: new Date().toISOString() } });
      }
      if (u.pathname === "/api/trains/route") return jsonResponse({ ok: true, provider: "sncf", route: ROUTE });
      if (u.pathname === "/api/stations") return jsonResponse({ ok: true, stations: [{ station_id: "1", name: "Gare du Nord", lat: 49.8915, lon: 2.3095, electrical: 1, mechanical: 3, docks_available: 6, is_renting: true }], stale: false, data_age_s: 0 });
      return jsonResponse({ ok: false, error: "inattendu" }, 404);
    });
  });
  const renderPage = () => render(
    <MemoryRouter initialEntries={[trainMapPath(JOURNEY.id)]}>
      <Routes><Route path="/trains/carte" element={<TrainMapPage />} /></Routes>
    </MemoryRouter>
  );

  test("SNCF : tracé approximatif, prochaine gare d'après les horaires, pas de position", async () => {
    renderPage();
    expect(await screen.findByText("Prochaine gare : Arras")).toBeTruthy();
    expect(screen.getByText("Estimé d'après les horaires")).toBeTruthy();
    expect(screen.getByText(/pas publiée par la SNCF/)).toBeTruthy();
    expect(screen.getByText(/Tracé approximatif/)).toBeTruthy();
    expect(screen.getByTestId("train-map").dataset.geometry).toBe("stops");
    expect(screen.getByTestId("train-map").dataset.vehicle).toBe("0");
    expect(screen.queryByRole("button", { name: /Train/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Trajet/ })).toBeTruthy();
    expect(screen.getByText(/mercredi 7 octobre/i)).toBeTruthy();
    // Le tracé, statique, peut venir du cache HTTP ; le détail jamais.
    expect(calls.find((c) => c.path === "/api/trains/route").cache).toBe("default");
    expect(calls.find((c) => c.path === "/api/trains/journey").cache).toBe("no-store");
  });

  test("position publiée : fraîcheur, bouton « Train », base « position »", async () => {
    position = {
      available: true, upstream_ok: true, progress: { ...BETWEEN, basis: "position" },
      vehicle: { lat: 50.3, lon: 2.85, bearing: 220, stale: false, updatedAt: new Date(Date.now() - 30_000).toISOString(), ageS: 30 },
    };
    renderPage();
    expect(await screen.findByText(/Position mise à jour il y a 30 s/)).toBeTruthy();
    expect(screen.getByText("D'après la position du train")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Train/ })).toBeTruthy();
    expect(screen.getByTestId("train-map").dataset.vehicle).toBe("1");
  });

  test("stations Vélam : chargées seulement à la demande (trajet passant par Amiens)", async () => {
    renderPage();
    await screen.findByText("Prochaine gare : Arras");
    expect(calls.some((c) => c.path === "/api/stations")).toBe(false);
    fireEvent.click(screen.getByLabelText("Stations Vélam"));
    await waitFor(() => expect(screen.getByTestId("train-map").dataset.bikes).toBe("1"));
  });
});
