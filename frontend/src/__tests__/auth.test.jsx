import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth";
import { api, setToken, setStoredUser, getToken } from "../api";
import { jsonResponse } from "./setup";

vi.mock("../push", () => ({ syncPush: vi.fn(async () => true), unlinkPush: vi.fn(async () => {}) }));
import { syncPush, unlinkPush } from "../push";

function Protected() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
function Home() {
  const { user, logout } = useAuth();
  return <div><p>Bonjour {user?.username}</p><button onClick={logout}>sortir</button></div>;
}

const renderApp = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<p>Page de connexion</p>} />
        <Route element={<Protected />}><Route path="/" element={<Home />} /></Route>
      </Routes>
    </AuthProvider>
  </MemoryRouter>
);

describe("AuthProvider", () => {
  test("sans jeton → /login, aucun appel réseau", () => {
    renderApp();
    expect(screen.getByText("Page de connexion")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("au démarrage : renouvelle le jeton via /me puis synchronise le push", async () => {
    setToken("ancien");
    setStoredUser({ id: 1, username: "alice" });
    fetch.mockResolvedValue(jsonResponse({ ok: true, token: "neuf", user: { id: 1, username: "alice" } }));
    renderApp();
    expect(screen.getByText("Bonjour alice")).toBeTruthy();
    await waitFor(() => expect(getToken()).toBe("neuf"));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/api\/auth\/me$/);
    expect(syncPush).toHaveBeenCalled();
  });

  test("jeton expiré (401 sur /me) → redirection vers /login", async () => {
    setToken("expire");
    setStoredUser({ id: 1, username: "alice" });
    fetch.mockResolvedValue(jsonResponse({ ok: false, error: "Token invalide ou expiré" }, 401));
    renderApp();
    await screen.findByText("Page de connexion");
    expect(getToken()).toBeNull();
  });

  test("hors ligne au démarrage : la session est conservée", async () => {
    setToken("t");
    setStoredUser({ id: 1, username: "alice" });
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Bonjour alice")).toBeTruthy();
    expect(getToken()).toBe("t");
  });

  test("401 sur n'importe quel appel ultérieur → déconnexion", async () => {
    setToken("t");
    setStoredUser({ id: 1, username: "alice" });
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice" } }));
    renderApp();
    await waitFor(() => expect(syncPush).toHaveBeenCalled());
    fetch.mockResolvedValueOnce(jsonResponse({ ok: false }, 401));
    await act(async () => { await api("/api/favorites").catch(() => {}); });
    expect(screen.getByText("Page de connexion")).toBeTruthy();
  });

  test("logout : détache l'appareil AVANT de purger le jeton", async () => {
    setToken("t");
    setStoredUser({ id: 1, username: "alice" });
    fetch.mockResolvedValue(jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice" } }));
    let tokenDuringUnlink;
    unlinkPush.mockImplementation(async () => { tokenDuringUnlink = getToken(); });
    renderApp();
    await act(async () => { screen.getByText("sortir").click(); });
    await screen.findByText("Page de connexion");
    expect(tokenDuringUnlink).toBe("t");
    expect(getToken()).toBeNull();
  });
});
