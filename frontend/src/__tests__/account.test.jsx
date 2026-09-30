import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import { setToken, setStoredUser, getToken } from "../api";
import Account from "../pages/Account";
import Privacy from "../pages/Privacy";
import Login from "../pages/Login";
import { jsonResponse } from "./setup";
import { ThemeProvider } from "../useTheme";

// Faux module de notifications : `push.state` pilote l'état de cet appareil.
const push = vi.hoisted(() => ({ state: "on" }));
vi.mock("../push", () => ({
  syncPush: vi.fn(async () => true),
  unlinkPush: vi.fn(async () => {}),
  pushStatus: () => push.state,
  currentPushEndpoint: vi.fn(async () => (push.state === "on" ? "https://push.example.com/ici" : null)),
  enablePush: vi.fn(async () => { push.state = "on"; return "granted"; }),
  disablePush: vi.fn(async () => { push.state = "off"; }),
}));

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
  push.state = "on";
  setToken("t");
  setStoredUser({ id: 1, username: "alice" });
});

const SECU = "/compte?onglet=securite";
const NOTIF = "/compte?onglet=notifications";
const SESSIONS = [
  { id: "s1", label: "iPhone · Safari", created_at: 1, last_seen_at: Date.now(), current: true },
  { id: "s2", label: "Windows · Edge", created_at: 1, last_seen_at: Date.now() - 86_400_000 * 3, current: false },
];

