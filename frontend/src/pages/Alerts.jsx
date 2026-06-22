import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { useFavorites } from "../hooks";
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

function AlertCard({ a, onToggle, onDelete }) {
  const dayVals = a.days ? a.days.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7];
  return (
    <div className={"alert-card" + (a.active ? "" : " off")}>
      <div className="alert-card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="alert-card-name">{a.station_name}</div>
          <div className="alert-card-sub">
            <Icon name={BIKE_ICON[a.bike_type]} size={14} />
            {BIKE_LABEL[a.bike_type]} · &lt; {a.min_count} vélos · {a.time_start}–{a.time_end}
          </div>
        </div>
        <button role="switch" aria-checked={a.active} aria-label={a.active ? "Désactiver" : "Activer"}
          className={"switch" + (a.active ? " on" : "")} onClick={() => onToggle(a)}>
          <span className="switch-knob" />
        </button>
        <button className="alert-del" aria-label="Supprimer" onClick={() => onDelete(a)}><Icon name="trash" size={17} /></button>
      </div>
      <div style={{ marginTop: 12 }}>
        <DayPicker value={dayVals} onChange={() => {}} disabled />
      </div>
    </div>
  );
}

// Formulaire réutilisé dans le bottom sheet (mobile) et le panneau (desktop).
function AlertForm({ favorites, form, error, onSubmit }) {
  const { stationId, setStationId, bikeType, setBikeType, minCount, setMinCount,
          timeStart, setTimeStart, timeEnd, setTimeEnd, days, setDays } = form;

  if (favorites.length === 0) {
    return <div style={{ fontSize: 14, color: "var(--text-3)" }}>Ajoutez d'abord des stations en favoris.</div>;
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="form-title">Nouvelle alerte</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="form-label">Station</span>
        <div className="select-wrap select-inset">
          <select value={stationId} onChange={(e) => setStationId(e.target.value)} required>
            {favorites.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
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
        <span className="form-label">Notifier si moins de</span>
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
        <button type="submit" data-autofocus className="submit-btn">Créer l'alerte</button>
      </div>
    </form>
  );
}

export default function Alerts() {
  const { favorites } = useFavorites();
  const [alerts, setAlerts] = useState([]);
  const [error,  setError]  = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [stationId, setStationId] = useState("");
  const [bikeType,  setBikeType]  = useState("any");
  const [minCount,  setMinCount]  = useState(1);
  const [timeStart, setTimeStart] = useState("08:00");
  const [timeEnd,   setTimeEnd]   = useState("10:00");
  const [days,      setDays]      = useState([1, 2, 3, 4, 5, 6, 7]);

  const reload = useCallback(async () => {
    try { setAlerts((await api("/api/alerts")).alerts); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setStationId((prev) => prev || favorites[0]?.station_id || ""); }, [favorites]);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    const fav = favorites.find((f) => f.station_id === stationId);
    if (!fav) { setError("Choisissez une station favorite"); return; }
    if (!timeStart || !timeEnd || timeEnd <= timeStart) { setError("L'heure de fin doit être postérieure à l'heure de début"); return; }
    try {
      await api("/api/alerts", { method: "POST", body: {
        station_id: fav.station_id, station_name: fav.station_name,
        bike_type: bikeType, min_count: Number(minCount),
        time_start: timeStart, time_end: timeEnd, days: days.join(","),
      }});
      setSheetOpen(false);
      reload();
    } catch (e) { setError(e.message); }
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
    onSubmit: create,
  };

  return (
    <>
      <div className="alertes-layout">
        <div className="alertes-list">
          <div className="page-head">
            <h2 className="page-title">Mes alertes</h2>
            {alerts.length > 0 && <span className="page-count">{activeCount} active{activeCount !== 1 ? "s" : ""}</span>}
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state">
              <Icon name="bell" size={40} />
              <div className="empty-title">Aucune alerte configurée</div>
              <div className="empty-sub">Touchez « + » pour en créer une.</div>
            </div>
          ) : (
            alerts.map((a) => <AlertCard key={a.id} a={a} onToggle={toggle} onDelete={remove} />)
          )}

          {error && !sheetOpen && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        </div>

        <div className="alert-form-panel">
          <AlertForm {...formProps} />
        </div>
      </div>

      <button className="fab" aria-label="Créer une alerte" onClick={() => { setError(null); setSheetOpen(true); }}>
        <Icon name="plus" />
      </button>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} heightVh={88}>
        <AlertForm {...formProps} />
      </BottomSheet>
    </>
  );
}
