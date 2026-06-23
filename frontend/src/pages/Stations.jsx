import { useState } from "react";
import StationCard from "../components/StationCard";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import BottomSheet from "../components/BottomSheet";
import Icon from "../components/Icon";
import { useStations, useFavorites, useGeolocation, distanceKm } from "../hooks";

const FILTERS = [
  { value: "all",  label: "Toutes" },
  { value: "elec", label: "Élec." },
  { value: "meca", label: "Méca." },
];

const SORTS = [
  { value: "distance", label: "Distance" },
  { value: "name",     label: "Nom (A–Z)" },
  { value: "elec",     label: "Électriques" },
  { value: "meca",     label: "Mécaniques" },
  { value: "total",    label: "Total vélos" },
];

function SearchBox({ value, onChange }) {
  return (
    <div className="search-box">
      <Icon name="search" />
      <input className="search-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Rechercher une station…" />
    </div>
  );
}

export default function Stations() {
  const { stations, loading, error, reload } = useStations();
  const { favIds, toggleFav } = useFavorites();
  const { coords } = useGeolocation();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort,   setSort]   = useState("distance"); // proximité par défaut
  const [selId,  setSelId]  = useState(null);
  const [controlsOpen, setControlsOpen] = useState(false); // tri/filtre mobile

  const matchesSearch = (s) => {
    const q = search.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.address ?? "").toLowerCase().includes(q);
  };

  // Liste filtrée + triée — partagée par le mobile (liste) et le desktop (grille).
  const visible = stations
    .filter((s) => {
      if (!matchesSearch(s)) return false;
      if (filter === "elec") return (s.electrical ?? 0) > 0;
      if (filter === "meca") return (s.mechanical ?? 0) > 0;
      return true;
    })
    .sort((a, b) => {
      if (sort === "elec")  return (b.electrical ?? 0) - (a.electrical ?? 0);
      if (sort === "meca")  return (b.mechanical ?? 0) - (a.mechanical ?? 0);
      if (sort === "total") return (b.total_bikes ?? 0) - (a.total_bikes ?? 0);
      if (sort === "distance" && coords) {
        return distanceKm(coords, a) - distanceKm(coords, b); // proximité croissante
      }
      // Fallback (tri distance sans position autorisée, ou tri "name") → alphabétique
      return a.name.localeCompare(b.name, "fr");
    });

  const selected = stations.find((s) => s.station_id === selId) ?? null;

  const totElec = stations.reduce((a, s) => a + (s.electrical ?? 0), 0);
  const totMeca = stations.reduce((a, s) => a + (s.mechanical ?? 0), 0);
  const activeCount = stations.filter((s) => s.is_renting !== false).length;

  const filtersActive = filter !== "all" || sort !== "distance";

  const ErrorBox = (
    <div className="view-pad">
      <div className="error-box">
        <div className="error-title">Impossible de joindre le serveur</div>
        <button className="error-retry" onClick={reload}>Réessayer</button>
      </div>
    </div>
  );

  // Contrôles tri/filtre partagés (rendus dans le bottom sheet mobile).
  const Controls = (
    <div className="controls-sheet">
      <div className="form-title" style={{ marginBottom: 4 }}>Trier et filtrer</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="form-label">Type de vélo</span>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className={filter === f.value ? "active" : ""} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="form-label">Trier par</span>
        <div className="sort-options">
          {SORTS.map((o) => (
            <button key={o.value} type="button" className={"sort-option" + (sort === o.value ? " active" : "")} onClick={() => setSort(o.value)}>
              <span>{o.label}</span>
              {sort === o.value && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </div>

      <button className="submit-btn" onClick={() => setControlsOpen(false)}>Voir {visible.length} station{visible.length !== 1 ? "s" : ""}</button>
    </div>
  );

  return (
    <>
      {/* ─────────────── MOBILE ─────────────── */}
      <div className="mobile-only">
        <div className="view-search mobile-toolbar">
          <SearchBox value={search} onChange={setSearch} />
          <button
            className={"filter-btn" + (filtersActive ? " active" : "")}
            aria-label="Trier et filtrer"
            onClick={() => setControlsOpen(true)}
          >
            <Icon name="sliders" size={18} />
          </button>
        </div>
        {loading ? (
          <div className="view-state">Connexion au serveur…</div>
        ) : error ? ErrorBox
        : visible.length === 0 ? (
          <div className="view-state">Aucune station ne correspond aux filtres.</div>
        ) : (
          <div className="station-list">
            {visible.map((s) => (
              <StationListItem key={s.station_id} s={s} dist={coords ? distanceKm(coords, s) : null} onClick={() => setSelId(s.station_id)} />
            ))}
          </div>
        )}
      </div>

      {/* ─────────────── DESKTOP ─────────────── */}
      <div className="desktop-only">
        <div className="stations-toolbar">
          <div className="toolbar-top">
            <h1 className="page-title">Stations</h1>
            <div className="stations-stats">
              <span><b>{activeCount}/{stations.length}</b> actives</span>
              <span><b>{totElec}</b> élec.</span>
              <span><b>{totMeca}</b> méca.</span>
            </div>
          </div>
          <div className="stations-filters">
            <SearchBox value={search} onChange={setSearch} />
            <div className="seg" style={{ maxWidth: 280 }}>
              {FILTERS.map((f) => (
                <button key={f.value} className={filter === f.value ? "active" : ""} onClick={() => setFilter(f.value)}>{f.label}</button>
              ))}
            </div>
            <div className="select-wrap" style={{ marginLeft: "auto" }}>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
                {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Icon name="chevron-down" size={15} />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="view-state">Connexion au serveur…</div>
        ) : error ? ErrorBox
        : (
          <>
            <div style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 12px", fontFamily: "var(--font-mono)" }}>
              {visible.length} station{visible.length !== 1 ? "s" : ""}
            </div>
            <div className="stations-grid">
              {visible.map((s) => (
                <StationCard key={s.station_id} s={s} dist={coords ? distanceKm(coords, s) : null} onClick={() => setSelId(s.station_id)} isFav={favIds.has(s.station_id)} onToggleFav={toggleFav} />
              ))}
            </div>
            {visible.length === 0 && <div className="view-state">Aucune station ne correspond aux filtres.</div>}
          </>
        )}
      </div>

      <BottomSheet open={controlsOpen} onClose={() => setControlsOpen(false)} heightVh={62}>
        {Controls}
      </BottomSheet>

      <StationDetailSheet
        station={selected}
        open={selId !== null && selected !== null}
        onClose={() => setSelId(null)}
        isFav={selected ? favIds.has(selected.station_id) : false}
        onToggleFav={toggleFav}
      />
    </>
  );
}