describe("Paramètres — Sécurité", () => {
  test("déconnecter tous les autres appareils : cet appareil garde un jeton neuf", async () => {
    mockApi({
      "GET /api/auth/sessions": () => jsonResponse({ ok: true, sessions: SESSIONS }),
      "POST /api/auth/logout-others": () => jsonResponse({ ok: true, token: "jeton-neuf", user: { id: 1, username: "alice" }, devices: 2 }),
    });
    renderAt(SECU);
    fireEvent.click(await screen.findByRole("button", { name: "Déconnecter tous les autres appareils" }));
    expect(await screen.findByText("Tous vos autres appareils ont été déconnectés.")).toBeTruthy();
    expect(lastCall("POST", "/api/auth/logout-others").body).toEqual({ endpoint: "https://push.example.com/ici" });
    expect(getToken()).toBe("jeton-neuf");
  });

  test("déconnecter les autres appareils : sans notifications, aucun appareil conservé", async () => {
    push.state = "off";
    mockApi({ "GET /api/auth/sessions": () => jsonResponse({ ok: true, sessions: SESSIONS }) });
    renderAt(SECU);
    fireEvent.click(await screen.findByRole("button", { name: "Déconnecter tous les autres appareils" }));
    await waitFor(() => expect(lastCall("POST", "/api/auth/logout-others")).toBeTruthy());
    expect(lastCall("POST", "/api/auth/logout-others").body).toEqual({});
    expect(getToken()).toBe("t"); // réponse sans jeton : session inchangée
  });

  test("changer le mot de passe", async () => {
    mockApi({ "PUT /api/auth/password": () => jsonResponse({ ok: true, token: "jeton-neuf", user: { id: 1, username: "alice" } }) });
    renderAt(SECU);
    const form = within(screen.getByRole("form", { name: "Changer le mot de passe" }));
    fireEvent.change(form.getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } });
    fireEvent.change(form.getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.change(form.getByLabelText("Confirmer le nouveau mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.click(form.getByRole("button", { name: "Enregistrer" }));
    expect(await form.findByText(/Mot de passe modifié\. Vos autres appareils ont été déconnectés/)).toBeTruthy();
    // L'appareil courant est désigné pour garder ses notifications.
    expect(lastCall("PUT", "/api/auth/password").body).toEqual({
      current_password: "ancien-mdp", new_password: "nouveau-mdp", endpoint: "https://push.example.com/ici",
    });
    expect(getToken()).toBe("jeton-neuf"); // l'ancien jeton est révoqué côté serveur
  });

  test("changer le mot de passe : confirmation différente → aucun envoi", async () => {
    mockApi();
    renderAt(SECU);
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
    renderAt(SECU);
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
    renderAt(SECU);
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
    renderAt(SECU);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte…" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("button", { name: "Supprimer mon compte…" })).toBeTruthy();
    expect(lastCall("DELETE", "/api/auth/me")).toBeUndefined();
  });
});

describe("Paramètres — Appareils connectés", () => {
  test("liste : appareil courant signalé, déconnexion d'un autre appareil puis rechargement", async () => {
    let sessions = SESSIONS;
    mockApi({
      "GET /api/auth/sessions": () => jsonResponse({ ok: true, sessions }),
      "DELETE /api/auth/sessions/s2": () => { sessions = SESSIONS.slice(0, 1); return jsonResponse({ ok: true }); },
    });
    renderAt(SECU);
    const list = within(await screen.findByRole("list", { name: "Appareils connectés" }));
    expect(list.getByText("Cet appareil")).toBeTruthy();
    expect(list.getByText(/Dernière activité le /)).toBeTruthy();
    expect(list.queryByRole("button", { name: "Déconnecter iPhone · Safari" })).toBeNull();

    fireEvent.click(list.getByRole("button", { name: "Déconnecter Windows · Edge" }));
    expect(await screen.findByText("Windows · Edge a été déconnecté.")).toBeTruthy();
    expect(lastCall("DELETE", "/api/auth/sessions/s2")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Windows · Edge")).toBeNull());
    // Plus aucun autre appareil : pas de bouton « tous les autres ».
    expect(screen.queryByRole("button", { name: "Déconnecter tous les autres appareils" })).toBeNull();
  });
});

describe("Paramètres — Mes données", () => {
  test("export : fichier JSON téléchargé", async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => { created.push(blob); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockApi({ "GET /api/auth/export": () => jsonResponse({ ok: true, export: { account: { username: "alice" }, favorites: [] } }) });
    renderAt(SECU);
    fireEvent.click(screen.getByRole("button", { name: "Exporter mes données" }));
    expect(await screen.findByText("Fichier téléchargé.")).toBeTruthy();
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise((resolve) => {
      const reader = new FileReader(); // Blob de jsdom : ni .text() ni lecture par Response
      reader.onload = () => resolve(reader.result);
      reader.readAsText(created[0]);
    });
    expect(JSON.parse(text)).toEqual({ account: { username: "alice" }, favorites: [] });
    click.mockRestore();
  });
});

describe("Paramètres — Préférences", () => {
  test("thème, type de vélo et page d'ouverture mémorisés sur l'appareil", async () => {
    mockApi();
    render(
      <MemoryRouter initialEntries={["/compte"]}>
        <ThemeProvider><AuthProvider><Routes><Route path="/compte" element={<Account />} /></Routes></AuthProvider></ThemeProvider>
      </MemoryRouter>
    );
    const theme = within(screen.getByRole("group", { name: "Thème" }));
    fireEvent.click(theme.getByRole("button", { name: "Sombre" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("velopulse-theme")).toBe("dark");
    fireEvent.click(theme.getByRole("button", { name: "Automatique" }));
    expect(localStorage.getItem("velopulse-theme")).toBe("system");
    expect(screen.getByText(/Suit le réglage clair \/ sombre/)).toBeTruthy();

    fireEvent.click(within(screen.getByRole("group", { name: "Type de vélo par défaut" })).getByRole("button", { name: "Électrique" }));
    expect(localStorage.getItem("velopulse-pref-bike")).toBe("ebike");
    fireEvent.click(within(screen.getByRole("group", { name: "Page d'ouverture" })).getByRole("button", { name: "Carte" }));
    expect(localStorage.getItem("velopulse-pref-landing")).toBe("carte");
  });

  test("« Revoir le tutoriel » l'ouvre, sans rien renvoyer au serveur", async () => {
    mockApi();
    render(
      <MemoryRouter initialEntries={["/compte"]}>
        <ThemeProvider><AuthProvider><Routes><Route path="/compte" element={<Account />} /></Routes></AuthProvider></ThemeProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoir le tutoriel" }));
    expect(screen.getByText("Bienvenue sur VéloPulse")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arrêter le tutoriel" }));
    expect(screen.queryByText("Bienvenue sur VéloPulse")).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith("/api/auth/tutorial"))).toBe(false);
  });
});

describe("Paramètres — page et onglets", () => {
  test("compte affiché, onglet Préférences par défaut, Sécurité accessible", async () => {
    mockApi();
    renderAt("/compte");
    expect(screen.getByRole("heading", { name: "Paramètres" })).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText(/ne peut pas être récupéré/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Préférences" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("form", { name: "Changer le mot de passe" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Sécurité" }));
    expect(screen.getByRole("form", { name: "Changer le mot de passe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Supprimer mon compte…" })).toBeTruthy();
  });

  test("onglet inconnu dans l'URL → Préférences", () => {
    mockApi();
    renderAt("/compte?onglet=xyz");
    expect(screen.getByRole("tab", { name: "Préférences" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Paramètres — Notifications", () => {
  const toggle = () => screen.getByRole("switch", { name: "Notifications sur cet appareil" });

  test("désactiver puis réactiver les notifications de cet appareil", async () => {
    mockApi();
    renderAt(NOTIF);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Tester" })).toBeTruthy();

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByText(/Vous avez désactivé les notifications sur cet appareil/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tester" })).toBeNull();

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
  });

  test("notification de test : résultat, ou erreur du serveur", async () => {
    mockApi({ "POST /api/push/test": () => jsonResponse({ ok: true, sent: 2, total: 2 }) });
    renderAt(NOTIF);
    fireEvent.click(screen.getByRole("button", { name: "Tester" }));
    expect(await screen.findByText("Notification envoyée à 2 appareils.")).toBeTruthy();

    mockApi({ "POST /api/push/test": () => jsonResponse({ ok: false, error: "Aucun appareil enregistré" }, 409) });
    fireEvent.click(screen.getByRole("button", { name: "Tester" }));
    expect(await screen.findByText("Aucun appareil enregistré")).toBeTruthy();
  });

  test("bloquées dans le navigateur : explication, pas d'interrupteur", () => {
    push.state = "denied";
    mockApi();
    renderAt(NOTIF);
    expect(screen.getByText(/bloquées pour VéloPulse/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("Paramètres — partage de l'application", () => {
  test("feuille de partage disponible : lien de l'app partagé", async () => {
    navigator.share = vi.fn(async () => {});
    mockApi();
    renderAt("/compte");
    fireEvent.click(screen.getByRole("button", { name: "Partager VéloPulse" }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
    expect(navigator.share.mock.calls[0][0]).toMatchObject({ title: "VéloPulse", url: window.location.origin });
    delete navigator.share;
  });

  test("pas de feuille de partage : lien copié dans le presse-papiers", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockApi();
    renderAt("/compte");
    fireEvent.click(screen.getByRole("button", { name: "Partager VéloPulse" }));
    expect(await screen.findByText("Lien copié dans le presse-papiers.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(window.location.origin);
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
