import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { syncPush } from "../push";
import Logo from "../components/Logo";
import Icon from "../components/Icon";
import { APP_VERSION } from "../theme";

// Bornes alignées sur le serveur (routes/auth.js).
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;

const FEATURES = [
  { icon: "bike", text: "Vélos et places disponibles, en direct" },
  { icon: "bell", text: "Une alerte quand votre station se vide" },
  { icon: "star", text: "Vos stations favorites, même hors ligne" },
];

/** Contrôles côté client (le serveur revalide) : message d'erreur ou null. */
export function validateAuth({ mode, username, password, confirm }) {
  const name = username.trim();
  if (!name) return "Choisissez un nom d'utilisateur";
  if (mode === "register") {
    if (name.length > USERNAME_MAX) return `Nom d'utilisateur : ${USERNAME_MAX} caractères maximum`;
    if (password.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères`;
    if (password !== confirm) return "Les deux mots de passe ne correspondent pas";
  } else if (!password) return "Saisissez votre mot de passe";
  return null;
}

/** Champ mot de passe avec bouton afficher / masquer. */
function PasswordField({ id, label, value, onChange, autoComplete, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password">
        <input id={id} type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} required
          aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" className="auth-eye" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          <Icon name={visible ? "eye-off" : "eye"} size={18} />
        </button>
      </div>
      {hint && <small id={`${id}-hint`} className="auth-hint">{hint}</small>}
    </div>
  );
}

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const accountDeleted = useLocation().state?.accountDeleted;

  const [mode,     setMode]     = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState(null);
  const [busy,     setBusy]     = useState(false);
  const registering = mode === "register";

  const switchMode = (m) => { setMode(m); setError(null); setConfirm(""); };

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validateAuth({ mode, username, password, confirm });
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      if (registering) await register(username.trim(), password);
      else             await login(username.trim(), password);
      syncPush(); // silencieux : la permission se demande depuis la page Alertes
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-inner">
        <header className="auth-hero">
          <span className="auth-logo"><Logo /></span>
          <h1 className="auth-name">VéloPulse</h1>
          <p className="auth-sub">Les vélos Vélam d'Amiens, en temps réel</p>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.icon}><Icon name={f.icon} size={16} /><span>{f.text}</span></li>
            ))}
          </ul>
        </header>

        <form onSubmit={submit} className="auth-card" noValidate aria-label={registering ? "Inscription" : "Connexion"}>
          <div className="seg auth-seg" role="group" aria-label="Connexion ou inscription">
            {[["login", "Connexion"], ["register", "Inscription"]].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? "active" : ""}
                onClick={() => switchMode(m)}>{label}</button>
            ))}
          </div>

          {accountDeleted && !error && <div className="form-ok" role="status">Votre compte et toutes vos données ont été supprimés.</div>}

          <label className="auth-field">
            <span>Nom d'utilisateur</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={registering ? USERNAME_MAX : undefined} required />
          </label>
          <PasswordField id="auth-password" label="Mot de passe" value={password} onChange={setPassword}
            autoComplete={registering ? "new-password" : "current-password"}
            hint={registering ? `${PASSWORD_MIN} caractères minimum` : null} />
          {registering && (
            <>
              <PasswordField id="auth-confirm" label="Confirmer le mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              <div className="auth-note">
                <Icon name="shield" size={15} />
                <span>Aucune adresse e-mail n'est demandée : notez bien votre mot de passe, il ne pourra pas être récupéré.</span>
              </div>
            </>
          )}

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button type="submit" className="submit-btn" disabled={busy}>
            {busy ? (registering ? "Création du compte…" : "Connexion…") : registering ? "Créer mon compte" : "Se connecter"}
          </button>
        </form>

        <div className="app-version auth-foot"><Link to="/confidentialite">Confidentialité</Link> · v{APP_VERSION}</div>
      </div>
    </div>
  );
}
