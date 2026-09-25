import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import { setToken, setStoredUser, getToken } from "../api";
import Account from "../pages/Account";
import Privacy from "../pages/Privacy";
import Login from "../pages/Login";
import { jsonResponse } from "./setup";

vi.mock("../push", () => ({ syncPush: vi.fn(async () => true), unlinkPush: vi.fn(async () => {}) }));

let calls;
const lastCall = (method, path) => calls.filter((c) => c.method === method && c.path === path).at(-1);

function mockApi(handlers = {}) {
  fetch.mockImplementation(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const h = handlers[`${method} ${path}`];
    if (h) return h(body);
    if (path === "/api/auth/me" && method === "GET") return jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice" } });
    return jsonResponse({ ok: true });
  });
}

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AuthProvider>
      <Routes>
        <Route path="/compte" element={<Account />} />
        <Route path="/confidentialite" element={<Privacy />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>
);

beforeEach(() => {
  calls = [];
  setToken("t");
  setStoredUser({ id: 1, username: "alice" });
});

describe("Mon compte", () => {
  test("affiche le compte et rappelle l'absence d'e-mail", async () => {
    mockApi();
    renderAt("/compte");
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText(/ne peut pas être récupéré/)).toBeTruthy();
  });

  test("changer le mot de passe", async () => {
    mockApi();
    renderAt("/compte");
    const form = within(screen.getByRole("form", { name: "Changer le mot de passe" }));
    fireEvent.change(form.getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } });
    fireEvent.change(form.getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.change(form.getByLabelText("Confirmer le nouveau mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.click(form.getByRole("button", { name: "Enregistrer" }));
    expect(await form.findByText("Mot de passe modifié.")).toBeTruthy();
    expect(lastCall("PUT", "/api/auth/password").body).toEqual({ current_password: "ancien-mdp", new_password: "nouveau-mdp" });
  });

  test("changer le mot de passe : confirmation différente → aucun envoi", async () => {
    mockApi();
    renderAt("/compte");
    const form = within(screen.getByRole("form", { name: "Changer le mot de passe" }));
    fireEvent.change(form.getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } });
    fireEvent.change(form.getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.change(form.getByLabelText("Confirmer le nouveau mot de passe"), { target: { value: "autre-mdp" } });
    fireEvent.click(form.getByRole("button", { name: "Enregistrer" }));
    expect(await form.findByText(/ne correspondent pas/)).toBeTruthy();
    expect(lastCall("PUT", "/api/auth/password")).toBeUndefined();
  });

  test("mot de passe actuel incorrect : message du serveur", async () => {
    mockApi({ "PUT /api/auth/password": () => jsonResponse({ ok: false, error: "Mot de passe actuel incorrect" }, 403) });
    renderAt("/compte");
    const form = within(screen.getByRole("form", { name: "Changer le mot de passe" }));
    for (const [label, v] of [["Mot de passe actuel", "x"], ["Nouveau mot de passe", "nouveau-mdp"], ["Confirmer le nouveau mot de passe", "nouveau-mdp"]]) {
      fireEvent.change(form.getByLabelText(label), { target: { value: v } });
    }
    fireEvent.click(form.getByRole("button", { name: "Enregistrer" }));
    expect(await form.findByText("Mot de passe actuel incorrect")).toBeTruthy();
    expect(getToken()).toBe("t"); // un 403 ne déconnecte pas
  });

  test("supprimer le compte : confirmation par mot de passe, puis retour à la connexion", async () => {
    mockApi();
    renderAt("/compte");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte…" }));
    const form = within(screen.getByRole("form", { name: "Supprimer le compte" }));
    fireEvent.change(form.getByLabelText("Mot de passe"), { target: { value: "motdepasse1" } });
    fireEvent.click(form.getByRole("button", { name: "Supprimer définitivement" }));
    expect(await screen.findByText("Votre compte et toutes vos données ont été supprimés.")).toBeTruthy();
    expect(lastCall("DELETE", "/api/auth/me").body).toEqual({ password: "motdepasse1" });
    expect(getToken()).toBeNull();
  });

  test("supprimer le compte : annuler ne supprime rien", async () => {
    mockApi();
    renderAt("/compte");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte…" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("button", { name: "Supprimer mon compte…" })).toBeTruthy();
    expect(lastCall("DELETE", "/api/auth/me")).toBeUndefined();
  });
});

describe("Confidentialité et inscription", () => {
  test("la page liste les données, les droits et les tiers (Mapbox)", () => {
    mockApi();
    renderAt("/confidentialite");
    expect(screen.getByText("Ce que VéloPulse enregistre")).toBeTruthy();
    expect(screen.getByText("Vos droits")).toBeTruthy();
    expect(screen.getByText("Mapbox")).toBeTruthy();
  });

  test("inscription : avertissement mot de passe non récupérable", () => {
    setToken(null); localStorage.clear();
    mockApi();
    renderAt("/login");
    expect(screen.queryByText(/ne pourra pas être récupéré/)).toBeNull();
    fireEvent.click(screen.getByText("Inscription"));
    expect(screen.getByText(/ne pourra pas être récupéré/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Confidentialité" }).getAttribute("href")).toBe("/confidentialite");
  });
});
