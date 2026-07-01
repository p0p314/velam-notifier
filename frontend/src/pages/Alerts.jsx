import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { useFavorites } from "../hooks";
import { pushSupported, notifPermission, registerPush } from "../push";
import BottomSheet from "../components/BottomSheet";
import Icon from "../components/Icon";

const BIKE_LABEL = { mechanical: "Mécanique", ebike: "Électrique", any: "Tous types" };
const BIKE_ICON  = { mechanical: "bike", ebike: "bolt", any: "bike" };
const BIKE_OPTIONS = [
  { value: "mechanical", label: "Mécanique" },
  { value: "ebike",      label: "Électrique" },
  { value: "any",        label: "Les deux" },
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

function AlertCard({ a, onToggle, onDelete, onEdit }) {
  const dayVals = a.days ? a.days.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7];
  return (
    <div className={"alert-card" + (a.active ? "" : " off")}>
      <div className="alert-card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="alert-card-name">{a.station_name}</div>
          <div className="alert-card-sub">
            <Icon name={BIKE_ICON[a.bike_type]} size={14} />
            {BIKE_LABEL[a.bike_type]} · ≤ {a.min_count} vélos · {a.time_start}–{a.time_end}
          </div>
        </div>
        <button role="switch" aria-checked={a.active} aria-label={a.active ? "Désactiver" : "Activer"}
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
        <DayPicker value={dayVals} onChange={() => {}} disabled />
      </div>
    </div>
  );
}

