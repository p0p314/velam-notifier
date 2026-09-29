import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TUTORIAL_SLIDES, tutorialPending } from "../lib/tutorial";
import Tutorial from "../components/Tutorial";
import { jsonResponse } from "./setup";

describe("tutorialPending", () => {
  test("seulement si le serveur dit « jamais vu »", () => {
    expect(tutorialPending({ id: 1, tutorial_done: false })).toBe(true);
    expect(tutorialPending({ id: 1, tutorial_done: true })).toBe(false);
    expect(tutorialPending({ id: 1 })).toBe(false); // utilisateur mémorisé avant la v1.5
    expect(tutorialPending(null)).toBe(false);
  });
  test("slides complètes et titres distincts", () => {
    expect(TUTORIAL_SLIDES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(TUTORIAL_SLIDES.map((s) => s.title)).size).toBe(TUTORIAL_SLIDES.length);
    for (const s of TUTORIAL_SLIDES) expect(s.icon && s.title && s.text).toBeTruthy();
  });
});

describe("<Tutorial />", () => {
  const n = TUTORIAL_SLIDES.length;

  test("« Suivant » parcourt les slides, « C'est parti » termine", () => {
    const onClose = vi.fn();
    render(<Tutorial onClose={onClose} />);
    expect(screen.getByText(TUTORIAL_SLIDES[0].title)).toBeTruthy();
    expect(screen.getByText(`1 / ${n}`)).toBeTruthy();
    for (let i = 1; i < n; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      expect(screen.getByText(TUTORIAL_SLIDES[i].title)).toBeTruthy();
    }
    // Dernière slide : plus de « Suivant » ni d'« Arrêter ».
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Arrêter le tutoriel" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "C'est parti" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("« Arrêter le tutoriel » ferme à tout moment", () => {
    const onClose = vi.fn();
    render(<Tutorial onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrêter le tutoriel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("glisser au doigt et points de navigation", () => {
    render(<Tutorial onClose={() => {}} />);
    const zone = document.querySelector(".tutorial");
    fireEvent.touchStart(zone, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(zone, { changedTouches: [{ clientX: 100 }] });
    expect(screen.getByText(TUTORIAL_SLIDES[1].title)).toBeTruthy();
    fireEvent.touchStart(zone, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(zone, { changedTouches: [{ clientX: 300 }] });
    expect(screen.getByText(TUTORIAL_SLIDES[0].title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`étape ${n} :`) }));
    expect(screen.getByText(TUTORIAL_SLIDES[n - 1].title)).toBeTruthy();
  });
});

describe("première connexion", () => {
  vi.mock("../components/PwaInstallContext", () => ({
    usePwaInstall: () => ({ isMobile: false, isInstalled: true, open: () => {} }),
    PwaInstallProvider: ({ children }) => children,
  }));

  const renderLayout = async () => {
    const { AuthProvider } = await import("../auth");
    const { Layout } = await import("../App");
    return render(
      <MemoryRouter initialEntries={["/favoris"]}>
        <AuthProvider>
          <Routes><Route element={<Layout />}><Route path="/favoris" element={<p>Favoris</p>} /></Route></Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  };

  test("tutoriel montré puis mémorisé sur le compte ; « Arrêter » compte comme vu", async () => {
    localStorage.setItem("velam_token", "t");
    fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/auth/me")) return jsonResponse({ ok: true, token: "t2", user: { id: 1, username: "a", tutorial_done: false } });
      return jsonResponse({ ok: true, favorites: [] });
    });
    await renderLayout();
    expect(await screen.findByText(TUTORIAL_SLIDES[0].title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arrêter le tutoriel" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => String(u).endsWith("/api/auth/tutorial") && o?.method === "POST")).toBe(true));
    expect(screen.queryByText(TUTORIAL_SLIDES[0].title)).toBeNull();
    expect(JSON.parse(localStorage.getItem("velam_user")).tutorial_done).toBe(true);
  });

  test("tutoriel déjà vu : jamais remontré", async () => {
    localStorage.setItem("velam_token", "t");
    fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/auth/me")) return jsonResponse({ ok: true, token: "t2", user: { id: 1, username: "a", tutorial_done: true } });
      return jsonResponse({ ok: true, favorites: [] });
    });
    await renderLayout();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText(TUTORIAL_SLIDES[0].title)).toBeNull();
  });
});
