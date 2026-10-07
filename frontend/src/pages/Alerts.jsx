import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useFavorites, useIsMobile } from "../hooks";
import { usePushState, useNotificationPrefs } from "../components/PushControls";
import {
  ALL_DAYS, defaultForm, formFromAlert, validateForm, payloadFromForm, describeAlert,
  tripAllowed, groupRuleText, LIST_FILTERS, LIST_SORTS, loadListPrefs, saveListPrefs, visibleAlerts, hasBothKinds, localYmd, addDaysYmd, fmtDay, GROUP_MIN, GROUP_MAX, GROUP_NAME_MAX,
  SEND_TIMES_MAX, nextSendTime, copyForm,
} from "../lib/alerts";
import BottomSheet from "../components/BottomSheet";
import SwipeRow from "../components/SwipeRow";
import Icon from "../components/Icon";
import TrainAlertsList from "../components/trains/TrainAlertsList";
import { useTrainAlerts } from "../trainHooks";
import DayPicker from "../components/DayPicker";
import Seg from "../components/Seg";

const BIKE_OPTIONS = [
  { value: "mechanical", label: "Mécanique" },
  { value: "ebike",      label: "Électrique" },
  { value: "any",        label: "Les deux" },
];
const TARGET_OPTIONS = [
  { value: "bikes", label: "Vélos" },
  { value: "docks", label: "Places libres" },
];
const KIND_OPTIONS = [
  { value: "threshold", label: "Alerte de disponibilité" },
  { value: "summary",   label: "Résumé à heure fixe" },
];
const KIND_HINT = {
  threshold: "Une notification seulement quand la disponibilité franchit votre seuil.",
  summary:   "Chaque jour choisi, aux heures dites, le nombre de vélos de vos stations.",
};
const MODE_OPTIONS = [
  { value: "single", label: "Une station" },
  { value: "group",  label: "Plusieurs stations" },
];
const COMPARISON_OPTIONS = [
  { value: "at_most",  label: "Il en reste peu" },
  { value: "at_least", label: "Il y en a de nouveau" },
];

/**
 * Notifications de cet appareil : activation sur clic (exigé par iOS, jamais
 * automatique) ; coupées dans les Paramètres ⇒ avertissement + réactivation ;
 * actives ⇒ rien (le test est dans Paramètres › Notifications).
 */
