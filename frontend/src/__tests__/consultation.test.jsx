import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disabledNote, fmtAge, bannerText } from "../lib/station";
import { nearestWithBikes, mapStyleFor } from "../lib/mapConfig";
import { ThemeProvider } from "../useTheme";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import LocateHint from "../components/LocateHint";
import { useGeolocation, requestPosition } from "../hooks";
import { jsonResponse } from "./setup";

// La carte Mapbox (WebGL) n'est pas testable en jsdom : on la remplace par un
// composant qui expose la prop `focus` reçue.
vi.mock("../components/map/StationMap", () => ({
  default: ({ focus, theme }) => <div data-testid="map" data-theme={theme} data-focus={focus ? JSON.stringify(focus.coords) : ""} />,
}));
import MapPage from "../pages/MapPage";

describe("fraîcheur des disponibilités (bandeau global)", () => {
  const now = new Date(2025, 8, 24, 14, 40).getTime();
  const at = (min) => new Date(now - min * 60_000);

  test("fmtAge", () => {
    expect(fmtAge(7)).toBe("7 min");
    expect(fmtAge(150)).toBe("2 h");
    expect(fmtAge(60 * 50)).toBe("2 j");
  });

  test("flux Vélam figé depuis 5 min ou plus", () => {
    expect(bannerText("upstream", at(7), "14:33", now)).toBe("Disponibilités non mises à jour depuis 7 min — données de 14:33");
    expect(bannerText("upstream", at(5), "14:35", now)).toMatch(/depuis 5 min/);
  });

  test("flux Vélam en panne mais données encore récentes", () => {
    expect(bannerText("upstream", at(1), "14:39", now)).toBe("Données Vélam momentanément indisponibles — données de 14:39");
  });

  test("hors ligne / serveur injoignable / aucune donnée", () => {
    expect(bannerText("offline", at(3), "14:37", now)).toBe("Hors ligne — données de 14:37");
    expect(bannerText("server", null, null, now)).toBe("Serveur injoignable — aucune donnée enregistrée");
  });

  test("plus aucun indicateur par station", () => {
    render(<StationListItem s={{ station_id: "1", name: "Gare", report_age_min: 90, last_reported: 1 }} />);
    expect(screen.queryByText(/Dernière info/)).toBeNull();
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
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations, stale: false, data_age_s: 0 }));
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
    fetch.mockResolvedValue(jsonResponse({ ok: true, stations, stale: false, data_age_s: 0 }));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok, ko) => ko(new Error("refus")) },
    });
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Autour de moi/ }));
    expect((await screen.findByRole("status")).textContent).toMatch(/autorisez la géolocalisation/);
  });
});

describe("géolocalisation : jamais d'invite au lancement", () => {
  const here = { lat: 49.89, lon: 2.30 };
  const mockGeo = ({ permission, fail = false } = {}) => {
    const getCurrentPosition = vi.fn((ok, ko) => (fail ? ko(new Error("refus")) : ok({ coords: { latitude: here.lat, longitude: here.lon } })));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: permission ? { query: async () => ({ state: permission }) } : undefined,
    });
    return getCurrentPosition;
  };
  function Probe() {
    const { coords, status, locate } = useGeolocation();
    return (<>
      <span data-testid="coords">{coords ? `${coords.lat},${coords.lon}` : ""}</span>
      <LocateHint status={status} onLocate={locate} />
    </>);
  }

  test("autorisation pas encore donnée → aucune demande, bouton « Trier par proximité »", async () => {
    const gcp = mockGeo({ permission: "prompt" });
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 0));
    expect(gcp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Trier par proximité/ }));
    expect(gcp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("coords").textContent).toBe("49.89,2.3"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("sans Permissions API (anciens navigateurs) → aucune demande automatique", async () => {
    const gcp = mockGeo({ permission: null });
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 0));
    expect(gcp).not.toHaveBeenCalled();
    expect(screen.getByText("Stations triées par nom.")).toBeTruthy();
  });

  test("autorisation déjà accordée → localisation automatique", async () => {
    const gcp = mockGeo({ permission: "granted" });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("coords").textContent).toBe("49.89,2.3"));
    expect(gcp).toHaveBeenCalledTimes(1);
  });

  test("refus → message, sans redemander", async () => {
    const gcp = mockGeo({ permission: "prompt", fail: true });
    render(<Probe />);
    fireEvent.click(await screen.findByRole("button", { name: /Trier par proximité/ }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Position non autorisée/);
    expect(gcp).toHaveBeenCalledTimes(1);
  });

  test("position partagée entre les pages : une seule mesure", async () => {
    const gcp = mockGeo({ permission: "prompt" });
    expect(await requestPosition()).toEqual(here);
    expect(await requestPosition()).toEqual(here);
    expect(gcp).toHaveBeenCalledTimes(1);
    render(<Probe />); // une page affichée ensuite a directement la position
    expect(screen.getByTestId("coords").textContent).toBe("49.89,2.3");
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

describe("carte en thème sombre", () => {
  test("mapStyleFor", () => {
    expect(mapStyleFor("dark")).toMatch(/dark-v11$/);
    expect(mapStyleFor("light")).toMatch(/light-v11$/);
    expect(mapStyleFor(undefined)).toMatch(/light-v11$/);
  });

  test("la page Carte transmet le thème courant à la carte", async () => {
    localStorage.setItem("velopulse-theme", "dark");
    fetch.mockImplementation(async () => jsonResponse({ ok: true, stations: [], stale: false, data_age_s: 0 }));
    render(<MemoryRouter><ThemeProvider><MapPage /></ThemeProvider></MemoryRouter>);
    expect((await screen.findByTestId("map")).dataset.theme).toBe("dark");
  });
});

describe("étoile favori dans la liste mobile", () => {
  const s = { station_id: "1", name: "Gare", electrical: 1, mechanical: 1, docks_available: 3 };

  test("bascule le favori sans ouvrir la fiche", () => {
    const onClick = vi.fn();
    const onToggleFav = vi.fn();
    render(<StationListItem s={s} onClick={onClick} isFav={false} onToggleFav={onToggleFav} />);
    const star = screen.getByRole("button", { name: "Ajouter Gare aux favoris" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(star);
    expect(onToggleFav).toHaveBeenCalledWith(s);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("état favori et absence d'étoile sans callback", () => {
    const { rerender } = render(<StationListItem s={s} isFav onToggleFav={() => {}} />);
    expect(screen.getByRole("button", { name: "Retirer Gare des favoris" }).getAttribute("aria-pressed")).toBe("true");
    rerender(<StationListItem s={s} />);
    expect(screen.queryByRole("button", { name: /favoris/ })).toBeNull();
  });
});
