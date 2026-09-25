import { useMemo, useState } from "react";
import StationMap from "../components/map/StationMap";
import MapFilters from "../components/map/MapFilters";
import Icon from "../components/Icon";
import { useStations, fmtDistance } from "../hooks";
import { bikeCountForType, nearestWithBikes } from "../lib/mapConfig";

export default function MapPage() {
  const { stations, loading, error, reload } = useStations();
  const [type, setType] = useState("all");
  const [minBikes, setMinBikes] = useState(0);
  // « Autour de moi » : { coords, stations } transmis à la carte + liste affichée.
  const [focus, setFocus] = useState(null);
  const [geo, setGeo] = useState({ busy: false, error: null });

  // Filtrage (type + seuil) — recalculé seulement si nécessaire.
  const filtered = useMemo(
    () => stations.filter((s) => bikeCountForType(s, type) >= minBikes),
    [stations, type, minBikes]
  );

  const aroundMe = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ busy: false, error: "La géolocalisation n'est pas disponible sur cet appareil." });
      return;
    }
    setGeo({ busy: true, error: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setFocus({ coords, stations: nearestWithBikes(filtered, coords, type, 3) });
        setGeo({ busy: false, error: null });
      },
      () => setGeo({ busy: false, error: "Position indisponible : autorisez la géolocalisation." }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  };

  const unit = type === "elec" ? "élec." : type === "meca" ? "méca." : "vélo";

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
          <StationMap stations={filtered} filterType={type} focus={focus} />
          {loading && <div className="map-loading">Chargement des stations…</div>}

          <div className="map-around">
            {(focus || geo.error) && (
              <div className="map-around-panel" role="status">
                {geo.error ? geo.error
                  : focus.stations.length === 0 ? "Aucune station avec des vélos autour de vous."
                  : (
                    <ol>
                      {focus.stations.map((s) => (
                        <li key={s.station_id}>
                          <span className="map-around-name">{s.name}</span>
                          <span className="map-around-meta">{fmtDistance(s.km)} · {s.count} {unit}{unit === "vélo" && s.count > 1 ? "s" : ""}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </div>
            )}
            <button type="button" className="map-around-btn" onClick={aroundMe} disabled={geo.busy}>
              <Icon name="map-pin" size={18} /> {geo.busy ? "Localisation…" : "Autour de moi"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
