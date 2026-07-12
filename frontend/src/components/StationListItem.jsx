import Icon from "./Icon";
import { fmtDistance } from "../hooks";
import { stationStatus, bikeCounts, LOW_BIKES } from "../lib/station";

export default function StationListItem({ s, onClick, dist }) {
  const offline = s.is_renting === false;
  const st = stationStatus(s);
  const { elec, meca } = bikeCounts(s);
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
            <span className={"ci elec" + (elec <= LOW_BIKES ? " low" : "")}><Icon name="bolt" /> <b>{elec}</b> élec</span>
            <span className={"ci meca" + (meca <= LOW_BIKES ? " low" : "")}><Icon name="bike" /> <b>{meca}</b> méca</span>
            <span className="ci places"><Icon name="parking" /> <b>{places}</b> places</span>
          </div>
        )}

      </div>

      {Pill}
      <span className="card-status">{Pill}</span>
    </div>
  );
}
