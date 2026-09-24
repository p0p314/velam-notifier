// Environnement commun des tests frontend.
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/** Force navigator.onLine (jsdom le fixe à true) et émet l'événement correspondant. */
export function setOnline(value, { emit = true } = {}) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  if (emit) window.dispatchEvent(new Event(value ? "online" : "offline"));
}

/** Réponse JSON factice pour fetch. */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Force le résultat de matchMedia (jsdom ne l'implémente pas) : true = viewport mobile. */
export function setMobileViewport(mobile) {
  window.matchMedia = (query) => ({
    matches: mobile, media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}

beforeEach(() => {
  localStorage.clear();
  setMobileViewport(false);
  setOnline(true, { emit: false });
  globalThis.fetch = vi.fn(async () => { throw new Error("fetch non simulé dans ce test"); });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