function AlertForm({ favorites, form, error, onSubmit, onCancel, editingAlert }) {
  const { stationId, setStationId, bikeType, setBikeType, minCount, setMinCount,
          timeStart, setTimeStart, timeEnd, setTimeEnd, days, setDays } = form;

  // Inclure la station de l'alerte si elle n'est plus dans les favoris
  const stationOptions = editingAlert && !favorites.find((f) => f.station_id === editingAlert.station_id)
    ? [{ station_id: editingAlert.station_id, station_name: editingAlert.station_name }, ...favorites]
    : favorites;

  if (stationOptions.length === 0) {
    return <div style={{ fontSize: 14, color: "var(--text-3)" }}>Ajoutez d'abord des stations en favoris.</div>;
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="form-title">{editingAlert ? "Modifier l'alerte" : "Nouvelle alerte"}</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Station</span>
        <div className="select-wrap select-inset">
          <select value={stationId} onChange={(e) => setStationId(e.target.value)} required>
            {stationOptions.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
          </select>
          <Icon name="chevron-down" size={15} />
        </div>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Type de vélo</span>
        <div className="seg">
          {BIKE_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={bikeType === o.value ? "active" : ""} onClick={() => setBikeType(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Notifier si au plus</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="number" inputMode="numeric" min="1" max="50" value={minCount}
            onChange={(e) => setMinCount(e.target.value)} className="field mono" style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>vélos disponibles</span>
        </div>
      </label>

      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">Début</span>
          <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} className="field mono" />
        </label>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="form-label">Fin</span>
          <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} className="field mono" />
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="form-label">Jours</span>
        <DayPicker value={days} onChange={setDays} />
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}

      <div className="form-submit-row">
        {editingAlert && (
          <button type="button" className="cancel-btn" onClick={onCancel}>Annuler</button>
        )}
        <button type="submit" data-autofocus className="submit-btn">
          {editingAlert ? "Enregistrer" : "Créer l'alerte"}
        </button>
      </div>
    </form>
  );
}

export default function Alerts() {
  const { favorites } = useFavorites();
  const [alerts, setAlerts] = useState([]);
  const [error,  setError]  = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [notifPerm, setNotifPerm] = useState(() => notifPermission());

  const [stationId, setStationId] = useState("");
  const [bikeType,  setBikeType]  = useState("any");
  const [minCount,  setMinCount]  = useState(1);
  const [timeStart, setTimeStart] = useState("08:00");
  const [timeEnd,   setTimeEnd]   = useState("10:00");
  const [days,      setDays]      = useState([1, 2, 3, 4, 5, 6, 7]);

  const enableNotifs = async () => {
    const ok = await registerPush();
    setNotifPerm(notifPermission());
    if (!ok && Notification.permission === "denied") setNotifPerm("denied");
  };

  const reload = useCallback(async () => {
    try { setAlerts((await api("/api/alerts")).alerts); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!editingAlert) setStationId((prev) => prev || favorites[0]?.station_id || "");
  }, [favorites, editingAlert]);

  const resetForm = useCallback(() => {
    setStationId(favorites[0]?.station_id || "");
    setBikeType("any");
    setMinCount(1);
    setTimeStart("08:00");
    setTimeEnd("10:00");
    setDays([1, 2, 3, 4, 5, 6, 7]);
  }, [favorites]);

  const startEdit = (a) => {
    setEditingAlert(a);
    setStationId(a.station_id);
    setBikeType(a.bike_type);
    setMinCount(a.min_count);
    setTimeStart(a.time_start);
    setTimeEnd(a.time_end);
    setDays(a.days ? a.days.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7]);
    setError(null);
    if (window.innerWidth < 769) setSheetOpen(true);
  };

  const cancelEdit = useCallback(() => {
    setEditingAlert(null);
    resetForm();
    setSheetOpen(false);
    setError(null);
  }, [resetForm]);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!timeStart || !timeEnd || timeEnd <= timeStart) {
      setError("L'heure de fin doit être postérieure à l'heure de début");
      return;
    }

    if (editingAlert) {
      const selectedFav = favorites.find((f) => f.station_id === stationId);
      const stationName = selectedFav?.station_name ?? editingAlert.station_name;
      try {
        await api(`/api/alerts/${editingAlert.id}`, { method: "PATCH", body: {
          station_id: stationId, station_name: stationName,
          bike_type: bikeType, min_count: Number(minCount),
          time_start: timeStart, time_end: timeEnd, days: days.join(","),
        }});
        setSheetOpen(false);
        setEditingAlert(null);
        resetForm();
        reload();
      } catch (err) { setError(err.message); }
    } else {
      const fav = favorites.find((f) => f.station_id === stationId);
      if (!fav) { setError("Choisissez une station favorite"); return; }
      try {
        await api("/api/alerts", { method: "POST", body: {
          station_id: fav.station_id, station_name: fav.station_name,
          bike_type: bikeType, min_count: Number(minCount),
          time_start: timeStart, time_end: timeEnd, days: days.join(","),
        }});
        setSheetOpen(false);
        reload();
      } catch (err) { setError(err.message); }
    }
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
  const formProps = {
    favorites,
    form: { stationId, setStationId, bikeType, setBikeType, minCount, setMinCount,
            timeStart, setTimeStart, timeEnd, setTimeEnd, days, setDays },
    error,
    onSubmit: save,
    onCancel: cancelEdit,
    editingAlert,
  };

  return (
    <>
      <div className="alertes-layout">
        <div className="alertes-list">
          <div className="page-head">
            <h2 className="page-title">Mes alertes</h2>
            {alerts.length > 0 && <span className="page-count">{activeCount} active{activeCount !== 1 ? "s" : ""}</span>}
          </div>

          {pushSupported() && notifPerm !== "granted" && notifPerm !== "unsupported" && (
            <div className="notif-banner">
              <Icon name="bell" size={15} />
              {notifPerm === "denied" ? (
                <span>Notifications bloquées — autorisez-les dans les paramètres du navigateur.</span>
              ) : (
                <>
                  <span>Activez les notifications pour recevoir vos alertes.</span>
                  <button className="notif-banner-btn" onClick={enableNotifs}>Activer</button>
                </>
              )}
            </div>
          )}

          {alerts.length === 0 ? (
            <div className="empty-state">
              <Icon name="bell" size={40} />
              <div className="empty-title">Aucune alerte configurée</div>
              <div className="empty-sub">Touchez « + » pour en créer une.</div>
            </div>
          ) : (
            alerts.map((a) => (
              <AlertCard key={a.id} a={a} onToggle={toggle} onDelete={remove} onEdit={startEdit} />
            ))
          )}

          {error && !sheetOpen && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
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
