import { useMemo, useState } from "react";
import StationMap from "../components/map/StationMap";
import MapFilters from "../components/map/MapFilters";
import { useStations } from "../hooks";
import { bikeCountForType } from "../lib/mapConfig";

export default function MapPage() {
  const { stations, loading, error, reload } = useStations();
  const [type, setType] = useState("all");
  const [minBikes, setMinBikes] = useState(0);

  // Filtrage (type + seuil) — recalculé seulement si nécessaire.
  const filtered = useMemo(
    () => stations.filter((s) => bikeCountForType(s, type) >= minBikes),
    [stations, type, minBikes]
  );

  return (
    <div className="map-page">
      {error ? (
        <div className="error-box">
          <div className="error-title">Impossible de joindre le serveur</div>
          <button className="error-retry" onClick={reload}>Réessayer</button>
        </div>
      ) : (
        <>
          <MapFilters type={type} setType={setType} minBikes={minBikes} setMinBikes={setMinBikes} count={filtered.length} />
          <StationMap stations={filtered} filterType={type} />
          {loading && <div className="map-loading">Chargement des stations…</div>}
        </>
      )}
    </div>
  );
}
