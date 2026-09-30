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
    if (path.startsWith("/api/alerts/") && method === "DELETE") {
      alerts = alerts.filter((a) => `/api/alerts/${a.id}` !== path);
      return jsonResponse({ ok: true });
    }
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

describe("carte d'alerte", () => {
  const base = { id: 5, active: 1, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most",
    bike_type: "ebike", threshold: 1, time_start: "08:00", time_end: "09:00", days: "1,2", valid_on: null,
    group_name: null, group_stations: null };
  const card = () => within(document.querySelector(".alert-card"));

  test("type d'alerte et type de vélo en icônes, pas en texte", async () => {
    alerts = [base];
    renderPage();
    await screen.findByText("≤ 1 vélo · 08:00–09:00");
    expect(card().getByRole("img", { name: "Alerte de disponibilité" })).toBeTruthy();
    expect(card().getByRole("img", { name: "Vélos électriques" })).toBeTruthy();
    expect(document.querySelector(".alert-card").textContent).not.toMatch(/électrique/);
  });

  test("jours modifiables directement sur la carte", async () => {
    alerts = [base];
    renderPage();
    await screen.findByText("≤ 1 vélo · 08:00–09:00");
    fireEvent.click(card().getByRole("button", { name: "vendredi" }));
    expect(card().getByRole("button", { name: "vendredi" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ days: "1,2,5" }));
  });

  test("supprimer : bouton révélé en glissant la carte", async () => {
    alerts = [base];
    renderPage();
    await screen.findByText("≤ 1 vélo · 08:00–09:00");
    // jsdom n'a pas de PointerEvent (clientX serait perdu) : équivalent souris.
    window.PointerEvent ??= class extends MouseEvent {
      constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; }
    };
    const fg = document.querySelector(".swipe-fg");
    fireEvent.pointerDown(fg, { clientX: 300, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(fg, { clientX: 200, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(fg, { clientX: 200, clientY: 12, pointerId: 1 });
    const del = screen.getByRole("button", { name: "Supprimer Gare" });
    expect(del.getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/alerts/5")).toBe(true));
  });

  test("supprimer : carte retirée tout de suite ; déjà supprimée (404) → aucun message d'erreur", async () => {
    alerts = [base];
    renderPage();
    await screen.findByText("≤ 1 vélo · 08:00–09:00");
    let answer;
    fetch.mockImplementationOnce(() => new Promise((r) => { answer = r; })); // serveur lent
    fireEvent.click(document.querySelector(".swipe-delete"));
    expect(document.querySelector(".alert-card")).toBeNull();
    answer(jsonResponse({ ok: false, error: "Alerte introuvable" }, 404));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Alerte introuvable")).toBeNull();
  });

  test("supprimer depuis le formulaire de modification, après confirmation", async () => {
    alerts = [base];
    renderPage();
    await screen.findByText("≤ 1 vélo · 08:00–09:00");
    fireEvent.click(screen.getByTitle("Modifier l'alerte"));
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: /Supprimer l'alerte/ }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(f.getByRole("button", { name: /Confirmer la suppression/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/alerts/5")).toBe(true));
    expect(within(form()).getByText("Nouvelle alerte")).toBeTruthy(); // formulaire refermé
  });
});

describe("dupliquer une alerte", () => {
  test("formulaire de création pré-rempli, rien n'est créé avant validation", async () => {
    alerts = [{ id: 5, active: 0, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_least",
      bike_type: "ebike", threshold: 3, time_start: "08:00", time_end: "09:00", days: "1,2", valid_on: null,
      group_name: "Maison", group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "9", station_name: "Cirque" }] }];
    renderPage();
    await screen.findByText("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Dupliquer" }));
    const f = within(form());
    expect(f.getByText("Dupliquer l'alerte")).toBeTruthy();
    expect(f.getByLabelText("Nom du groupe").value).toBe("Maison (copie)");
    // Station du groupe hors favoris quand même proposée et cochée.
    expect(f.getByRole("checkbox", { name: "Cirque" }).checked).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(f.getByLabelText("Début"), { target: { value: "17:00" } });
    fireEvent.change(f.getByLabelText("Fin"), { target: { value: "18:00" } });
    fireEvent.click(f.getByRole("button", { name: "Créer la copie" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({
      group_name: "Maison (copie)", comparison: "at_least", bike_type: "ebike", threshold: 3,
      time_start: "17:00", time_end: "18:00", days: "1,2",
      group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "9", station_name: "Cirque" }],
    });
    // L'original n'est pas modifié.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

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

describe("groupe de stations", () => {
  test("création : stations cochées, nom, règle expliquée, pas de trajet", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Plusieurs stations" }));
    expect(f.queryByLabelText("Station")).toBeNull();
    expect(f.queryByLabelText(/Trajet/)).toBeNull();
    // La station déjà choisie (1er favori) est pré-cochée.
    expect(f.getByRole("checkbox", { name: "Gare" }).checked).toBe(true);
    expect(f.getByText("Alerte seulement quand toutes les stations ont au plus 1 vélo.")).toBeTruthy();

    // Une seule station → refus côté client.
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    expect((await f.findByRole("alert")).textContent).toMatch(/de 2 à 5 stations/);
    expect(lastPost()).toBeUndefined();

    fireEvent.click(f.getByRole("checkbox", { name: "Zoo" }));
    fireEvent.change(f.getByLabelText("Nom du groupe"), { target: { value: "Maison" } });
    fireEvent.click(f.getByRole("button", { name: "Créer l'alerte" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({
      station_id: "1", group_name: "Maison", arrival_station_id: null,
      group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "2", station_name: "Zoo" }],
    });
  });

  test("carte et édition d'un groupe", async () => {
    alerts = [{ id: 5, active: 1, station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most",
      bike_type: "any", threshold: 0, time_start: "08:00", time_end: "09:00", days: "1,2,3,4,5", valid_on: null,
      group_name: "Maison", group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "9", station_name: "Cirque" }] }];
    renderPage();
    expect(await screen.findByText("Maison")).toBeTruthy();
    expect(screen.getByText("≤ 0 vélo · 08:00–09:00")).toBeTruthy();
    expect(document.querySelector(".alert-card").textContent).not.toMatch(/Cirque/); // groupe nommé : pas la liste des stations

    fireEvent.click(screen.getByTitle("Modifier l'alerte"));
    const f = within(form());
    // Station du groupe hors favoris quand même proposée et cochée.
    expect(f.getByRole("checkbox", { name: "Cirque" }).checked).toBe(true);
    expect(f.getByLabelText("Nom du groupe").value).toBe("Maison");

    // Repasser en « Une station » : le PATCH efface le groupe.
    fireEvent.click(f.getByRole("button", { name: "Une station" }));
    fireEvent.click(f.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH").body).toMatchObject({ station_id: "1", group_stations: null, group_name: null });
  });
});

describe("résumé à heure fixe", () => {
  test("création : type séparé, seuls les champs utiles, payload correct", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Résumé à heure fixe" }));
    expect(f.getByText(/le nombre de vélos de vos stations/)).toBeTruthy();
    // Champs propres aux alertes de disponibilité masqués.
    for (const name of ["Surveiller", "Me prévenir quand", "Stations surveillées"]) expect(f.queryByRole("group", { name })).toBeNull();
    expect(f.queryByLabelText("Seuil")).toBeNull();
    expect(f.queryByLabelText("Début")).toBeNull();
    expect(f.queryByLabelText(/Aujourd'hui seulement/)).toBeNull();
    // Une seule station (pré-cochée) suffit.
    expect(f.getByRole("checkbox", { name: "Gare" }).checked).toBe(true);

    fireEvent.click(f.getByRole("button", { name: "Électrique" }));
    fireEvent.change(f.getByLabelText("Heure d'envoi"), { target: { value: "07:40" } });
    fireEvent.click(f.getByRole("button", { name: "Créer le résumé" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({
      kind: "summary", bike_type: "ebike", send_times: ["07:40"], time_start: "07:40", time_end: "07:40",
      group_stations: [{ station_id: "1", station_name: "Gare" }],
    });
  });

  test("plusieurs heures d'envoi : ajout, retrait, envoi trié", async () => {
    await ready();
    const f = within(form());
    fireEvent.click(f.getByRole("button", { name: "Résumé à heure fixe" }));
    fireEvent.change(f.getByLabelText("Heure d'envoi"), { target: { value: "18:00" } });
    fireEvent.click(f.getByRole("button", { name: "Ajouter une heure" }));
    fireEvent.click(f.getByRole("button", { name: "Ajouter une heure" }));
    expect(f.getByLabelText("Heure d'envoi 3")).toBeTruthy();
    fireEvent.click(f.getByRole("button", { name: "Retirer l'heure 20:00" }));
    fireEvent.change(f.getByLabelText("Heure d'envoi 2"), { target: { value: "07:45" } });
    fireEvent.click(f.getByRole("button", { name: "Créer le résumé" }));
    await waitFor(() => expect(lastPost()).toBeTruthy());
    expect(lastPost()).toMatchObject({ send_times: ["07:45", "18:00"], time_start: "07:45" });
  });

  test("carte d'un résumé", async () => {
    alerts = [{ id: 8, active: 1, kind: "summary", station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most",
      bike_type: "any", threshold: 0, time_start: "07:40", time_end: "07:40", days: "1,2,3,4,5", valid_on: null,
      group_name: null, group_stations: [{ station_id: "1", station_name: "Gare" }, { station_id: "2", station_name: "Zoo" }] }];
    renderPage();
    expect(await screen.findByText("Gare, Zoo")).toBeTruthy();
    expect(screen.getByText("07:40")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Résumé à heure fixe" })).toBeTruthy();
  });

  test("carte d'un résumé à plusieurs heures", async () => {
    alerts = [{ id: 9, active: 1, kind: "summary", station_id: "1", station_name: "Gare", target: "bikes", comparison: "at_most",
      bike_type: "any", threshold: 0, time_start: "07:40", time_end: "07:40", send_times: ["07:40", "17:30"], days: "1,2,3,4,5",
      valid_on: null, group_name: "Maison", group_stations: [{ station_id: "1", station_name: "Gare" }] }];
    renderPage();
    expect(await screen.findByText("Maison")).toBeTruthy();
    expect(screen.getByText("07:40, 17:30")).toBeTruthy();
    expect(document.querySelector(".alert-card").textContent).not.toMatch(/Gare/);
  });
});

describe("créneau par défaut", () => {
  test("nouvelle alerte : de l'heure actuelle à +30 min", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2025, 8, 24, 18, 7));
    try {
      await ready();
      const f = within(form());
      expect(f.getByLabelText("Début").value).toBe("18:07");
      expect(f.getByLabelText("Fin").value).toBe("18:37");
    } finally {
      vi.useRealTimers();
    }
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
    fireEvent.click(await screen.findByTitle("Modifier l'alerte"));
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

describe("filtre et tri de la liste", () => {
  const base = { active: 1, target: "bikes", comparison: "at_most", bike_type: "any", threshold: 1, days: "1,2,3,4,5", valid_on: null };
  const names = () => [...document.querySelectorAll(".alertes-list .alert-card-name")].map((n) => n.textContent);

  test("tri par heure, puis par nom ; filtre par type ; choix mémorisés", async () => {
    alerts = [
      { ...base, id: 1, station_id: "2", station_name: "Zoo", time_start: "08:00", time_end: "09:00" },
      { ...base, id: 2, station_id: "1", station_name: "Gare", time_start: "17:00", time_end: "18:00" },
      { ...base, id: 3, kind: "summary", station_id: "1", station_name: "Gare", time_start: "07:00", time_end: "07:00",
        group_name: "Matin", group_stations: [{ station_id: "1", station_name: "Gare" }] },
    ];
    const { unmount } = renderPage();
    await screen.findByText("Matin");
    expect(names()).toEqual(["Matin", "Zoo", "Gare"]);

    fireEvent.change(screen.getByLabelText("Trier les alertes"), { target: { value: "name" } });
    expect(names()).toEqual(["Gare", "Matin", "Zoo"]);

    const filters = within(screen.getByRole("group", { name: "Filtrer les alertes" }));
    fireEvent.click(filters.getByRole("button", { name: "Résumés" }));
    expect(names()).toEqual(["Matin"]);

    unmount();
    renderPage();
    await screen.findByText("Matin");
    expect(names()).toEqual(["Matin"]);
    expect(screen.getByLabelText("Trier les alertes").value).toBe("name");
  });

  test("un seul type : pas de filtre (et filtre mémorisé ignoré) ; une seule alerte : aucun contrôle", async () => {
    localStorage.setItem("velopulse-alerts-list", JSON.stringify({ filter: "summary", sort: "time" }));
    alerts = [
      { ...base, id: 1, station_id: "2", station_name: "Zoo", time_start: "08:00", time_end: "09:00" },
      { ...base, id: 2, station_id: "1", station_name: "Gare", time_start: "07:00", time_end: "09:00" },
    ];
    const { unmount } = renderPage();
    await screen.findByText("Zoo", { selector: ".alert-card-name" });
    expect(screen.queryByRole("group", { name: "Filtrer les alertes" })).toBeNull();
    expect(names()).toEqual(["Gare", "Zoo"]);

    unmount();
    alerts = alerts.slice(0, 1);
    renderPage();
    await screen.findByText("Zoo", { selector: ".alert-card-name" });
    expect(screen.queryByLabelText("Trier les alertes")).toBeNull();
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
  test("absente de la page Alertes (elle est dans Paramètres)", async () => {
    await ready();
    expect(screen.queryByRole("button", { name: "Tester" })).toBeNull();
    expect(screen.queryByText(/Notifications activées/)).toBeNull();
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
