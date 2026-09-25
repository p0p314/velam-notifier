import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { syncPush } from "../push";
import Logo from "../components/Logo";
import { APP_VERSION } from "../theme";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const accountDeleted = useLocation().state?.accountDeleted;

  const [mode,     setMode]     = useState("login");
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
      syncPush(); // silencieux : la permission se demande depuis la page Alertes
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const tab = (m, label) => (
    <button type="button" className={"auth-tab" + (mode === m ? " active" : "")} onClick={() => { setMode(m); setError(null); }}>
      {label}
    </button>
  );

  return (
    <div className="auth-wrap">
      <form onSubmit={submit} className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo"><Logo /></span>
          <div className="auth-name">VéloPulse</div>
          <div className="auth-sub">Vélam · Amiens</div>
        </div>

        <div className="auth-tabs">
          {tab("login", "Connexion")}
          {tab("register", "Inscription")}
        </div>

        <label className="auth-field">
          <span>Nom d'utilisateur</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="auth-field">
          <span>Mot de passe</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"} required />
        </label>

        {accountDeleted && !error && <div className="form-ok" role="status">Votre compte et toutes vos données ont été supprimés.</div>}
        {mode === "register" && (
          <div className="auth-note">Aucune adresse e-mail n'est demandée : notez bien votre mot de passe, il ne pourra pas être récupéré.</div>
        )}
        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="submit-btn" disabled={busy} style={{ marginTop: 4, opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer un compte"}
        </button>
        <div className="app-version"><Link to="/confidentialite">Confidentialité</Link> · v{APP_VERSION}</div>
      </form>
    </div>
  );
}
