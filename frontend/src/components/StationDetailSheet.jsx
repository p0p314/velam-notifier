import BottomSheet from "./BottomSheet";
import { C, fmtTime } from "../theme";

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.dim}` }}>
      <span style={{ fontSize: 15, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 800, color: color ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export default function StationDetailSheet({ station, open, onClose, isFav, onToggleFav }) {
  const s = station;
  const offline = s?.is_renting === false;
  const t = s ? fmtTime(s.last_reported) : null;

  return (
    <BottomSheet open={open} onClose={onClose} heightVh={70} labelledBy="sheet-station-title">
      {s && (
        <>
          <div id="sheet-station-title" style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{s.name}</div>
          {s.address?.trim() && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{s.address.trim()}</div>}

          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, margin: "14px 0 4px", background: offline ? "#1A1010" : "#0A1A12", border: `1px solid ${offline ? "#3B1515" : "#13402C"}`, borderRadius: 99, padding: "5px 12px" }}>
            <span className={"status-dot " + (offline ? "closed" : "open")} style={{ width: 8, height: 8 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: offline ? "#FCA5A5" : C.green }}>{offline ? "Fermée" : "Ouverte"}</span>
          </div>

          <Row label="⚡ Vélos électriques" value={s.electrical ?? 0} color={C.elec} />
          <Row label="🚲 Vélos mécaniques" value={s.mechanical ?? 0} color={C.meca} />
          <Row label="🅿️ Places libres"     value={s.docks_available ?? 0} color="#7B9AC0" />

          <div style={{ display: "flex", justifyContent: "space-between", margin: "12px 0 18px", fontSize: 12, color: C.muted }}>
            <span>Capacité : {s.capacity ?? 0}</span>
            {t && <span>MAJ {t}</span>}
          </div>

          <button
            onClick={() => onToggleFav(s)}
            style={{
              width: "100%", minHeight: 52, borderRadius: 12, cursor: "pointer",
              fontSize: 16, fontWeight: 700,
              background: isFav ? C.dim : "var(--color-primary)",
              border: isFav ? `1px solid ${C.border}` : "none",
              color: isFav ? C.text : "#fff",
            }}
          >
            {isFav ? "★ Retirer des favoris" : "☆ Ajouter aux favoris"}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
