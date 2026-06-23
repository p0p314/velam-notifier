import Icon from "../Icon";

const TYPES = [
  { value: "all",  label: "Tous" },
  { value: "elec", label: "Élec." },
  { value: "meca", label: "Méca." },
];

/**
 * Filtres superposés à la carte : type de vélo + nombre minimum de vélos.
 * Contrôlé (state dans la page) → le filtrage se reflète immédiatement.
 */
export default function MapFilters({ type, setType, minBikes, setMinBikes, count }) {
  return (
    <div className="map-filters">
      <div className="seg">
        {TYPES.map((t) => (
          <button key={t.value} type="button" className={type === t.value ? "active" : ""} onClick={() => setType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      <label className="map-filter-min">
        <span className="form-label">Vélos dispo. ≥ <b className="mono">{minBikes}</b></span>
        <input type="range" min="0" max="10" step="1" value={minBikes}
          onChange={(e) => setMinBikes(Number(e.target.value))} />
      </label>

      <div className="map-filter-count">
        <Icon name="map-pin" size={13} /> {count} station{count !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
