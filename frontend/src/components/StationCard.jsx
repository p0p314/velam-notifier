import Icon from "./Icon";
import { fmtTime } from "../theme";
import { fmtDistance } from "../hooks";

function statusOf(s) {
  if (s.is_renting === false) return { cls: "closed", label: "Hors service" };
  const total = (s.electrical ?? 0) + (s.mechanical ?? 0);
  if (total <= 2) return { cls: "warn", label: "Faible" };
  return { cls: "open", label: "Ouverte" };
}

function MiniStat({ kind, label, value, max, offline }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const isElec = kind === "elec";
  const low = !offline && value <= 2;
  return (
    <div className="mini-stat">
      <div className={"mini-stat-label " + kind}>
        <Icon name={isElec ? "bolt" : "bike"} size={13} /> {label}
      </div>
      <div className="mini-stat-value" style={low ? { color: "var(--warn)" } : null}>
        {offline ? "—" : value}
      </div>
      <div className="mini-bar">
        <div className="mini-bar-fill" style={{ width: (offline ? 0 : pct) + "%", background: isElec ? "var(--accent)" : "var(--neutral-bar)" }} />
      </div>
    </div>
  );
}

export default function StationCard({ s, onClick, isFav, onToggleFav, dist }) {
  const docks   = s.docks_available ?? 0;
  const offline = s.is_renting === false;
  const t       = fmtTime(s.last_reported);
  const st      = statusOf(s);
  const distLabel = fmtDistance(dist);

  return (
    <div className={"sc-card" + (offline ? " offline" : "")} onClick={onClick} role="button" tabIndex={0}>
      <div className="sc-head">
        <div style={{ minWidth: 0 }}>
          <div className="sc-name">{s.name}</div>
          {s.address?.trim() && <div className="sc-addr">{s.address.trim()}</div>}
          {distLabel && <div className="sc-dist"><Icon name="map-pin" size={12} /> {distLabel}</div>}
        </div>
        <div className="sc-head-right">
          {onToggleFav && (
            <button
              className={"sc-fav" + (isFav ? " on" : "")}
              onClick={(e) => { e.stopPropagation(); onToggleFav(s); }}
              aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
            >
              <Icon name="star" size={17} style={isFav ? { fill: "var(--accent)" } : null} />
            </button>
          )}
          <span className={"status-pill " + st.cls}><span className="dot" />{st.label}</span>
        </div>
      </div>

      <div className="sc-stats">
        <MiniStat kind="elec" label="ÉLEC." value={s.electrical ?? 0} max={s.capacity} offline={offline} />
        <MiniStat kind="meca" label="MÉCA." value={s.mechanical ?? 0} max={s.capacity} offline={offline} />
      </div>

      <div className="sc-foot">
        <span>{offline ? "Indisponible" : `${docks} place${docks !== 1 ? "s" : ""} libre${docks !== 1 ? "s" : ""}`}</span>
        {t && <span>MAJ {t}</span>}
      </div>
    </div>
  );
}