function PushBanner() {
  const { status, busy, enable } = usePushState();
  if (status === "unsupported") return null;

  if (status === "denied") {
    return (
      <div className="push-banner">
        <Icon name="bell" size={18} />
        <span>Notifications bloquées : autorisez-les dans les réglages de l'appareil pour recevoir vos alertes.</span>
      </div>
    );
  }
  // Actives : rien à signaler (la notification de test est dans Paramètres › Notifications).
  if (status === "on") return null;
  const off = status === "off";
  return (
    <div className={"push-banner" + (off ? " warn" : "")} role={off ? "status" : undefined}>
      <Icon name="bell" size={18} />
      <span>
        {off
          ? <>Notifications désactivées sur cet appareil : vos alertes ne s'afficheront pas ici. <Link to="/compte?onglet=notifications">Paramètres</Link></>
          : "Activez les notifications pour être prévenu de vos alertes."}
      </span>
      <button type="button" className="push-banner-btn" disabled={busy} onClick={enable}>
        {busy ? "…" : off ? "Réactiver" : "Activer"}
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

const KIND_BADGE = {
  threshold: { icon: "bell",  label: "Alerte de disponibilité" },
  summary:   { icon: "clock", label: "Résumé à heure fixe" },
};
// Vélos surveillés, en icônes (pas de mot « vélo » sur la carte) ; les deux types ⇒ deux icônes.
const BIKE_TYPE_ICONS = {
  ebike:      { icons: ["bolt"],         label: "Vélos électriques" },
  mechanical: { icons: ["bike"],         label: "Vélos mécaniques" },
  any:        { icons: ["bolt", "bike"], label: "Vélos électriques et mécaniques" },
};

/**
 * Carte d'alerte : type (alerte / résumé) et type de vélo en icônes, jours modifiables
 * directement ; suppression en glissant la carte (ou depuis le formulaire).
 */
function AlertCard({ a, onToggle, onDelete, onEdit, onCopy, onDays, paused }) {
  const { title, detail, bikeType } = describeAlert(a);
  const kind = KIND_BADGE[a.kind === "summary" ? "summary" : "threshold"];
  return (
    <SwipeRow onDelete={() => onDelete(a)} label={`Supprimer ${title}`}>
      <div className={"alert-card" + (a.active && !paused ? "" : " off")}>
        <div className="alert-card-head">
          <span className={`alert-kind ${a.kind === "summary" ? "summary" : ""}`} role="img"
            aria-label={kind.label} title={kind.label}>
            <Icon name={kind.icon} size={18} />
          </span>
          {/* Appui sur le nom (ou le détail) = modifier l'alerte. */}
          <button type="button" className="alert-card-main" title="Modifier l'alerte" onClick={() => onEdit(a)}>
            <span className="alert-card-name">{title}</span>
            <span className="alert-card-sub">
              {BIKE_TYPE_ICONS[bikeType] && (
                <span role="img" aria-label={BIKE_TYPE_ICONS[bikeType].label} title={BIKE_TYPE_ICONS[bikeType].label} className="alert-bike-icons">
                  {BIKE_TYPE_ICONS[bikeType].icons.map((name) => <Icon key={name} name={name} size={14} />)}
                </span>
              )}
              <span>{detail}</span>
            </span>
          </button>
          <button role="switch" aria-checked={!!a.active} aria-label={a.active ? "Désactiver" : "Activer"}
            className={"switch" + (a.active ? " on" : "")} onClick={() => onToggle(a)}>
            <span className="switch-knob" />
          </button>
          <button className="alert-edit" aria-label="Dupliquer" onClick={() => onCopy(a)}>
            <Icon name="copy" size={16} />
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {a.valid_on
            ? <span className="alert-once"><Icon name="calendar" size={14} /> Uniquement le {fmtDay(a.valid_on)}</span>
            : <DayPicker value={a.days ? a.days.split(",").map(Number) : ALL_DAYS} onChange={(d) => onDays(a, d)} />}
        </div>
      </div>
    </SwipeRow>
  );
}

/** Cases à cocher des stations (groupe d'alerte ou résumé) + nom facultatif. */
function StationPicker({ stations, form, setField, min }) {
  const toggle = (id) => {
    const ids = form.groupIds.includes(id) ? form.groupIds.filter((x) => x !== id) : [...form.groupIds, id];
    setField("groupIds", ids);
  };
  return (
    <div className="trip-box">
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Nom du groupe (facultatif)</span>
        <input type="text" className="field" value={form.groupName} maxLength={GROUP_NAME_MAX}
          placeholder="ex. Maison, Travail" aria-label="Nom du groupe"
          onChange={(e) => setField("groupName", e.target.value)} />
      </label>
      <span className="form-label">Stations ({form.groupIds.length}/{GROUP_MAX})</span>
      {stations.length < min && <div className="form-hint">Ajoutez au moins deux stations en favoris.</div>}
      {stations.map((f) => {
        const checked = form.groupIds.includes(f.station_id);
        return (
          <label key={f.station_id} className="check-row">
            <input type="checkbox" checked={checked}
              disabled={!checked && form.groupIds.length >= GROUP_MAX}
              onChange={() => toggle(f.station_id)} />
            <span>{f.station_name}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Heures d'envoi d'un résumé : 1 à 6, ajout / retrait (la dernière ne se retire pas). */
function SendTimesPicker({ value, onChange }) {
  const set = (i, t) => onChange(value.map((v, j) => (j === i ? t : v)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="form-label">{value.length > 1 ? "Heures d'envoi" : "Heure d'envoi"}</span>
      <div className="send-times">
        {value.map((t, i) => (
          <div key={i} className="send-time">
            <input type="time" value={t} onChange={(e) => set(i, e.target.value)} className="field mono"
              aria-label={value.length > 1 ? `Heure d'envoi ${i + 1}` : "Heure d'envoi"} />
            {value.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Retirer l'heure ${t || i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {value.length < SEND_TIMES_MAX ? (
        <button type="button" className="send-time-add" onClick={() => onChange([...value, nextSendTime(value)])}>
          <Icon name="plus" size={15} /> Ajouter une heure
        </button>
      ) : (
        <span className="form-hint">{SEND_TIMES_MAX} heures maximum.</span>
      )}
    </div>
  );
}

/** Suppression depuis le formulaire : un premier appui demande confirmation. */
function DeleteAlertButton({ onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <button type="button" className={"alert-del-btn" + (confirm ? " confirm" : "")}
      onClick={() => (confirm ? onDelete() : setConfirm(true))}>
      <Icon name="trash" size={16} /> {confirm ? "Confirmer la suppression" : "Supprimer l'alerte"}
    </button>
  );
}

function AlertForm({ stations, form, setField, error, onSubmit, onCancel, onDelete, editing, copying }) {
  if (stations.length === 0) {
    return <div style={{ fontSize: 14, color: "var(--text-3)" }}>Ajoutez d'abord des stations en favoris.</div>;
  }
  const unit = form.target === "docks" ? "places libres" : "vélos disponibles";
  const arrivals = stations.filter((s) => s.station_id !== form.stationId);

  const summary = form.kind === "summary";
  // Premier passage à plusieurs stations : on part de la station déjà choisie.
  const seedGroup = () => {
    if (form.groupIds.length === 0 && form.stationId) setField("groupIds", [form.stationId]);
  };
  const setMode = (mode) => {
    setField("group", mode === "group");
    if (mode === "group") seedGroup();
  };
  const setKind = (kind) => {
    setField("kind", kind);
    if (kind === "summary") seedGroup();
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-label="Formulaire d'alerte">
      <div className="form-title">{editing ? "Modifier l'alerte" : copying ? "Dupliquer l'alerte" : "Nouvelle alerte"}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Seg label="Type d'alerte" options={KIND_OPTIONS} value={form.kind} onChange={setKind} />
        <span className="form-hint">{KIND_HINT[form.kind]}</span>
      </div>

      {summary ? (
        <>
          <StationPicker stations={stations} form={form} setField={setField} min={1} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="form-label">Type de vélo</span>
            <Seg label="Type de vélo" options={BIKE_OPTIONS} value={form.bikeType} onChange={(v) => setField("bikeType", v)} />
          </div>
          <SendTimesPicker value={form.sendTimes} onChange={(v) => setField("sendTimes", v)} />
        </>
      ) : (<>
      <Seg label="Stations surveillées" options={MODE_OPTIONS} value={form.group ? "group" : "single"} onChange={setMode} />

      {form.group ? (
        <StationPicker stations={stations} form={form} setField={setField} min={GROUP_MIN} />
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">{form.trip && tripAllowed(form) ? "Station de départ" : "Station"}</span>
          <div className="select-wrap select-inset">
            <select value={form.stationId} onChange={(e) => setField("stationId", e.target.value)} required aria-label="Station">
              {stations.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
            </select>
            <Icon name="chevron-down" size={15} />
          </div>
        </label>
      )}

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
        {form.group && <span className="form-hint">{groupRuleText(form)}</span>}
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
      </>)}

      {(summary || !form.oneShot) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="form-label">Jours</span>
          <DayPicker value={form.days} onChange={(d) => setField("days", d)} />
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="form-submit-row">
        {(editing || copying) && <button type="button" className="cancel-btn" onClick={onCancel}>Annuler</button>}
        <button type="submit" data-autofocus className="submit-btn">
          {editing ? "Enregistrer" : copying ? "Créer la copie" : summary ? "Créer le résumé" : "Créer l'alerte"}
        </button>
        {editing && <DeleteAlertButton key={editing.id} onDelete={() => onDelete(editing)} />}
      </div>
    </form>
  );
}

/** Filtre par type (si les deux coexistent) + tri de la liste. */
function ListControls({ prefs, onChange, showFilter }) {
  return (
    <div className="alerts-list-controls">
      {showFilter && (
        <Seg label="Filtrer les alertes" options={LIST_FILTERS} value={prefs.filter}
          onChange={(filter) => onChange({ ...prefs, filter })} />
      )}
      <div className="select-wrap">
        <select value={prefs.sort} aria-label="Trier les alertes" onChange={(e) => onChange({ ...prefs, sort: e.target.value })}>
          {LIST_SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down" size={15} />
      </div>
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: "velos",  label: "Vélos" },
  { value: "trains", label: "Trains" },
];

export default function Alerts() {
  // Vélos ou trains (?type=trains) : notifications et pause globale sont communes.
  const [params, setParams] = useSearchParams();
  const type = params.get("type") === "trains" ? "trains" : "velos";
  const trains = useTrainAlerts(type === "trains");
  const { prefs: kinds } = useNotificationPrefs();
  const kindOff = kinds && !kinds[type === "trains" ? "trains" : "bikes"];
  const { favorites } = useFavorites();
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [pausedUntil, setPausedUntil] = useState(null);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copying, setCopying] = useState(null); // alerte dupliquée (formulaire de création pré-rempli)
  const [listPrefs, setListPrefs] = useState(loadListPrefs);
  const changeListPrefs = (p) => { setListPrefs(p); saveListPrefs(p); };
  // Station transmise par « Créer une alerte » (fiche station) : formulaire pré-rempli.
  const [preset] = useState(() => location.state?.alertStation ?? null);
  const [form, setForm] = useState(() => defaultForm(preset));

  const setField = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

  // Stations proposées : favoris + station pré-remplie + stations de l'alerte éditée / dupliquée.
  const stations = [...favorites];
  const addOption = (id, name) => {
    if (id && !stations.some((s) => s.station_id === id)) stations.unshift({ station_id: id, station_name: name });
  };
  if (preset) addOption(preset.station_id, preset.name);
  const source = editing ?? copying;
  if (source) {
    for (const g of source.group_stations ?? []) addOption(g.station_id, g.station_name);
    addOption(source.arrival_station_id, source.arrival_station_name);
    addOption(source.station_id, source.station_name);
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
    setCopying(null);
    setForm(formFromAlert(a));
    setError(null);
    if (isMobile) setSheetOpen(true);
  };

  // Dupliquer : rien n'est créé avant « Créer la copie » (on ajuste d'abord station, heure…).
  const startCopy = (a) => {
    setEditing(null);
    setCopying(a);
    setForm(copyForm(a));
    setError(null);
    if (isMobile) setSheetOpen(true);
  };

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setCopying(null);
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
      setCopying(null);
      resetForm();
      reload();
    } catch (err) { setError(err.message); }
  };

  const toggle = async (a) => {
    try { await api(`/api/alerts/${a.id}`, { method: "PATCH", body: { active: !a.active } }); reload(); }
    catch (e) { setError(e.message); }
  };
  // Retirée de la liste tout de suite (le serveur peut être lent à répondre) ; un second
  // appui pendant la requête ne renvoie rien, et un 404 veut dire « déjà supprimée ».
  const deleting = useRef(new Set());
  const remove = async (a) => {
    if (deleting.current.has(a.id)) return;
    deleting.current.add(a.id);
    setError(null);
    setAlerts((list) => list.filter((x) => x.id !== a.id));
    if (editing?.id === a.id) cancelEdit(); // supprimée depuis son formulaire
    try {
      await api(`/api/alerts/${a.id}`, { method: "DELETE" });
    } catch (e) {
      if (e.status !== 404) { setError(e.message); reload(); }
    } finally {
      deleting.current.delete(a.id);
    }
  };
  // Jours changés depuis la carte : affichés tout de suite, enregistrés en arrière-plan.
  const setDays = async (a, days) => {
    const value = days.join(",");
    setAlerts((list) => list.map((x) => (x.id === a.id ? { ...x, days: value } : x)));
    try { await api(`/api/alerts/${a.id}`, { method: "PATCH", body: { days: value } }); }
    catch (e) { setError(e.message); reload(); }
  };

  const activeCount = alerts.filter((a) => a.active).length;
  const showFilter = hasBothKinds(alerts);
  // Filtre masqué (un seul type restant) ⇒ ignoré, sinon la liste pourrait rester vide.
  const shown = visibleAlerts(alerts, { ...listPrefs, filter: showFilter ? listPrefs.filter : "all" });
  const formProps = { stations, form, setField, error, onSubmit: save, onCancel: cancelEdit, onDelete: remove, editing, copying };

  return (
    <>
      <div className={"alertes-layout" + (type === "trains" ? " single" : "")}>
        <div className="alertes-list">
          <div className="page-head">
            <h2 className="page-title">Mes alertes</h2>
            {type === "velos" && alerts.length > 0 && <span className="page-count">{activeCount} active{activeCount !== 1 ? "s" : ""}</span>}
          </div>

          <Seg label="Type d'alertes" options={TYPE_OPTIONS} value={type}
            onChange={(v) => setParams(v === "trains" ? { type: "trains" } : {}, { replace: true })} />
          <PushBanner />
          {kindOff && (
            <div className="push-banner warn" role="status">
              <Icon name="bell" size={18} />
              <span>Alertes {type === "trains" ? "trains" : "vélos"} coupées pour votre compte : elles ne sont pas envoyées. <Link to="/compte?onglet=notifications">Paramètres</Link></span>
            </div>
          )}
          {(alerts.length > 0 || trains.alerts.length > 0) && <PauseControl pausedUntil={pausedUntil} onChange={setPausedUntil} />}
          {type === "trains" ? <TrainAlertsList t={trains} paused={!!pausedUntil} /> : (<>
          {alerts.length > 1 && <ListControls prefs={listPrefs} onChange={changeListPrefs} showFilter={showFilter} />}

          {alerts.length === 0 ? (
            <div className="empty-state">
              <Icon name="bell" size={40} />
              <div className="empty-title">Aucune alerte configurée</div>
              <div className="empty-sub">Touchez « + » pour en créer une.</div>
            </div>
          ) : shown.length === 0 ? (
            <div className="view-state">Aucune alerte de ce type.</div>
          ) : (
            shown.map((a) => (
              <AlertCard key={a.id} a={a} paused={!!pausedUntil} onToggle={toggle} onDelete={remove} onEdit={startEdit} onCopy={startCopy} onDays={setDays} />
            ))
          )}

          {error && !sheetOpen && <div className="form-error">{error}</div>}
          </>)}
        </div>

        {type === "velos" && (
          <div className="alert-form-panel">
            <AlertForm {...formProps} />
          </div>
        )}
      </div>

      {type === "velos" && <button className="fab" aria-label="Créer une alerte" onClick={() => { cancelEdit(); setSheetOpen(true); }}>
        <Icon name="plus" />
      </button>}
      <BottomSheet open={sheetOpen} onClose={cancelEdit} heightVh={88}>
        <AlertForm {...formProps} />
      </BottomSheet>
    </>
  );
}
