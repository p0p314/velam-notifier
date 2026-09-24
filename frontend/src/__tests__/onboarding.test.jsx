import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { onboardingSteps, isOnboardingDone, markOnboardingDone } from "../lib/onboarding";
import { jsonResponse } from "./setup";

const pwa = { isMobile: true, isInstalled: false };
vi.mock("../components/PwaInstallContext", () => ({ usePwaInstall: () => ({ ...pwa, open: () => {} }) }));
import Onboarding from "../components/Onboarding";

describe("onboardingSteps", () => {
  const base = { isMobile: true, isInstalled: false, permission: "default", favoritesCount: 0 };
  test("nouvel utilisateur mobile : les 3 étapes, dans l'ordre", () => {
    expect(onboardingSteps(base)).toEqual(["install", "notifications", "favorites"]);
  });
  test("étapes déjà satisfaites omises", () => {
    expect(onboardingSteps({ ...base, isInstalled: true })).toEqual(["notifications", "favorites"]);
    expect(onboardingSteps({ ...base, isMobile: false, permission: "granted", favoritesCount: 2 })).toEqual([]);
    expect(onboardingSteps({ ...base, permission: "unsupported" })).toEqual(["install", "favorites"]);
    expect(onboardingSteps({ ...base, permission: "denied" })).not.toContain("notifications");
  });
  test("mémorisation", () => {
    expect(isOnboardingDone()).toBe(false);
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
  });
});

describe("<Onboarding />", () => {
  let favorites, requestPermission;
  beforeEach(() => {
    pwa.isMobile = true;
    pwa.isInstalled = false;
    favorites = [];
    requestPermission = vi.fn(async () => { window.Notification.permission = "granted"; return "granted"; });
    window.PushManager = function PushManager() {};
    const pushManager = {
      getSubscription: async () => null,
      subscribe: async () => ({ endpoint: "https://push.example.com/x", toJSON: () => ({ endpoint: "https://push.example.com/x" }) }),
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
    window.Notification = { permission: "default", requestPermission };
    fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/vapid-public-key")) return jsonResponse({ ok: true, publicKey: "AQID" });
      if (u.endsWith("/api/push/subscribe")) return jsonResponse({ ok: true }, 201);
      return jsonResponse({ ok: true, favorites });
    });
  });

  const renderIt = () => render(
    <MemoryRouter initialEntries={["/favoris"]}>
      <Routes>
        <Route path="/favoris" element={<Onboarding />} />
        <Route path="/stations" element={<p>Page stations</p>} />
      </Routes>
    </MemoryRouter>
  );

  test("parcours complet : installer → notifications → favoris", async () => {
    renderIt();
    expect(await screen.findByText("Installez l'app")).toBeTruthy();
    expect(screen.getByText("Étape 1 sur 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    expect(screen.getByText("Activez les notifications")).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled(); // jamais automatique
    fireEvent.click(screen.getByRole("button", { name: "Activer les notifications" }));
    expect(await screen.findByText("Notifications activées")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    expect(screen.getByText("Ajoutez vos stations")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Parcourir les stations" }));
    expect(await screen.findByText("Page stations")).toBeTruthy();
    expect(isOnboardingDone()).toBe(true);
  });

  test("« Passer » clôt définitivement, et reporte la modale d'installation à demain", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Passer" }));
    expect(screen.queryByText("Installez l'app")).toBeNull();
    expect(isOnboardingDone()).toBe(true);
    expect(localStorage.getItem("pwa-modal-dismissed")).toBe(new Date().toISOString().slice(0, 10));
  });

  test("utilisateur déjà équipé : rien ne s'affiche, et c'est mémorisé", async () => {
    pwa.isInstalled = true;
    window.Notification.permission = "granted";
    favorites = [{ station_id: "1", station_name: "Gare" }];
    renderIt();
    await waitFor(() => expect(isOnboardingDone()).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("déjà terminé : aucune requête réseau", () => {
    markOnboardingDone();
    renderIt();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("desktop, notifications accordées : seule l'étape favoris, bouton final", async () => {
    pwa.isMobile = false;
    window.Notification.permission = "granted";
    renderIt();
    expect(await screen.findByText("Ajoutez vos stations")).toBeTruthy();
    expect(screen.getByText("Étape 1 sur 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Suivant|Terminer/ })).toBeNull();
  });
});
