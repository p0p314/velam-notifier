import { describe, test, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import Login, { validateAuth } from "../pages/Login";
import StationListItem from "../components/StationListItem";
import { jsonResponse } from "./setup";

describe("validateAuth", () => {
  const ok = { mode: "register", username: "alice", password: "motdepasse1", confirm: "motdepasse1" };
  test("inscription : nom, longueur du mot de passe, confirmation", () => {
    expect(validateAuth(ok)).toBeNull();
    expect(validateAuth({ ...ok, username: "  " })).toMatch(/nom d'utilisateur/);
    expect(validateAuth({ ...ok, username: "x".repeat(33) })).toMatch(/32 caractères/);
    expect(validateAuth({ ...ok, password: "court", confirm: "court" })).toMatch(/au moins 8/);
    expect(validateAuth({ ...ok, confirm: "autre-chose" })).toMatch(/ne correspondent pas/);
  });
  test("connexion : pas de règle de longueur ni de confirmation", () => {
    expect(validateAuth({ mode: "login", username: "alice", password: "x", confirm: "" })).toBeNull();
    expect(validateAuth({ mode: "login", username: "alice", password: "", confirm: "" })).toMatch(/mot de passe/);
  });
});

describe("<Login />", () => {
  const renderLogin = () => render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>Accueil</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  test("inscription : confirmation requise, erreur sans appel serveur", () => {
    renderLogin();
    expect(screen.queryByLabelText("Confirmer le mot de passe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inscription" }));
    type("Nom d'utilisateur", "alice");
    type("Mot de passe", "motdepasse1");
    type("Confirmer le mot de passe", "motdepasse2");
    fireEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    expect(screen.getByRole("alert").textContent).toMatch(/ne correspondent pas/);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("inscription réussie : compte créé, redirection", async () => {
    fetch.mockImplementation(async () => jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice", tutorial_done: false } }, 201));
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Inscription" }));
    type("Nom d'utilisateur", " alice ");
    type("Mot de passe", "motdepasse1");
    type("Confirmer le mot de passe", "motdepasse1");
    fireEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    expect(await screen.findByText("Accueil")).toBeTruthy();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/register$/);
    expect(JSON.parse(init.body)).toEqual({ username: "alice", password: "motdepasse1" });
  });

  test("afficher / masquer le mot de passe ; pas de majuscule automatique", () => {
    renderLogin();
    const input = screen.getByLabelText("Mot de passe");
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(input.type).toBe("text");
    expect(screen.getByLabelText("Nom d'utilisateur").getAttribute("autocapitalize")).toBe("none");
  });

  test("erreur du serveur affichée", async () => {
    fetch.mockImplementation(async () => jsonResponse({ ok: false, error: "Identifiants incorrects" }, 401));
    renderLogin();
    type("Nom d'utilisateur", "alice");
    type("Mot de passe", "faux");
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Identifiants incorrects"));
  });
});

describe("carte de station : état en pastille seule", () => {
  test("pas de libellé visible ; état au survol et dans le libellé accessible", () => {
    const { container } = render(<StationListItem s={{ station_id: "1", name: "Gare", electrical: 5, mechanical: 5, is_renting: false }} />);
    expect(screen.queryByText("Hors service")).toBeNull();
    expect(container.querySelector(".status-dot.closed").getAttribute("title")).toBe("Hors service");
    expect(screen.getByRole("button", { name: "Gare, hors service, voir le détail" })).toBeTruthy();
  });
});
