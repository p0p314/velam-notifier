import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { staleNote, disabledNote, fmtAge } from "../lib/station";
import { nearestWithBikes } from "../lib/mapConfig";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import { jsonResponse } from "./setup";

// La carte Mapbox (WebGL) n'est pas testable en jsdom : on la remplace par un
// composant qui expose la prop `focus` reçue.
vi.mock("../components/map/StationMap", () => ({
  default: ({ focus }) => <div data-testid="map" data-focus={focus ? JSON.stringify(focus.coords) : ""} />,
}));
import MapPage from "../pages/MapPage";

describe("données de borne périmées", () => {
  test("fmtAge", () => {
    expect(fmtAge(75)).toBe("75 min");
    expect(fmtAge(150)).toBe("2 h");
    expect(fmtAge(60 * 50)).toBe("2 j");
  });
  test("au-delà d'une heure seulement, jamais pour une station hors service", () => {
    expect(staleNote({ report_age_min: 59 })).toBeNull();
    expect(staleNote({ report_age_min: 125 })).toBe("Dernière info il y a 2 h");
    expect(staleNote({ report_age_min: 300, is_renting: false })).toBeNull();
    expect(staleNote({})).toBeNull();
  });
  test("affichée dans la liste", () => {
    render(<StationListItem s={{ station_id: "1", name: "Gare", report_age_min: 90 }} />);
    expect(screen.getByText(/Dernière info il y a 90 min/)).toBeTruthy();
  });
});

describe("vélos indisponibles", () => {
  test("disabledNote", () => {
    expect(disabledNote({ bikes_disabled: 0 })).toBeNull();
    expect(disabledNote({ bikes_disabled: 1 })).toBe("1 vélo indisponible");
    expect(disabledNote({ bikes_disabled: 3 })).toBe("3 vélos indisponibles");
  });
  test("ligne dans la fiche station seulement s'il y en a", () => {
    const s = { station_id: "1", name: "Gare", electrical: 1, mechanical: 1, docks_available: 2, bikes_disabled: 3 };
    const { rerender } = render(<MemoryRouter><StationDetailSheet station={s} open onClose={() => {}} onToggleFav={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Vélos indisponibles")).toBeTruthy();
    rerender(<MemoryRouter><StationDetailSheet station={{ ...s, bikes_disabled: 0 }} open onClose={() => {}} onToggleFav={() => {}} /></MemoryRouter>);
    expect(screen.queryByText("Vélos indisponibles")).toBeNull();
  });
});

describe("autour de moi", () => {
  const here = { lat: 49.89, lon: 2.30 };
  const stations = [
    { station_id: "a", name: "Tout près vide", lat: 49.8901, lon: 2.30, electrical: 0, mechanical: 0 },
    { station_id: "b", name: "Proche", lat: 49.892, lon: 2.30, electrical: 1, mechanical: 2 },
    { station_id: "c", name: "Fermée", lat: 49.8905, lon: 2.30, electrical: 5, mechanical: 5, is_renting: false },
    { station_id: "d", name: "Moyen", lat: 49.895, lon: 2.30, electrical: 0, mechanical: 4 },
    { station_id: "e", name: "Loin", lat: 49.95, lon: 2.30, electrical: 3, mechanical: 0 },
    { station_id: "f", name: "Très loin", lat: 50.1, lon: 2.30, electrical: 3, mechanical: 0 },
  ];

  test("nearestWithBikes : 3 plus proches avec vélos, hors stations fermées", () => {
    expect(nearestWithBikes(stations, here).map((s) => s.station_id)).toEqual(["b", "d", "e"]);
    expect(nearestWithBikes(stations, here, "elec").map((s) => s.station_id)).toEqual(["b", "e", "f"]);
    expect(nearestWithBikes(stations, null)).toEqual([]);
  });

  test("bouton : liste des stations proches et carte recentrée", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations, fetched_at: new Date().toISOString() }));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok) => ok({ coords: { latitude: here.lat, longitude: here.lon } }) },
    });
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0)); // stations chargées
    fireEvent.click(await screen.findByRole("button", { name: /Autour de moi/ }));
    const panel = await screen.findByRole("status");
    expect([...panel.querySelectorAll(".map-around-name")].map((n) => n.textContent)).toEqual(["Proche", "Moyen", "Loin"]);
    expect(panel.textContent).toMatch(/222 m · 3 vélos/);
    expect(screen.getByTestId("map").dataset.focus).toBe(JSON.stringify(here));
  });

  test("géolocalisation refusée → message", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations, fetched_at: new Date().toISOString() }));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok, ko) => ko(new Error("refus")) },
    });
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Autour de moi/ }));
    expect((await screen.findByRole("status")).textContent).toMatch(/autorisez la géolocalisation/);
  });
});

describe("raccourcis de l'app (manifest)", () => {
  test("Favoris, Carte, Alertes vers des routes existantes", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.json"), "utf8"));
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(["/favoris", "/carte", "/alertes"]);
    for (const s of manifest.shortcuts) {
      expect(s.name).toBeTruthy();
      expect(s.icons[0].src).toMatch(/^\/icon-/);
    }
  });
});
