import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, getToken, setToken, clearToken, getStoredUser, setStoredUser, AUTH_EXPIRED_EVENT } from "./api";
import { syncPush, unlinkPush } from "./push";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(() => getStoredUser());
  const [token, setTok]   = useState(() => getToken());

  const persist = useCallback((data) => {
    setToken(data.token);
    setStoredUser(data.user);
    setTok(data.token);
    setUser(data.user);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api("/api/auth/login", { method: "POST", auth: false, body: { username, password } });
    persist(data);
    return data.user;
  }, [persist]);

  const register = useCallback(async (username, password) => {
    const data = await api("/api/auth/register", { method: "POST", auth: false, body: { username, password } });
    persist(data);
    return data.user;
  }, [persist]);

  /** Oublie la session localement (sans appel serveur). */
  const endSession = useCallback(() => {
    clearToken();
    setTok(null);
    setUser(null);
  }, []);

  // Async : détache d'abord l'appareil (tant que le jeton est encore valide).
  const logout = useCallback(async () => {
    await unlinkPush();
    endSession();
  }, [endSession]);

  // Jeton rejeté par le serveur (api() a déjà purgé le stockage) → état déconnecté,
  // <Protected> redirige vers /login au lieu d'afficher des listes vides.
  useEffect(() => {
    const onExpired = () => { setTok(null); setUser(null); };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  // Au démarrage : renouvelle le jeton (session glissante) puis resynchronise
  // silencieusement la subscription push — sans jamais redemander la permission.
  useEffect(() => {
    const sent = getToken();
    if (!sent) return;
    api("/api/auth/me")
      .then((data) => {
        // Déconnexion (ou re-login) pendant la requête : ne pas ressusciter la session.
        if (getToken() !== sent) return;
        persist(data);
        syncPush();
      })
      .catch(() => { /* 401 → géré par AUTH_EXPIRED_EVENT ; réseau → on garde la session */ });
  }, [persist]);

  const value = { user, token, login, register, logout, endSession, isAuthenticated: !!token };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
