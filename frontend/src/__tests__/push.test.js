import { describe, test, expect, vi, beforeEach } from "vitest";
import { syncPush, enablePush, unlinkPush, pushPermission } from "../push";
import { setToken } from "../api";
import { jsonResponse } from "./setup";

// Clé VAPID factice (base64url) et sa forme binaire.
const KEY_B64 = "AQID";                 // octets [1, 2, 3]
const KEY_BYTES = new Uint8Array([1, 2, 3]);

let permission, existingSub, pushManager, requestPermission;

function makeSub(keyBytes, endpoint = "https://push.example.com/abc") {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes?.buffer ?? null },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  };
}

beforeEach(() => {
  permission = "granted";
  existingSub = null;
  requestPermission = vi.fn(async () => permission);
  pushManager = {
    getSubscription: vi.fn(async () => existingSub),
    subscribe: vi.fn(async () => makeSub(KEY_BYTES, "https://push.example.com/nouveau")),
  };
  const reg = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(reg), getRegistration: async () => reg },
  });
  window.PushManager = function PushManager() {};
  window.Notification = { get permission() { return permission; }, requestPermission };

  setToken("jeton");
  fetch.mockImplementation(async (url) =>
    String(url).endsWith("/vapid-public-key") ? jsonResponse({ ok: true, publicKey: KEY_B64 }) : jsonResponse({ ok: true }, 201)
  );
});

const posted = (suffix) => fetch.mock.calls.filter(([u]) => String(u).endsWith(suffix));

describe("pushPermission", () => {
  test("reflète Notification.permission", () => {
    permission = "denied";
    expect(pushPermission()).toBe("denied");
  });
  test("unsupported sans PushManager", () => {
    delete window.PushManager;
    expect(pushPermission()).toBe("unsupported");
  });
});

describe("syncPush (silencieux)", () => {
  test("ne demande JAMAIS la permission", async () => {
    for (const p of ["default", "denied", "granted"]) {
      permission = p;
      await syncPush();
    }
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test("permission non accordée → aucun appel réseau", async () => {
    permission = "default";
    expect(await syncPush()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("sans subscription → souscrit puis enregistre côté serveur", async () => {
    expect(await syncPush()).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: KEY_BYTES });
    const [[, init]] = posted("/api/push/subscribe");
    expect(JSON.parse(init.body).subscription.endpoint).toBe("https://push.example.com/nouveau");
  });

  test("subscription existante avec la même clé → réutilisée", async () => {
    existingSub = makeSub(KEY_BYTES);
    await syncPush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existingSub.unsubscribe).not.toHaveBeenCalled();
    expect(posted("/api/push/subscribe")).toHaveLength(1);
  });

  test("clé VAPID changée → désabonne et resouscrit", async () => {
    existingSub = makeSub(new Uint8Array([9, 9, 9]));
    await syncPush();
    expect(existingSub.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  test("erreur serveur → false, sans exception", async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: false }, 500));
    await expect(syncPush()).resolves.toBe(false);
  });
});

describe("enablePush (sur clic)", () => {
  test("service worker jamais prêt : abandon après délai, sans blocage", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}) } });
    permission = "default";
    requestPermission.mockImplementation(async () => { permission = "granted"; return "granted"; });
    const p = enablePush();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe("granted");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("demande la permission puis synchronise", async () => {
    permission = "default";
    requestPermission.mockImplementation(async () => { permission = "granted"; return "granted"; });
    expect(await enablePush()).toBe("granted");
    expect(posted("/api/push/subscribe")).toHaveLength(1);
  });

  test("refus → aucun abonnement", async () => {
    permission = "default";
    requestPermission.mockImplementation(async () => { permission = "denied"; return "denied"; });
    expect(await enablePush()).toBe("denied");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("unlinkPush (déconnexion)", () => {
  test("détache l'endpoint côté serveur sans désabonner le navigateur", async () => {
    existingSub = makeSub(KEY_BYTES);
    await unlinkPush();
    const [[, init]] = posted("/api/push/unsubscribe");
    expect(JSON.parse(init.body)).toEqual({ endpoint: "https://push.example.com/abc" });
    expect(existingSub.unsubscribe).not.toHaveBeenCalled();
  });

  test("hors ligne → ne lève pas", async () => {
    existingSub = makeSub(KEY_BYTES);
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    await expect(unlinkPush()).resolves.toBeUndefined();
  });
});
