import { describe, test, expect, vi } from "vitest";
import { api, setToken, getToken, setStoredUser, getStoredUser, AUTH_EXPIRED_EVENT } from "../api";
import { saveCache, loadCache } from "../lib/offlineCache";
import { jsonResponse, setOnline } from "./setup";

const lastCall = () => fetch.mock.calls.at(-1);

describe("api()", () => {
  test("ajoute le Bearer et sérialise le corps", async () => {
    setToken("jeton");
    fetch.mockResolvedValue(jsonResponse({ ok: true, v: 1 }));
    const data = await api("/api/x", { method: "POST", body: { a: 1 } });
    expect(data.v).toBe(1);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/api\/x$/);
    expect(init.headers.Authorization).toBe("Bearer jeton");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  test("auth:false n'envoie pas le jeton", async () => {
    setToken("jeton");
    fetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api("/api/stations", { auth: false });
    expect(lastCall()[1].headers.Authorization).toBeUndefined();
  });

  test("lève avec le message serveur et le statut", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: false, error: "Champs invalides" }, 400));
    await expect(api("/api/alerts", { method: "POST", body: {} })).rejects.toMatchObject({
      message: "Champs invalides", status: 400,
    });
  });

  test("lève sur une enveloppe ok:false même en HTTP 200", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: false, error: "non" }));
    await expect(api("/api/x")).rejects.toThrow("non");
  });
});

describe("api() — jeton refusé (401)", () => {
  test("purge la session + favoris en cache et émet auth:expired", async () => {
    setToken("vieux");
    setStoredUser({ id: 1 });
    saveCache("favorites", [{ station_id: "1" }]);
    const onExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    fetch.mockResolvedValue(jsonResponse({ ok: false, error: "Token invalide ou expiré" }, 401));

    await expect(api("/api/favorites")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(loadCache("favorites")).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  });

  test("un 401 sur une requête sans jeton (login raté) ne déconnecte pas", async () => {
    const onExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    fetch.mockResolvedValue(jsonResponse({ ok: false, error: "Identifiants incorrects" }, 401));
    await expect(api("/api/auth/login", { method: "POST", auth: false, body: {} })).rejects.toThrow("Identifiants incorrects");
    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  });

  test("ne purge pas un jeton remplacé entre-temps (re-login concurrent)", async () => {
    setToken("ancien");
    fetch.mockImplementation(async () => {
      setToken("nouveau"); // login réussi pendant la requête
      return jsonResponse({ ok: false }, 401);
    });
    await expect(api("/api/favorites")).rejects.toBeTruthy();
    expect(getToken()).toBe("nouveau");
  });
});

describe("api() — relances (réveil du serveur)", () => {
  test("GET rejoué sur 503 puis succès", async () => {
    vi.useFakeTimers();
    fetch
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true, v: 2 }));
    const p = api("/api/stations", { auth: false });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ v: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("GET rejoué sur erreur réseau, abandon après 3 essais", async () => {
    vi.useFakeTimers();
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const p = api("/api/stations", { auth: false });
    const assertion = expect(p).rejects.toThrow("Serveur injoignable");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("POST jamais rejoué (pas d'effet de bord en double)", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: false }, 503));
    await expect(api("/api/alerts", { method: "POST", body: {} })).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("hors ligne : échec immédiat, sans relance", async () => {
    setOnline(false, { emit: false });
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/api/stations", { auth: false })).rejects.toThrow("Serveur injoignable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("400 non rejoué", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: false }, 400));
    await expect(api("/api/x")).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
