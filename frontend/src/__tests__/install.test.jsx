import { describe, test, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../useTheme";
import { AuthProvider } from "../auth";
import { PwaInstallProvider } from "../components/PwaInstallContext";
import { Layout } from "../App";
import { setToken, setStoredUser } from "../api";
import { ONBOARDING_KEY } from "../lib/onboarding";
import { jsonResponse } from "./setup";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const setUserAgent = (ua) => Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua });

function renderLayout() {
  setToken("t");
  setStoredUser({ id: 1, username: "alice" });
  localStorage.setItem(ONBOARDING_KEY, "1");
  localStorage.setItem("pwa-modal-dismissed", new Date().toISOString().slice(0, 10)); // pas de modale auto
  fetch.mockImplementation(async () => jsonResponse({ ok: true, token: "t", user: { id: 1, username: "alice" } }));
  return render(
    <MemoryRouter>
      <ThemeProvider><AuthProvider><PwaInstallProvider><Layout /></PwaInstallProvider></AuthProvider></ThemeProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  delete navigator.standalone;
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) jsdom");
});

describe("bouton d'installation", () => {
  test("mobile, app non installée : bouton proposé (en-tête et barre)", () => {
    setUserAgent(IPHONE);
    renderLayout();
    expect(screen.getByRole("button", { name: "Installer l'app" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Installer$/ })).toBeTruthy();
  });

  test("app déjà installée (lancée depuis l'écran d'accueil) : aucun bouton", () => {
    setUserAgent(IPHONE);
    navigator.standalone = true;
    renderLayout();
    expect(screen.queryByRole("button", { name: "Installer l'app" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Installer$/ })).toBeNull();
  });

  test("mode standalone détecté par display-mode (Android)", () => {
    setUserAgent(IPHONE);
    window.matchMedia = (query) => ({
      matches: query.includes("standalone"), media: query,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
    renderLayout();
    expect(screen.queryByRole("button", { name: "Installer l'app" })).toBeNull();
  });

  test("accès aux Paramètres depuis l'en-tête", () => {
    renderLayout();
    expect(screen.getByRole("button", { name: "Paramètres" })).toBeTruthy();
  });
});
