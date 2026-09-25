import { describe, test, expect, vi } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OfflineBanner, OnlineOnly } from "../components/Offline";
import Alerts from "../pages/Alerts";
import { jsonResponse, setOnline } from "./setup";
import { stationStatus, bikeCounts } from "../lib/station";
import { availabilityLevel, bikeCountForType } from "../lib/mapConfig";
import { fmtTime } from "../theme";

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("OfflineBanner", () => {
  test("masqué en ligne avec données fraîches", () => {
    const { container } = wrap(<OfflineBanner stale={false} lastUpd={new Date()} />);
    expect(container.textContent).toBe("");
  });

  test("hors ligne : affiche l'heure de la dernière mise à jour", () => {
    setOnline(false, { emit: false });
    const d = new Date();
    d.setHours(14, 32);
    wrap(<OfflineBanner stale lastUpd={d} />);
    expect(screen.getByRole("status").textContent).toBe("Hors ligne — données de 14:32");
  });

  test("serveur injoignable (réseau OK)", () => {
    wrap(<OfflineBanner stale lastUpd={null} />);
    expect(screen.getByRole("status").textContent).toBe("Serveur injoignable — aucune donnée enregistrée");
  });

  test("réagit au passage hors ligne", () => {
    wrap(<OfflineBanner stale={false} lastUpd={new Date()} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => setOnline(false));
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("OnlineOnly", () => {
  test("en ligne : rend la page", () => {
    wrap(<OnlineOnly><p>Carte</p></OnlineOnly>);
    expect(screen.getByText("Carte")).toBeTruthy();
  });
  test("hors ligne : message + liens vers stations et favoris", () => {
    setOnline(false, { emit: false });
    wrap(<OnlineOnly><p>Carte</p></OnlineOnly>);
    expect(screen.queryByText("Carte")).toBeNull();
    expect(screen.getByText("Cette page nécessite une connexion")).toBeTruthy();
    expect(screen.getByRole("link", { name: "liste des stations" }).getAttribute("href")).toBe("/stations");
    expect(screen.getByRole("link", { name: "favoris" }).getAttribute("href")).toBe("/favoris");
  });
});

describe("Alerts — bandeau notifications", () => {
  const setupNotification = (permission) => {
    const requestPermission = vi.fn(async () => "denied");
    window.PushManager = function PushManager() {};
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}) } });
    window.Notification = { permission, requestPermission };
    fetch.mockImplementation(async (url) =>
      jsonResponse(String(url).includes("/alerts") ? { ok: true, alerts: [] } : { ok: true, favorites: [] }));
    return requestPermission;
  };

  test("permission non décidée : bouton, et la demande n'a lieu qu'au clic", async () => {
    const requestPermission = setupNotification("default");
    wrap(<Alerts />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    await screen.findByText(/Notifications bloquées/);
  });

  test("permission accordée : pas de bouton Activer (bouton Tester à la place)", async () => {
    setupNotification("granted");
    wrap(<Alerts />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Activer" })).toBeNull();
  });

  test("permission refusée : explication, pas de bouton", async () => {
    setupNotification("denied");
    wrap(<Alerts />);
    expect(screen.getByText(/Notifications bloquées/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activer" })).toBeNull();
  });
});

describe("logique station", () => {
  test("stationStatus", () => {
    expect(stationStatus({ is_renting: false }).cls).toBe("closed");
    expect(stationStatus({ electrical: 1, mechanical: 1 }).cls).toBe("warn");
    expect(stationStatus({ electrical: 2, mechanical: 1 }).cls).toBe("open");
  });
  test("bikeCounts tolère les champs absents", () => {
    expect(bikeCounts({})).toEqual({ elec: 0, meca: 0, total: 0 });
  });
  test("availabilityLevel / bikeCountForType", () => {
    const s = { electrical: 4, mechanical: 3 };
    expect(bikeCountForType(s, "elec")).toBe(4);
    expect(bikeCountForType(s, "all")).toBe(7);
    expect(availabilityLevel(2)).toBe("danger");
    expect(availabilityLevel(5)).toBe("warn");
    expect(availabilityLevel(6)).toBe("ok");
    expect(availabilityLevel(10, true)).toBe("off");
  });
  test("fmtTime ignore les timestamps invalides", () => {
    expect(fmtTime(0)).toBeNull();
    expect(fmtTime(1_758_700_000)).toMatch(/^\d{2}:\d{2}$/);
  });
});
