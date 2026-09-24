import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useFavorites, useIsMobile } from "../hooks";
import { pushPermission, enablePush } from "../push";
import {
  ALL_DAYS, defaultForm, formFromAlert, validateForm, payloadFromForm, describeAlert,
  tripAllowed, localYmd, addDaysYmd, fmtDay,
} from "../lib/alerts";
import BottomSheet from "../components/BottomSheet";
import Icon from "../components/Icon";

const BIKE_ICON = { mechanical: "bike", ebike: "bolt", any: "bike" };
const BIKE_OPTIONS = [
  { value: "mechanical", label: "Mécanique" },
  { value: "ebike",      label: "Électrique" },
  { value: "any",        label: "Les deux" },
];
const TARGET_OPTIONS = [
  { value: "bikes", label: "Vélos" },
  { value: "docks", label: "Places libres" },
];
const COMPARISON_OPTIONS = [
  { value: "at_most",  label: "Il en reste peu" },
  { value: "at_least", label: "Il y en a de nouveau" },
];

const DAYS = [
  { label: "Lu", value: 1 }, { label: "Ma", value: 2 }, { label: "Me", value: 3 },
  { label: "Je", value: 4 }, { label: "Ve", value: 5 }, { label: "Sa", value: 6 },
  { label: "Di", value: 7 },
];

