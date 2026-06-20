import { useState } from "react";
import { C, bikeColor, fmtTime } from "../theme";

function Bar({ val, max, color }) {
  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
  return (
    <div style={{ height: 3, borderRadius: 2, background: C.dim, marginTop: 7, overflow: "hidden" }}>
      <div style={{ height: "100%", width: pct + "%", background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
    </div>
  );
}

function DockBar({ docks, capacity }) {
  const pct = capacity > 0 ? Math.min(100, (docks / capacity) * 100) : 0;
  return (
    <div style={{ height: 3, borderRadius: 2, background: C.dim, marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: "100%", width: pct + "%", background: "#3A5A8A", borderRadius: 2, transition: "width 0.8s ease" }} />
    </div>
  );
}

export default function StationCard({ s, onClick, isFav, onToggleFav }) {
  const docks   = s.docks_available ?? 0;
  const offline = s.is_renting === false;
  const t       = fmtTime(s.last_reported);
  const [hov, setHov] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        background: C.card, border: `1px solid ${offline ? C.dim : C.border}`,
        borderRadius: 14, padding: 14, opacity: offline ? 0.45 : 1, cursor: "pointer",
        transform: hov && !offline ? "translateY(-2px)" : "none",
        boxShadow: hov && !offline ? "0 6px 24px rgba(0,0,0,0.5)" : "none",
        transition: "transform 0.18s, box-shadow 0.18s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text, letterSpacing: "0.06em", marginBottom: 2 }}>{s.name}</div>
          {s.address?.trim() && (
            <div style={{ fontSize: 9, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.address.trim()}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, flexShrink: 0 }}>
          {offline && (
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: C.muted, background: C.dim, padding: "2px 6px", borderRadius: 4 }}>
              HORS SERVICE
            </span>
          )}
          {onToggleFav && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFav(s); }}
              title={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1,
                fontSize: 16, color: isFav ? C.amber : C.muted,
              }}
            >
              {isFav ? "★" : "☆"}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <div style={{ background: "#080F1E", borderRadius: 10, padding: "9px 11px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: C.elec, letterSpacing: "0.12em", marginBottom: 5, opacity: 0.8 }}>⚡ ÉLEC.</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: bikeColor(s.electrical), lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.electrical}</div>
          <Bar val={s.electrical} max={s.capacity} color={C.elec} />
        </div>
        <div style={{ background: "#080F1E", borderRadius: 10, padding: "9px 11px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: C.meca, letterSpacing: "0.12em", marginBottom: 5, opacity: 0.8 }}>🚲 MÉCA.</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: bikeColor(s.mechanical), lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.mechanical}</div>
          <Bar val={s.mechanical} max={s.capacity} color={C.meca} />
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 500, color: docks > 0 ? "#4B6A9E" : "#EF4444" }}>
            {docks > 0
              ? <><span style={{ color: "#7B9AC0", fontWeight: 700 }}>{docks}</span> place{docks !== 1 ? "s" : ""} libre{docks !== 1 ? "s" : ""}</>
              : "Station pleine"}
          </span>
          {t && <span style={{ fontSize: 9, color: C.muted }}>MAJ {t}</span>}
        </div>
        <DockBar docks={docks} capacity={s.capacity} />
      </div>
    </div>
  );
}
