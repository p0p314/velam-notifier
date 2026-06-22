import { useState } from "react";
import StationCard from "../components/StationCard";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import Icon from "../components/Icon";
import { useStations, useFavorites } from "../hooks";

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

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort,   setSort]   = useState("name");
  const [selId,  setSelId]  = useState(null);

  const matchesSearch = (s) => {
    const q = search.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.address ?? "").toLowerCase().includes(q);
  };

  const visibleMobile = stations.filter(matchesSearch).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const visibleDesktop = stations
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
      return a.name.localeCompare(b.name, "fr");
    });

  const selected = stations.find((s) => s.station_id === selId) ?? null;

  const totElec = stations.reduce((a, s) => a + (s.electrical ?? 0), 0);
  const totMeca = stations.reduce((a, s) => a + (s.mechanical ?? 0), 0);
  const activeCount = stations.filter((s) => s.is_renting !== false).length;

  const ErrorBox = (
    <div className="view-pad">
      <div className="error-box">
        <div className="error-title">Impossible de joindre le serveur</div>
        <button className="error-retry" onClick={reload}>Réessayer</button>
      </div>
    </div>
  );

  return (
    <>
      {/* ─────────────── MOBILE ─────────────── */}
      <div className="mobile-only">
        <div className="view-search"><SearchBox value={search} onChange={setSearch} /></div>
        {loading ? (
          <div className="view-state">Connexion au serveur…</div>
        ) : error ? ErrorBox
        : visibleMobile.length === 0 ? (
          <div className="view-state">Aucune station pour « {search} »</div>
        ) : (
          <div className="station-list">
            {visibleMobile.map((s) => (
              <StationListItem key={s.station_id} s={s} onClick={() => setSelId(s.station_id)} />
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
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Toutes</button>
              <button className={filter === "elec" ? "active" : ""} onClick={() => setFilter("elec")}>Élec.</button>
              <button className={filter === "meca" ? "active" : ""} onClick={() => setFilter("meca")}>Méca.</button>
            </div>
            <div className="select-wrap" style={{ marginLeft: "auto" }}>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
                <option value="name">Nom (A–Z)</option>
                <option value="elec">Électriques</option>
                <option value="meca">Mécaniques</option>
                <option value="total">Total vélos</option>
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
              {visibleDesktop.length} station{visibleDesktop.length !== 1 ? "s" : ""}
            </div>
            <div className="stations-grid">
              {visibleDesktop.map((s) => (
                <StationCard key={s.station_id} s={s} onClick={() => setSelId(s.station_id)} isFav={favIds.has(s.station_id)} onToggleFav={toggleFav} />
              ))}
            </div>
            {visibleDesktop.length === 0 && <div className="view-state">Aucune station ne correspond aux filtres.</div>}
          </>
        )}
      </div>

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