function DayPicker({ value, onChange, disabled }) {
  const toggle = (day) => {
    if (disabled) return;
    if (value.includes(day) && value.length === 1) return;
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className={`day-picker${disabled ? " disabled" : ""}`}>
      {DAYS.map(({ label, value: day }) => (
        <button key={day} type="button" disabled={disabled}
          className={value.includes(day) ? "active" : ""} onClick={() => toggle(day)}>
          {label}
        </button>
      ))}
    </div>
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

/**
 * Notifications : activation sur clic (exigé par iOS, jamais automatique) ;
 * une fois accordées, bouton d'envoi d'une notification de test.
 */
function PushBanner() {
  const [perm, setPerm] = useState(pushPermission);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  if (perm === "unsupported") return null;

  if (perm === "denied") {
    return (
      <div className="push-banner">
        <Icon name="bell" size={18} />
        <span>Notifications bloquées : autorisez-les dans les réglages de l'appareil pour recevoir vos alertes.</span>
      </div>
    );
  }
  if (perm === "granted") {
    const test = async () => {
      setBusy(true);
      setTestMsg(null);
      try {
        const { sent } = await api("/api/push/test", { method: "POST" });
        setTestMsg(`Notification envoyée à ${sent} appareil${sent > 1 ? "s" : ""}.`);
      } catch (e) {
        setTestMsg(e.message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="push-banner">
        <Icon name="bell" size={18} />
        <span>{testMsg ?? "Notifications activées sur cet appareil."}</span>
        <button type="button" className="push-banner-btn ghost" disabled={busy} onClick={test}>
          {busy ? "…" : "Tester"}
        </button>
      </div>
    );
  }
  const activate = async () => {
    setBusy(true);
    try { setPerm(await enablePush()); } finally { setBusy(false); }
  };
  return (
    <div className="push-banner">
      <Icon name="bell" size={18} />
      <span>Activez les notifications pour être prévenu de vos alertes.</span>
      <button type="button" className="push-banner-btn" disabled={busy} onClick={activate}>
        {busy ? "…" : "Activer"}
      </button>
    </div>
  );
}

/** Pause globale : suspend toutes les alertes jusqu'à une date (incluse). */
function PauseControl({ pausedUntil, onChange }) {
  const today = localYmd();
  const [open, setOpen]   = useState(false);
  const [until, setUntil] = useState(() => addDaysYmd(today, 6));
  const [error, setError] = useState(null);

  const save = async (value) => {
    setError(null);
    try {
      const { paused_until } = await api("/api/alerts/pause", { method: "PUT", body: { until: value } });
      onChange(paused_until);
      setOpen(false);
    } catch (e) { setError(e.message); }
  };

  if (pausedUntil) {
    return (
      <div className="pause-banner" role="status">
        <Icon name="pause" size={18} />
        <span>Alertes en pause jusqu'au {fmtDay(pausedUntil)} inclus.</span>
        <button type="button" className="push-banner-btn" onClick={() => save(null)}>Reprendre</button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="pause-link" onClick={() => setOpen(true)}>
        <Icon name="pause" size={15} /> Mettre toutes les alertes en pause
      </button>
    );
  }
  return (
    <div className="pause-banner">
      <label className="pause-form">
        <span>Suspendre jusqu'au</span>
        <input type="date" className="field mono" value={until} min={today}
          max={addDaysYmd(today, 365)} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <button type="button" className="push-banner-btn" disabled={!until} onClick={() => save(until)}>Suspendre</button>
      <button type="button" className="pause-cancel" aria-label="Annuler" onClick={() => setOpen(false)}>
        <Icon name="x" size={16} />
      </button>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

function AlertCard({ a, onToggle, onDelete, onEdit, paused }) {
  const { title, detail } = describeAlert(a);
  const icon = a.arrival_station_id ? "route" : a.target === "docks" ? "parking" : BIKE_ICON[a.bike_type];
  return (
    <div className={"alert-card" + (a.active && !paused ? "" : " off")}>
      <div className="alert-card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="alert-card-name">{title}</div>
          <div className="alert-card-sub">
            <Icon name={icon} size={14} />
            <span>{detail}</span>
          </div>
        </div>
        <button role="switch" aria-checked={!!a.active} aria-label={a.active ? "Désactiver" : "Activer"}
          className={"switch" + (a.active ? " on" : "")} onClick={() => onToggle(a)}>
          <span className="switch-knob" />
        </button>
        <button className="alert-edit" aria-label="Modifier" onClick={() => onEdit(a)}>
          <Icon name="pencil" size={16} />
        </button>
        <button className="alert-del" aria-label="Supprimer" onClick={() => onDelete(a)}>
          <Icon name="trash" size={17} />
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        {a.valid_on
          ? <span className="alert-once"><Icon name="calendar" size={14} /> Uniquement le {fmtDay(a.valid_on)}</span>
          : <DayPicker value={a.days ? a.days.split(",").map(Number) : ALL_DAYS} onChange={() => {}} disabled />}
      </div>
    </div>
  );
}

function AlertForm({ stations, form, setField, error, onSubmit, onCancel, editing }) {
  if (stations.length === 0) {
    return <div style={{ fontSize: 14, color: "var(--text-3)" }}>Ajoutez d'abord des stations en favoris.</div>;
  }
  const unit = form.target === "docks" ? "places libres" : "vélos disponibles";
  const arrivals = stations.filter((s) => s.station_id !== form.stationId);

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-label="Formulaire d'alerte">
      <div className="form-title">{editing ? "Modifier l'alerte" : "Nouvelle alerte"}</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">{form.trip && tripAllowed(form) ? "Station de départ" : "Station"}</span>
        <div className="select-wrap select-inset">
          <select value={form.stationId} onChange={(e) => setField("stationId", e.target.value)} required aria-label="Station">
            {stations.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
          </select>
          <Icon name="chevron-down" size={15} />
        </div>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Surveiller</span>
        <Seg label="Surveiller" options={TARGET_OPTIONS} value={form.target} onChange={(v) => setField("target", v)} />
      </div>

      {form.target === "bikes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">Type de vélo</span>
          <Seg label="Type de vélo" options={BIKE_OPTIONS} value={form.bikeType} onChange={(v) => setField("bikeType", v)} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Me prévenir quand</span>
        <Seg label="Me prévenir quand" options={COMPARISON_OPTIONS} value={form.comparison} onChange={(v) => setField("comparison", v)} />
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">{form.comparison === "at_least" ? "Au moins" : "Au plus"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="number" inputMode="numeric" min={form.comparison === "at_least" ? 1 : 0} max="50"
            value={form.threshold} aria-label="Seuil"
            onChange={(e) => setField("threshold", e.target.value)} className="field mono" style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>{unit}</span>
        </div>
      </label>

      {tripAllowed(form) && (
        <div className="trip-box">
          <label className="check-row">
            <input type="checkbox" checked={form.trip} onChange={(e) => setField("trip", e.target.checked)} />
            <span>Trajet : vérifier aussi les places à l'arrivée</span>
          </label>
          {form.trip && (
            <>
              {arrivals.length === 0 ? (
                <div className="form-hint">Ajoutez une deuxième station en favori pour définir l'arrivée.</div>
              ) : (
                <div className="select-wrap select-inset">
                  <select value={form.arrivalId} onChange={(e) => setField("arrivalId", e.target.value)} aria-label="Station d'arrivée">
                    <option value="">Station d'arrivée…</option>
                    {arrivals.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
                  </select>
                  <Icon name="chevron-down" size={15} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>si au plus</span>
                <input type="number" inputMode="numeric" min="0" max="50" value={form.arrivalThreshold}
                  aria-label="Seuil d'arrivée" onChange={(e) => setField("arrivalThreshold", e.target.value)}
                  className="field mono" style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>places libres</span>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">Début</span>
          <input type="time" value={form.timeStart} onChange={(e) => setField("timeStart", e.target.value)} className="field mono" aria-label="Début" />
        </label>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">Fin</span>
          <input type="time" value={form.timeEnd} onChange={(e) => setField("timeEnd", e.target.value)} className="field mono" aria-label="Fin" />
        </label>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={form.oneShot} onChange={(e) => setField("oneShot", e.target.checked)} />
        <span>{form.validOn ? `Uniquement le ${fmtDay(form.validOn)}` : "Aujourd'hui seulement"} (supprimée ensuite)</span>
      </label>

      {!form.oneShot && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="form-label">Jours</span>
          <DayPicker value={form.days} onChange={(d) => setField("days", d)} />
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="form-submit-row">
        {editing && <button type="button" className="cancel-btn" onClick={onCancel}>Annuler</button>}
        <button type="submit" data-autofocus className="submit-btn">
          {editing ? "Enregistrer" : "Créer l'alerte"}
        </button>
      </div>
    </form>
  );
}

export default function Alerts() {
  const { favorites } = useFavorites();
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [pausedUntil, setPausedUntil] = useState(null);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // Station transmise par « Créer une alerte » (fiche station) : formulaire pré-rempli.
  const [preset] = useState(() => location.state?.alertStation ?? null);
  const [form, setForm] = useState(() => defaultForm(preset));

  const setField = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

  // Stations proposées : favoris + station pré-remplie + stations de l'alerte éditée.
  const stations = [...favorites];
  const addOption = (id, name) => {
    if (id && !stations.some((s) => s.station_id === id)) stations.unshift({ station_id: id, station_name: name });
  };
  if (preset) addOption(preset.station_id, preset.name);
  if (editing) {
    addOption(editing.arrival_station_id, editing.arrival_station_name);
    addOption(editing.station_id, editing.station_name);
  }
  const names = Object.fromEntries(stations.map((s) => [s.station_id, s.station_name]));

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/alerts");
      setAlerts(data.alerts);
      setPausedUntil(data.paused_until ?? null);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Préremplissage consommé : on nettoie l'historique (un retour arrière ne le rejoue pas)
  // et, sur mobile, on ouvre directement le formulaire.
  useEffect(() => {
    if (!preset) return;
    navigate(location.pathname, { replace: true, state: null });
    if (isMobile) setSheetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Station par défaut = premier favori, dès qu'ils sont chargés.
  useEffect(() => {
    if (!editing) setForm((f) => (f.stationId ? f : { ...f, stationId: favorites[0]?.station_id ?? "" }));
  }, [favorites, editing]);

  const resetForm = useCallback(() => {
    setForm({ ...defaultForm(), stationId: favorites[0]?.station_id ?? "" });
  }, [favorites]);

  const startEdit = (a) => {
    setEditing(a);
    setForm(formFromAlert(a));
    setError(null);
    if (isMobile) setSheetOpen(true);
  };

  const cancelEdit = useCallback(() => {
    setEditing(null);
    resetForm();
    setSheetOpen(false);
    setError(null);
  }, [resetForm]);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const invalid = validateForm(form);
    if (invalid) { setError(invalid); return; }
    const body = payloadFromForm(form, names);
    try {
      if (editing) await api(`/api/alerts/${editing.id}`, { method: "PATCH", body });
      else await api("/api/alerts", { method: "POST", body });
      setSheetOpen(false);
      setEditing(null);
      resetForm();
      reload();
    } catch (err) { setError(err.message); }
  };

  const toggle = async (a) => {
    try { await api(`/api/alerts/${a.id}`, { method: "PATCH", body: { active: !a.active } }); reload(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (a) => {
    try { await api(`/api/alerts/${a.id}`, { method: "DELETE" }); reload(); }
    catch (e) { setError(e.message); }
  };

  const activeCount = alerts.filter((a) => a.active).length;
  const formProps = { stations, form, setField, error, onSubmit: save, onCancel: cancelEdit, editing };

  return (
    <>
      <div className="alertes-layout">
        <div className="alertes-list">
          <div className="page-head">
            <h2 className="page-title">Mes alertes</h2>
            {alerts.length > 0 && <span className="page-count">{activeCount} active{activeCount !== 1 ? "s" : ""}</span>}
          </div>

          <PushBanner />
          {alerts.length > 0 && <PauseControl pausedUntil={pausedUntil} onChange={setPausedUntil} />}

          {alerts.length === 0 ? (
            <div className="empty-state">
              <Icon name="bell" size={40} />
              <div className="empty-title">Aucune alerte configurée</div>
              <div className="empty-sub">Touchez « + » pour en créer une.</div>
            </div>
          ) : (
            alerts.map((a) => (
              <AlertCard key={a.id} a={a} paused={!!pausedUntil} onToggle={toggle} onDelete={remove} onEdit={startEdit} />
            ))
          )}

          {error && !sheetOpen && <div className="form-error">{error}</div>}
        </div>

        <div className="alert-form-panel">
          <AlertForm {...formProps} />
        </div>
      </div>

      <button className="fab" aria-label="Créer une alerte" onClick={() => { cancelEdit(); setSheetOpen(true); }}>
        <Icon name="plus" />
      </button>
      <BottomSheet open={sheetOpen} onClose={cancelEdit} heightVh={88}>
        <AlertForm {...formProps} />
      </BottomSheet>
    </>
  );
}
