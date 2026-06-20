// Client API centralisé : injecte le JWT et normalise les erreurs.

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "velam_token";
const USER_KEY  = "velam_user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

export const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
};
export const setStoredUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));

/**
 * Appel API. Ajoute le Bearer token par défaut. Lève une Error si la réponse
 * n'est pas ok (HTTP ou enveloppe { ok:false }).
 */
export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  let data = {};
  try { data = await res.json(); } catch { /* réponse sans corps */ }

  if (!res.ok || data.ok === false) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
