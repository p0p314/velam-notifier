import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { APP_VERSION } from "../theme";

/** Changement de mot de passe (mot de passe actuel exigé). */
function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg]         = useState(null); // { ok, text }
  const [busy, setBusy]       = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ ok: false, text: "Le nouveau mot de passe doit faire au moins 8 caractères" });
    if (next !== confirm) return setMsg({ ok: false, text: "Les deux nouveaux mots de passe ne correspondent pas" });
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "PUT", body: { current_password: current, new_password: next } });
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Mot de passe modifié." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-card" onSubmit={submit} aria-label="Changer le mot de passe">
      <div className="form-title">Changer le mot de passe</div>
      <label className="auth-field"><span>Mot de passe actuel</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="auth-field"><span>Nouveau mot de passe</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </label>
      <label className="auth-field"><span>Confirmer le nouveau mot de passe</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {msg && <div className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</div>}
      <button type="submit" className="submit-btn" disabled={busy}>{busy ? "…" : "Enregistrer"}</button>
    </form>
  );
}

/** Suppression définitive du compte (droit à l'effacement), confirmée par mot de passe. */
function DeleteAccount() {
  const { endSession } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen]         = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/me", { method: "DELETE", body: { password } });
      endSession(); // le compte n'existe plus : rien à détacher côté serveur
      navigate("/login", { replace: true, state: { accountDeleted: true } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="account-card danger">
        <div className="form-title">Supprimer mon compte</div>
        <p className="account-text">Supprime définitivement votre compte, vos favoris, vos alertes et vos appareils enregistrés.</p>
        <button type="button" className="danger-btn" onClick={() => setOpen(true)}>Supprimer mon compte…</button>
      </div>
    );
  }
  return (
    <form className="account-card danger" onSubmit={submit} aria-label="Supprimer le compte">
      <div className="form-title">Confirmer la suppression</div>
      <p className="account-text">Cette action est <b>irréversible</b>. Saisissez votre mot de passe pour confirmer.</p>
      <label className="auth-field"><span>Mot de passe</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-submit-row">
        <button type="button" className="cancel-btn" onClick={() => { setOpen(false); setPassword(""); setError(null); }}>Annuler</button>
        <button type="submit" className="danger-btn" disabled={busy}>{busy ? "…" : "Supprimer définitivement"}</button>
      </div>
    </form>
  );
}

export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="view-pad account-page">
      <div className="page-head"><h2 className="page-title">Mon compte</h2></div>
      <div className="account-card">
        <div className="account-id"><Icon name="user" size={20} /> <b>{user?.username}</b></div>
        <p className="account-text">Aucune adresse e-mail n'est enregistrée : un mot de passe oublié ne peut pas être récupéré.</p>
        <button type="button" className="cancel-btn" onClick={async () => { await logout(); navigate("/login", { replace: true }); }}>
          <Icon name="log-out" size={16} /> Se déconnecter
        </button>
      </div>
      <PasswordForm />
      <DeleteAccount />
      <div className="account-links">
        <Link to="/confidentialite"><Icon name="shield" size={15} /> Confidentialité et mentions légales</Link>
        <span className="app-version">v{APP_VERSION}</span>
      </div>
    </div>
  );
}
