import BottomSheet from "./BottomSheet";
import Icon from "./Icon";
import { fmtTime } from "../theme";

function statusOf(s) {
  if (s.is_renting === false) return { cls: "closed", label: "Hors service" };
  const total = (s.electrical ?? 0) + (s.mechanical ?? 0);
  if (total <= 2) return { cls: "warn", label: "Faible disponibilité" };
  return { cls: "open", label: "Ouverte" };
}

function Row({ icon, kind, label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-row-label"><Icon name={icon} size={18} className={kind} /> {label}</span>
      <span className="detail-row-value">{value}</span>
    </div>
  );
}

export default function StationDetailSheet({ station, open, onClose, isFav, onToggleFav }) {
  const s = station;
  if (!s) return <BottomSheet open={open} onClose={onClose} heightVh={70} />;

  const offline = s.is_renting === false;
  const t = fmtTime(s.last_reported);
  const st = statusOf(s);

  return (
    <BottomSheet open={open} onClose={onClose} heightVh={70} labelledBy="sheet-station-title">
      <div id="sheet-station-title" className="detail-title">{s.name}</div>
      {s.address?.trim() && <div className="detail-addr">{s.address.trim()}</div>}

      <span className={"detail-badge " + st.cls}><span className="dot" />{st.label}</span>

      <Row icon="bolt" kind="elec" label="Vélos électriques" value={offline ? "—" : (s.electrical ?? 0)} />
      <Row icon="bike" kind="meca" label="Vélos mécaniques" value={offline ? "—" : (s.mechanical ?? 0)} />
      <Row icon="parking" kind="places" label="Places libres" value={offline ? "—" : (s.docks_available ?? 0)} />

      <div className="detail-meta">
        <span>Capacité {s.capacity ?? 0}</span>
        {t && <span>Mise à jour {t}</span>}
      </div>

      <button className={"detail-cta" + (isFav ? " on" : "")} onClick={() => onToggleFav(s)}>
        <Icon name="star" size={18} style={isFav ? { fill: "currentColor" } : null} />
        {isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
      </button>
    </BottomSheet>
  );
}
