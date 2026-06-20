// Card station compacte pour les listes (Stations + Favoris).

export default function StationListItem({ s, onClick }) {
  const offline = s.is_renting === false;
  const onKey = (e) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); }
  };

  const meca  = s.mechanical ?? 0;
  const elec  = s.electrical ?? 0;
  const places = s.docks_available ?? 0;

  return (
    <div className="station-item" role="button" tabIndex={0} onClick={onClick} onKeyDown={onKey}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="station-item-name">{s.name}</div>
        {s.address?.trim() && <div className="station-item-addr">{s.address.trim()}</div>}

        {/* Compteurs mobile (existant) */}
        <div className="station-item-counts">
          <span>🚲 Méca <b>{meca}</b></span>
          <span>⚡ Élec <b>{elec}</b></span>
          <span>🅿️ Places <b>{places}</b></span>
        </div>

        {/* Compteurs desktop (structurés) */}
        <div className="card-counts">
          <span className="count-item">
            <span className="count-icon">🔧</span>
            <span className="count-value">{meca}</span>
            <span className="count-label">méca</span>
          </span>
          <span className="count-divider">·</span>
          <span className="count-item">
            <span className="count-icon">⚡</span>
            <span className="count-value">{elec}</span>
            <span className="count-label">élec</span>
          </span>
          <span className="count-divider">·</span>
          <span className="count-item">
            <span className="count-icon">🅿️</span>
            <span className="count-value">{places}</span>
            <span className="count-label">places</span>
          </span>
        </div>
      </div>

      {/* Statut mobile : pastille seule */}
      <span
        className={"status-dot " + (offline ? "closed" : "open")}
        role="img"
        aria-label={offline ? "Fermée" : "Ouverte"}
      />

      {/* Statut desktop : pastille + label en haut à droite */}
      <span className={"card-status " + (offline ? "closed" : "open")}>
        <span className="cs-dot" />
        <span className="card-status-label">{offline ? "Fermée" : "Ouverte"}</span>
      </span>
    </div>
  );
}
