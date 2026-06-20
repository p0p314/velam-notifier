import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { useFavorites } from "../hooks";
import BottomSheet from "../components/BottomSheet";
import { C } from "../theme";

const BIKE_LABEL = { mechanical: "🚲 Mécanique", ebike: "⚡ Électrique", any: "Tous types" };
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
    if (value.includes(day) && value.length === 1) return; // min 1 jour
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
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, opacity: a.active ? 1 : 0.55, boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{a.station_name}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            {BIKE_LABEL[a.bike_type]} · moins de {a.min_count} vélo(s) · {a.time_start}–{a.time_end}
          </div>
        </div>
        <button onClick={() => onToggle(a)} style={{
          minHeight: 44, padding: "0 12px", background: a.active ? "#0A1A12" : C.dim,
          border: `1px solid ${a.active ? "#13402C" : C.border}`, borderRadius: 99,
          color: a.active ? C.green : C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>{a.active ? "Active" : "Inactive"}</button>
        <button onClick={() => onDelete(a)} aria-label="Supprimer" style={{
          minWidth: 44, minHeight: 44, background: "none", border: "none", color: "#B3473F", fontSize: 18, cursor: "pointer",
        }}>🗑</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <DayPicker value={dayVals} onChange={() => {}} disabled />
      </div>
    </div>
  );
}

const lbl = { fontSize: 13, color: C.muted, fontWeight: 600 };
const fieldStyle = { minHeight: 44, background: "#080F1E", border: `1px solid ${C.border}`, borderRadius: 10, padding: "0 12px", color: C.text, outline: "none" };

// Formulaire réutilisé dans le bottom sheet (mobile) et le panneau (desktop).
function AlertForm({ favorites, form, error, onSubmit }) {
  const { stationId, setStationId, bikeType, setBikeType, minCount, setMinCount,
          timeStart, setTimeStart, timeEnd, setTimeEnd, days, setDays } = form;

  if (favorites.length === 0) {
    return <div style={{ fontSize: 14, color: C.muted }}>Ajoutez d'abord des stations en favoris.</div>;
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Nouvelle alerte</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={lbl}>Station</span>
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} required style={fieldStyle}>
          {favorites.map((f) => <option key={f.station_id} value={f.station_id}>{f.station_name}</option>)}
        </select>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={lbl}>Type de vélo</span>
        <div className="seg">
          {BIKE_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={bikeType === o.value ? "active" : ""} onClick={() => setBikeType(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={lbl}>Notifier si moins de X vélos disponibles</span>
        <input type="number" inputMode="numeric" min="1" value={minCount}
          onChange={(e) => setMinCount(e.target.value)} style={fieldStyle} />
      </label>

      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={lbl}>Début</span>
          <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} style={fieldStyle} />
        </label>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={lbl}>Fin</span>
          <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} style={fieldStyle} />
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={lbl}>Jours</span>
        <DayPicker value={days} onChange={setDays} />
      </div>

      {error && <div style={{ color: "#FCA5A5", fontSize: 13 }}>{error}</div>}

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

  // État du formulaire (partagé entre le sheet mobile et le panneau desktop)
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

  // Au montage / changement de favoris, présélectionne la 1re station.
  useEffect(() => {
    setStationId((prev) => prev || favorites[0]?.station_id || "");
  }, [favorites]);

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
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>Mes alertes</h2>

          {alerts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 16px", color: C.muted }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.7 }}>🔔</div>
              <div style={{ fontSize: 15 }}>Aucune alerte configurée</div>
              <div style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>Touchez « + » pour en créer une.</div>
            </div>
          ) : (
            alerts.map((a) => <AlertCard key={a.id} a={a} onToggle={toggle} onDelete={remove} />)
          )}

          {error && !sheetOpen && <div style={{ color: "#FCA5A5", fontSize: 13 }}>{error}</div>}
        </div>

        {/* Desktop : formulaire toujours visible (masqué en mobile via CSS) */}
        <div className="alert-form-panel">
          <AlertForm {...formProps} />
        </div>
      </div>

      {/* Mobile : FAB + bottom sheet */}
      <button className="fab" aria-label="Créer une alerte" onClick={() => { setError(null); setSheetOpen(true); }}>+</button>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} heightVh={85}>
        <AlertForm {...formProps} />
      </BottomSheet>
    </>
  );
}
