import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Favorites from "../pages/Favorites";
import { moveItem, displayStation, sortFavorites, loadSortPref, saveSortPref } from "../lib/favorites";
import { jsonResponse } from "./setup";

describe("lib/favorites", () => {
  test("moveItem : déplacement borné, sans muter l'original", () => {
    const l = ["a", "b", "c"];
    expect(moveItem(l, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(l, 2, -2)).toEqual(["c", "a", "b"]);
    expect(moveItem(l, 0, -1)).toBe(l);
    expect(l).toEqual(["a", "b", "c"]);
  });

  test("displayStation : nom personnalisé en titre, nom réel en sous-titre", () => {
    const st = { station_id: "1", name: "Gare du Nord", address: "Place" };
    expect(displayStation(st, { label: "Maison" })).toMatchObject({ name: "Maison", subtitle: "Gare du Nord", address: "Place" });
    expect(displayStation(st, { label: null })).toBe(st);
  });

  test("sortFavorites : proximité si position, sinon ordre choisi", () => {
    const items = [{ station_id: "loin", lat: 49.95, lon: 2.3 }, { station_id: "pres", lat: 49.89, lon: 2.3 }];
    const here = { lat: 49.89, lon: 2.3 };
    expect(sortFavorites(items, "distance", here).map((s) => s.station_id)).toEqual(["pres", "loin"]);
    expect(sortFavorites(items, "distance", null)).toBe(items);
    expect(sortFavorites(items, "custom", here)).toBe(items);
  });

  test("préférence de tri mémorisée", () => {
    expect(loadSortPref()).toBe("distance");
    saveSortPref("custom");
    expect(loadSortPref()).toBe("custom");
  });
});

describe("page Favoris", () => {
  let favorites, calls;
  const STATIONS = [
    { station_id: "1", name: "Gare", address: "Place", electrical: 1, mechanical: 2, docks_available: 3 },
    { station_id: "2", name: "Zoo", address: "Parc", electrical: 0, mechanical: 5, docks_available: 1 },
  ];

  beforeEach(() => {
    favorites = [
      { station_id: "1", station_name: "Gare", label: "Maison", sort_order: 0 },
      { station_id: "2", station_name: "Zoo", label: null, sort_order: 1 },
    ];
    calls = [];
    fetch.mockImplementation(async (url, init = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (path === "/api/stations") return jsonResponse({ ok: true, stations: STATIONS, stale: false, data_age_s: 0 });
      if (path === "/api/favorites/order") {
        favorites = body.station_ids.map((id) => favorites.find((f) => f.station_id === id));
        return jsonResponse({ ok: true, favorites });
      }
      if (path.startsWith("/api/favorites/") && method === "PATCH") {
        const id = decodeURIComponent(path.split("/").pop());
        favorites = favorites.map((f) => (f.station_id === id ? { ...f, label: body.label || null } : f));
        return jsonResponse({ ok: true, favorites });
      }
      if (path === "/api/favorites") return jsonResponse({ ok: true, favorites });
      return jsonResponse({ ok: false }, 404);
    });
  });

  const renderPage = () => render(<MemoryRouter><Favorites /></MemoryRouter>);

  test("nom personnalisé affiché, nom réel en sous-titre", async () => {
    renderPage();
    expect(await screen.findByText("Maison")).toBeTruthy();
    expect(screen.getByText("Gare")).toBeTruthy();
  });

  test("« Mon ordre » : ordre de l'API, préférence mémorisée", async () => {
    renderPage();
    await screen.findByText("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Mon ordre" }));
    expect(loadSortPref()).toBe("custom");
    const names = [...document.querySelectorAll(".station-item-name")].map((n) => n.textContent);
    expect(names).toEqual(["Maison", "Zoo"]);
  });

  test("Organiser : renommer (validé à la sortie du champ)", async () => {
    renderPage();
    await screen.findByText("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Organiser" }));
    const input = screen.getByLabelText("Nom personnalisé pour Zoo");
    fireEvent.change(input, { target: { value: "Travail" } });
    fireEvent.blur(input);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/favorites/2", body: { label: "Travail" } });
  });

  test("Organiser : descendre un favori envoie le nouvel ordre", async () => {
    renderPage();
    await screen.findByText("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Organiser" }));
    expect(screen.getByRole("button", { name: "Monter Gare" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Descendre Gare" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/favorites/order")).toBe(true));
    expect(calls.find((c) => c.path === "/api/favorites/order").body).toEqual({ station_ids: ["2", "1"] });
    // Affichage mis à jour (optimiste puis réponse serveur)
    await waitFor(() => expect(screen.getByRole("button", { name: "Monter Zoo" }).disabled).toBe(true));
  });

  test("renommage inchangé → aucun appel", async () => {
    renderPage();
    await screen.findByText("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Organiser" }));
    fireEvent.blur(screen.getByLabelText("Nom personnalisé pour Gare"));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
