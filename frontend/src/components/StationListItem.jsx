import Icon from "./Icon";
import { fmtDistance } from "../hooks";

// Statut : Hors service (fermé), Faible (peu de vélos), Ouverte.
function statusOf(s) {
  if (s.is_renting === false) return { cls: "closed", label: "Hors service" };
  const total = (s.electrical ?? 0) + (s.mechanical ?? 0);
  if (total <= 2) return { cls: "warn", label: "Faible" };
  return { cls: "open", label: "Ouverte" };
}

export default function StationListItem({ s, onClick, dist }) {
  const offline = s.is_renting === false;
  const st = statusOf(s);
  const meca   = s.mechanical ?? 0;
  const elec   = s.electrical ?? 0;
  const places = s.docks_available ?? 0;
  const distLabel = fmtDistance(dist);

  const onKey = (e) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); }
  };

  const Pill = (
    <span className={"status-pill " + st.cls}><span className="dot" />{st.label}</span>
  );

  return (
    <div className={"station-item" + (offline ? " offline" : "")} role="button" tabIndex={0} onClick={onClick} onKeyDown={onKey}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="station-item-name">{s.name}</div>
        {s.address?.trim() && <div className="station-item-addr">{s.address.trim()}</div>}
        {distLabel && <div className="station-item-dist"><Icon name="map-pin" size={13} /> {distLabel}</div>}

        {/* Compteurs mobile */}
        {!offline && (
          <div className="station-item-counts">
            <span className={"ci elec" + (elec <= 2 ? " low" : "")}><Icon name="bolt" /> <b>{elec}</b> élec</span>
            <span className={"ci meca" + (meca <= 2 ? " low" : "")}><Icon name="bike" /> <b>{meca}</b> méca</span>
            <span className="ci places"><Icon name="parking" /> <b>{places}</b> places</span>
          </div>
        )}

        {/* Compteurs desktop (cards compactes, ex. Favoris) */}
        {/* <div className="card-counts">
          <span className={"count-item elec" + (elec <= 2 ? " low" : "")}><Icon name="bolt" size={16} /><span className="count-value">{offline ? "—" : elec}</span><span className="count-label">élec</span></span>
          <span className={"count-item meca" + (meca <= 2 ? " low" : "")}><Icon name="bike" size={16} /><span className="count-value">{offline ? "—" : meca}</span><span className="count-label">méca</span></span>
          <span className="count-item places"><Icon name="parking" size={16} /><span className="count-value">{offline ? "—" : places}</span><span className="count-label">places</span></span>
        </div> */}
      </div>

      {Pill}
      <span className="card-status">{Pill}</span>
    </div>
  );
}
