import { createContext, useContext, useState, useCallback } from "react";
import { api, getToken, setToken, clearToken, getStoredUser, setStoredUser } from "./api";

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

  const logout = useCallback(() => {
    clearToken();
    setTok(null);
    setUser(null);
  }, []);

  const value = { user, token, login, register, logout, isAuthenticated: !!token };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
