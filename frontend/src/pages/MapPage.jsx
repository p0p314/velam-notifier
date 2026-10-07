import { useMemo, useState } from "react";
import StationMap from "../components/map/StationMap";
import MapFilters from "../components/map/MapFilters";
import Icon from "../components/Icon";
import { OfflineBanner } from "../components/Offline";
import { useStations, fmtDistance, requestPosition } from "../hooks";
import { useTheme } from "../useTheme";
import { useBikeCity } from "../authContext";
import { bikeCountForType, nearestWithBikes } from "../lib/mapConfig";
import { getBikePref, stationFilterFor } from "../lib/prefs";

export default function MapPage() {
  const city = useBikeCity();
  const { stations, loading, error, stale, staleReason, lastUpd, reload } = useStations();
  const [type, setType] = useState(() => stationFilterFor(getBikePref()));
  const [minBikes, setMinBikes] = useState(0);
  const { theme } = useTheme();
  // « Autour de moi » : position mesurée au clic ; les 3 stations sont recalculées
  // en continu depuis les filtres (type, minimum) et les disponibilités à jour.
  const [around, setAround] = useState(null); // { coords, seq }
  const [geo, setGeo] = useState({ busy: false, error: null });

  // Filtrage (type + seuil) — recalculé seulement si nécessaire.
  const filtered = useMemo(
    () => stations.filter((s) => bikeCountForType(s, type) >= minBikes),
    [stations, type, minBikes]
  );

  const near = useMemo(
    () => (around ? nearestWithBikes(filtered, around.coords, type, 3) : []),
    [filtered, around, type]
  );
  // Objet transmis à la carte : ne change (et ne recadre) que si la sélection change
  // — un filtre modifié, pas un simple rafraîchissement aux mêmes stations.
  const nearKey = near.map((s) => s.station_id).join("|");
  const focus = useMemo(
    () => (around ? { coords: around.coords, stations: near, seq: around.seq } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [around, nearKey]
  );

  const aroundMe = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ busy: false, error: "La géolocalisation n'est pas disponible sur cet appareil." });
      return;
    }
    setGeo({ busy: true, error: null });
    requestPosition().then(
      (coords) => {
        setAround((a) => ({ coords, seq: (a?.seq ?? 0) + 1 }));
        setGeo({ busy: false, error: null });
      },
      () => setGeo({ busy: false, error: "Position indisponible : autorisez la géolocalisation." })
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
          <OfflineBanner stale={stale} staleReason={staleReason} lastUpd={lastUpd} />
          {/* Conteneur de référence des surcouches (filtres, chargement, « Autour de moi ») :
              le bandeau de fraîcheur au-dessus ne doit pas passer sous les filtres. */}
          <div className="map-stage">
          <MapFilters type={type} setType={setType} minBikes={minBikes} setMinBikes={setMinBikes} count={filtered.length} />
          {/* Une carte par ville (clé) : changer de ville la recentre, sans marqueurs d'avant. */}
          <StationMap key={city.id} stations={filtered} filterType={type} focus={focus} theme={theme} center={city.center} />
          {loading && <div className="map-loading">Chargement des stations…</div>}

          <div className="map-around">
            {(focus || geo.error) && (
              <div className="map-around-panel" role="status">
                {geo.error ? geo.error
                  : near.length === 0 ? "Aucune station ne correspond à vos filtres autour de vous."
                  : (
                    <ol>
                      {near.map((s) => (
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
          </div>
        </>
      )}
    </div>
  );
}
