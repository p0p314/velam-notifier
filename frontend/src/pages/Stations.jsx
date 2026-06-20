import { useState } from "react";
import StationCard from "../components/StationCard";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import { useStations, useFavorites } from "../hooks";
import { C } from "../theme";

// Filtres desktop (style d'origine restauré)
const FBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    background: active ? "#152040" : C.card, border: `1px solid ${active ? "#2B4A80" : C.border}`,
    borderRadius: 8, padding: "8px 13px", color: active ? "#90B8F8" : C.muted,
    fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
  }}>{children}</button>
);
const SBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    background: active ? "#0E2030" : C.card, border: `1px solid ${active ? "#1A4A6A" : C.border}`,
    borderRadius: 8, padding: "8px 13px", color: active ? "#7AD3F8" : C.muted,
    fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
  }}>{children}</button>
);

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

  // Mobile : recherche seule, tri alphabétique (comportement inchangé)
  const visibleMobile = stations.filter(matchesSearch).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  // Desktop : recherche + filtre + tri (filtres d'origine)
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
      <div style={{ background: "#110808", border: "1px solid #3B1515", borderRadius: 12, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 26, marginBottom: 10 }}>⚠️</div>
        <div style={{ color: "#FCA5A5", fontSize: 14, marginBottom: 12 }}>Impossible de joindre le serveur</div>
        <button onClick={reload} style={{ minHeight: 44, padding: "0 20px", background: "#3B1515", border: "1px solid #7F1D1D", borderRadius: 10, color: "#FCA5A5", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Réessayer
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ─────────────── MOBILE ─────────────── */}
      <div className="mobile-only">
        <div className="view-search">
          <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une station…" />
        </div>

        {loading ? (
          <div className="view-state"><div style={{ fontSize: 36, marginBottom: 12 }}>🚲</div>Connexion au serveur…</div>
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
          <div className="stations-stats">
            <span><b style={{ color: C.green }}>{activeCount}/{stations.length}</b> stations actives</span>
            <span><b style={{ color: C.elec }}>{totElec}</b> ⚡ électriques</span>
            <span><b style={{ color: C.meca }}>{totMeca}</b> 🚲 mécaniques</span>
            <button onClick={reload} title="Rafraîchir" style={{ marginLeft: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 11px", color: C.muted, fontSize: 14, cursor: "pointer" }}>↺</button>
          </div>
          <div className="stations-filters">
            <input className="search-input" style={{ maxWidth: 360 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une station…" />
            <div style={{ display: "flex", gap: 6 }}>
              <FBtn active={filter === "all"}  onClick={() => setFilter("all")}>Toutes</FBtn>
              <FBtn active={filter === "elec"} onClick={() => setFilter("elec")}>⚡ Élec.</FBtn>
              <FBtn active={filter === "meca"} onClick={() => setFilter("meca")}>🚲 Méca.</FBtn>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <SBtn active={sort === "name"}  onClick={() => setSort("name")}>A–Z</SBtn>
              <SBtn active={sort === "elec"}  onClick={() => setSort("elec")}>⚡↓</SBtn>
              <SBtn active={sort === "meca"}  onClick={() => setSort("meca")}>🚲↓</SBtn>
              <SBtn active={sort === "total"} onClick={() => setSort("total")}>Total↓</SBtn>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="view-state"><div style={{ fontSize: 36, marginBottom: 12 }}>🚲</div>Connexion au serveur…</div>
        ) : error ? ErrorBox
        : (
          <>
            <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 12px" }}>
              {visibleDesktop.length} station{visibleDesktop.length !== 1 ? "s" : ""}
              {(search || filter !== "all") && ` · filtrée${visibleDesktop.length !== 1 ? "s" : ""}`}
            </div>
            <div className="stations-grid">
              {visibleDesktop.map((s) => (
                <StationCard key={s.station_id} s={s} onClick={() => setSelId(s.station_id)} isFav={favIds.has(s.station_id)} onToggleFav={toggleFav} />
              ))}
            </div>
            {visibleDesktop.length === 0 && (
              <div className="view-state">Aucune station ne correspond aux filtres.</div>
            )}
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
