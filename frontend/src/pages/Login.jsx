import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { registerPush } from "../push";
import { C } from "../theme";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode,     setMode]     = useState("login"); // 'login' | 'register'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState(null);
  const [busy,     setBusy]     = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username.trim(), password);
      else                  await register(username.trim(), password);
      // Demande de permission notifications après connexion (best-effort)
      registerPush();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const tab = (m, label) => (
    <button type="button" onClick={() => { setMode(m); setError(null); }} style={{
      flex: 1, padding: "9px 0", background: mode === m ? C.card : "transparent",
      border: "none", borderBottom: `2px solid ${mode === m ? "#2B4A80" : C.dim}`,
      color: mode === m ? "#90B8F8" : C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer",
    }}>{label}</button>
  );

  const input = (props) => (
    <input {...props} style={{
      background: "#080F1E", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 12px", color: C.text, fontSize: 13, outline: "none", width: "100%",
    }} />
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui,-apple-system,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 18, justifyContent: "center" }}>
          <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em" }}>VéloPulse</span>
          <span style={{ fontSize: 11, color: C.muted }}>Amiens</span>
        </div>

        <div style={{ display: "flex", marginBottom: 18 }}>
          {tab("login", "Connexion")}
          {tab("register", "Inscription")}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {input({ value: username, onChange: (e) => setUsername(e.target.value), placeholder: "Nom d'utilisateur", autoComplete: "username", required: true })}
          {input({ value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Mot de passe", type: "password", autoComplete: mode === "login" ? "current-password" : "new-password", required: true })}
        </div>

        {error && <div style={{ color: "#FCA5A5", fontSize: 11, marginTop: 12, textAlign: "center" }}>{error}</div>}

        <button type="submit" disabled={busy} style={{
          width: "100%", marginTop: 16, padding: "11px 0", background: "#152040",
          border: "1px solid #2B4A80", borderRadius: 8, color: "#90B8F8",
          fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
        }}>
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer un compte"}
        </button>
      </form>
    </div>
  );
}
