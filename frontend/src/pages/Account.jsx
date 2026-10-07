import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { currentPushEndpoint } from "../push";
import { usePushState, TestPushButton, useNotificationPrefs } from "../components/PushControls";
import Icon from "../components/Icon";
import { APP_VERSION } from "../theme";
import { shareApp } from "../lib/share";
import { fmtLastSeen, exportFileName, downloadJson } from "../lib/devices";
import { BIKE_TYPES, landingsFor, getBikePref, setBikePref, getLandingPref, setLandingPref } from "../lib/prefs";
import { canDisable } from "../lib/modules";
import { useTheme, THEME_MODES } from "../useTheme";
import Tutorial from "../components/Tutorial";
import { tutorialSlides } from "../lib/tutorial";

const TABS = [
  { value: "preferences",   label: "Préférences" },
  { value: "notifications", label: "Notifications" },
  { value: "securite",      label: "Sécurité" },
];

/**
 * Changement de mot de passe (mot de passe actuel exigé). Le serveur déconnecte
 * les autres appareils et renvoie un jeton neuf pour celui-ci.
 */
function PasswordForm() {
  const { renewSession } = useAuth();
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
      const endpoint = await currentPushEndpoint();
      const data = await api("/api/auth/password", {
        method: "PUT",
        body: { current_password: current, new_password: next, ...(endpoint ? { endpoint } : {}) },
      });
      renewSession(data);
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Mot de passe modifié. Vos autres appareils ont été déconnectés." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-card" onSubmit={submit} aria-label="Changer le mot de passe">
      <div className="form-title">Changer le mot de passe</div>
      <p className="account-text">Vos autres appareils seront déconnectés.</p>
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

/**
 * Appareils connectés au compte : dernière activité, déconnexion d'un appareil
 * précis ou de tous les autres (cet appareil reste connecté avec un jeton neuf).
 */
function Devices() {
  const { renewSession } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [msg, setMsg]   = useState(null); // { ok, text }
  const [busy, setBusy] = useState(null);  // id en cours, ou "all"

  const load = useCallback(async () => {
    try { setSessions((await api("/api/auth/sessions")).sessions ?? []); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key, action, okText) => {
    setMsg(null);
    setBusy(key);
    try {
      await action();
      setMsg({ ok: true, text: okText });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const revokeOne = (s) => act(s.id,
    () => api(`/api/auth/sessions/${encodeURIComponent(s.id)}`, { method: "DELETE" }),
    `${s.label} a été déconnecté.`);
  const revokeOthers = () => act("all", async () => {
    const endpoint = await currentPushEndpoint();
    renewSession(await api("/api/auth/logout-others", { method: "POST", body: endpoint ? { endpoint } : {} }));
  }, "Tous vos autres appareils ont été déconnectés.");

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  return (
    <div className="account-card">
      <div className="form-title">Appareils connectés</div>
      <p className="account-text">Un appareil déconnecté doit se reconnecter et cesse de recevoir vos alertes.</p>
      {sessions === null ? (
        <p className="account-text">Chargement…</p>
      ) : (
        <ul className="device-list" aria-label="Appareils connectés">
          {sessions.map((s) => (
            <li key={s.id} className="device-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="device-name">{s.label}{s.current && <span className="device-badge">Cet appareil</span>}</div>
                <div className="device-meta">Dernière activité {fmtLastSeen(s.last_seen_at)}</div>
              </div>
              {!s.current && (
                <button type="button" className="device-btn" disabled={busy !== null}
                  aria-label={`Déconnecter ${s.label}`} onClick={() => revokeOne(s)}>
                  {busy === s.id ? "…" : "Déconnecter"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <div className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</div>}
      {others > 0 && (
        <button type="button" className="cancel-btn" disabled={busy !== null} onClick={revokeOthers}>
          <Icon name="log-out" size={16} /> {busy === "all" ? "…" : "Déconnecter tous les autres appareils"}
        </button>
      )}
    </div>
  );
}

/** Export de toutes les données du compte en fichier JSON (droit à la portabilité). */
function ExportData() {
  const [msg, setMsg]   = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const data = await api("/api/auth/export");
      downloadJson(data.export, exportFileName());
      setMsg({ ok: true, text: "Fichier téléchargé." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-card">
      <div className="form-title">Mes données</div>
      <p className="account-text">Téléchargez vos favoris, vos alertes et la liste de vos appareils dans un fichier (format JSON).</p>
      {msg && <div className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</div>}
      <button type="button" className="cancel-btn" disabled={busy} onClick={run}>
        <Icon name="download" size={16} /> {busy ? "…" : "Exporter mes données"}
      </button>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="pref-field">
      <span className="form-label">{label}</span>
      {children}
      {hint && <span className="form-hint">{hint}</span>}
    </div>
  );
}

const MODULES = [
  { name: "bikes",  title: "Vélos",  text: "Stations Vélam d'Amiens : disponibilités, carte, favoris et alertes." },
  { name: "trains", title: "Trains", text: "Trains SNCF : recherche, trajets suivis, carte et alertes." },
];

/**
 * Fonctionnalités du compte (tous ses appareils) : vélos et / ou trains. La dernière
 * active ne peut pas être désactivée (interrupteur grisé, explication).
 */
function ModulesCard() {
  const { modules, updateModules } = useAuth();
  const [error, setError] = useState(null);
  const toggle = async (name) => {
    setError(null);
    try { await updateModules({ [name]: !modules[name] }); } catch (e) { setError(e.message); }
  };
  const locked = MODULES.find((m) => !canDisable(modules, m.name));
  return (
    <div className="account-card">
      <div className="form-title">Fonctionnalités</div>
      <p className="account-text">
        Pour tous vos appareils. Une fonctionnalité désactivée disparaît de l'application et ses
        alertes ne sont plus envoyées ; rien n'est supprimé : favoris et alertes reviennent si vous la réactivez.
      </p>
      {MODULES.map((m) => {
        const on = modules[m.name];
        const disabled = !canDisable(modules, m.name);
        return (
          <div className="settings-row" key={m.name}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="account-text"><b>{m.title}</b></div>
              <p className="account-text">{m.text}</p>
            </div>
            <button role="switch" aria-checked={on} aria-label={m.title} disabled={disabled}
              title={disabled ? "Au moins une fonctionnalité doit rester active" : undefined}
              className={"switch" + (on ? " on" : "")} onClick={() => toggle(m.name)}>
              <span className="switch-knob" />
            </button>
          </div>
        );
      })}
      {locked && <p className="form-hint">Au moins une fonctionnalité reste active : réactivez l'autre pour pouvoir couper « {locked.title} ».</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

/**
 * Préférences : fonctionnalités du compte, puis réglages de cet appareil (thème, type
 * de vélo par défaut, page d'ouverture) — sans ceux d'une fonctionnalité désactivée.
 */
function PreferencesTab() {
  const { modules } = useAuth();
  const { mode, setMode } = useTheme();
  const [bike, setBike] = useState(getBikePref);
  const [landing, setLanding] = useState(getLandingPref);
  const [tutorial, setTutorial] = useState(false);
  const landings = landingsFor(modules);
  // Page d'ouverture d'une fonctionnalité désactivée : l'app ouvre Mes trajets.
  const shownLanding = landings.some((o) => o.value === landing) ? landing : "trajets";
  const autoHint = modules.bikes ? "Mes trajets sur téléphone, Vélos sur ordinateur." : "Mes trajets.";
  return (
    <>
    <ModulesCard />
    <div className="account-card">
      <div className="form-title">Cet appareil</div>
      <Field label="Thème" hint={mode === "system" ? "Suit le réglage clair / sombre de votre appareil." : null}>
        <Seg label="Thème" options={THEME_MODES} value={mode} onChange={setMode} />
      </Field>
      {modules.bikes && (
        <Field label="Type de vélo par défaut" hint="Pré-remplit les alertes et les filtres des pages Stations et Carte.">
          <Seg label="Type de vélo par défaut" options={BIKE_TYPES} value={bike}
            onChange={(v) => { setBike(v); setBikePref(v); }} />
        </Field>
      )}
      <Field label="Page d'ouverture" hint={shownLanding === "auto" ? autoHint : null}>
        <Seg label="Page d'ouverture" options={landings} value={shownLanding}
          onChange={(v) => { setLanding(v); setLandingPref(v); }} />
      </Field>
      <p className="account-text">Ces préférences sont propres à cet appareil.</p>
      <button type="button" className="cancel-btn" onClick={() => setTutorial(true)}>
        <Icon name="bike" size={16} /> Revoir le tutoriel
      </button>
      {tutorial && <Tutorial slides={tutorialSlides(modules)} onClose={() => setTutorial(false)} />}
    </div>
    </>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value}
          className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Notifications de cet appareil : activer / désactiver, tester. */
/** Types d'alertes envoyés au compte (tous les appareils) : vélos, trains. */
function AlertKinds() {
  const { prefs, toggle, error } = useNotificationPrefs();
  const { modules } = useAuth();
  // Une fonctionnalité désactivée n'envoie rien : pas d'interrupteur pour elle.
  const rows = [
    { kind: "bikes",  title: "Alertes vélos",  text: "Disponibilité des stations et résumés à heure fixe." },
    { kind: "trains", title: "Alertes trains", text: "Retards, suppressions et perturbations de vos trains et lignes." },
  ].filter((r) => modules[r.kind]);
  return (
    <div className="account-card">
      <div className="form-title">Alertes envoyées</div>
      <p className="account-text">Pour tous vos appareils. Couper un type ne supprime aucune alerte : elles ne sont simplement plus envoyées.</p>
      {rows.map((r) => (
        <div className="settings-row" key={r.kind}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="account-text"><b>{r.title}</b></div>
            <p className="account-text">{r.text}</p>
          </div>
          <button role="switch" aria-checked={!!prefs?.[r.kind]} aria-label={r.title} disabled={!prefs}
            className={"switch" + (prefs?.[r.kind] ? " on" : "")} onClick={() => toggle(r.kind)}>
            <span className="switch-knob" />
          </button>
        </div>
      ))}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

function NotificationsTab() {
  const { status, busy, enable, disable } = usePushState();
  const [testMsg, setTestMsg] = useState(null);
  const on = status === "on";

  const hint = {
    unsupported: "Ce navigateur ne permet pas les notifications. Sur iPhone, installez d'abord l'application sur l'écran d'accueil.",
    denied: "Les notifications sont bloquées pour VéloPulse dans les réglages de votre appareil ou du navigateur : autorisez-les là-bas pour pouvoir les activer.",
    default: "Les notifications n'ont pas encore été activées sur cet appareil.",
    off: "Vous avez désactivé les notifications sur cet appareil : vos alertes ne s'y afficheront pas (vos autres appareils les reçoivent toujours).",
    on: "Vos alertes et résumés s'affichent sur cet appareil.",
  }[status];
  const canToggle = status !== "unsupported" && status !== "denied";

  return (
    <>
      <div className="account-card">
        <div className="settings-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="form-title">Notifications sur cet appareil</div>
            <p className="account-text">{hint}</p>
          </div>
          {canToggle && (
            <button role="switch" aria-checked={on} aria-label="Notifications sur cet appareil" disabled={busy}
              className={"switch" + (on ? " on" : "")} onClick={on ? disable : enable}>
              <span className="switch-knob" />
            </button>
          )}
        </div>
        {on && (
          <div className="settings-row">
            <span className="account-text" style={{ flex: 1 }}>{testMsg ?? "Vérifier que les notifications arrivent bien."}</span>
            <TestPushButton onResult={setTestMsg} />
          </div>
        )}
      </div>
      <AlertKinds />
      <p className="account-text settings-note">
        Pour suspendre toutes vos alertes quelques jours sur tous vos appareils, utilisez la pause
        dans <Link to="/alertes">Alertes</Link>.
      </p>
    </>
  );
}

function SecurityTab() {
  return (
    <>
      <PasswordForm />
      <Devices />
      <ExportData />
      <DeleteAccount />
    </>
  );
}

/** Partage du lien de l'application (feuille de partage, sinon presse-papiers). */
function ShareButton() {
  const [msg, setMsg] = useState(null);
  const share = async () => {
    const result = await shareApp();
    setMsg({
      shared: null,
      copied: "Lien copié dans le presse-papiers.",
      failed: `Copiez ce lien : ${window.location.origin}`,
    }[result]);
  };
  return (
    <div className="share-block">
      <button type="button" className="cancel-btn share-btn" onClick={share}>
        <Icon name="share" size={16} /> Partager VéloPulse
      </button>
      {msg && <div className="form-ok" role="status">{msg}</div>}
    </div>
  );
}

export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("onglet")) ? params.get("onglet") : TABS[0].value;
  const setTab = (value) => setParams({ onglet: value }, { replace: true });

  return (
    <div className="view-pad account-page">
      <div className="page-head"><h2 className="page-title">Paramètres</h2></div>
      <div className="account-card">
        <div className="account-id"><Icon name="user" size={20} /> <b>{user?.username}</b></div>
        <p className="account-text">Aucune adresse e-mail n'est enregistrée : un mot de passe oublié ne peut pas être récupéré.</p>
        <button type="button" className="cancel-btn" onClick={async () => { await logout(); navigate("/login", { replace: true }); }}>
          <Icon name="log-out" size={16} /> Se déconnecter
        </button>
      </div>

      <div className="seg" role="tablist" aria-label="Rubriques des paramètres">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value}
            className={tab === t.value ? "active" : ""} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab).label} className="settings-panel">
        {tab === "preferences" ? <PreferencesTab /> : tab === "notifications" ? <NotificationsTab /> : <SecurityTab />}
      </div>

      <ShareButton />
      <div className="account-links">
        <Link to="/confidentialite"><Icon name="shield" size={15} /> Confidentialité et mentions légales</Link>
        <span className="app-version">v{APP_VERSION}</span>
      </div>
    </div>
  );
}
