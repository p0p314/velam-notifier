import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import TrainMap from "../components/map/TrainMap";
import Icon from "../components/Icon";
import LineBadge from "../components/trains/LineBadge";
import TrainStatus from "../components/trains/TrainStatus";
import Freshness from "../components/trains/Freshness";
import { useTrainJourney, useTrainRoute, useNow } from "../trainHooks";
import { useStations } from "../hooks";
import { useTheme } from "../useTheme";
import { DEFAULT_CENTER, MAPBOX_TOKEN } from "../lib/mapConfig";
import { fmtDayLong } from "../lib/trains";
import {
  progressInfo, positionInfo, positionNote, routeNote, mapRefreshMs, routeNear,
} from "../lib/trainMap";

/** Charge les stations Vélam seulement quand la couche est affichée. */
function BikeStationsLoader({ onData }) {
  const { stations } = useStations();
  useEffect(() => { onData(stations); }, [stations, onData]);
  useEffect(() => () => onData(null), [onData]);
  return null;
}

/** Où en est le train : prochaine gare, base du calcul, fraîcheur de la position. */
function ProgressPanel({ data, now }) {
  const j = data.journey;
  const p = progressInfo(j, data.position?.progress ?? null);
  const pos = positionInfo(data.position, now);
  const note = positionNote(data.position, j, data.provider);
  return (
    <div className="tm-progress">
      {p && (
        <>
          <div className="tm-progress-title">{p.title}</div>
          {p.sub && <div className="tm-progress-sub">{p.sub}</div>}
          <div className={"tm-basis " + p.basis}>{p.basisLabel}</div>
        </>
      )}
      {pos && <div className={"tm-position " + pos.tone}><Icon name="map-pin" size={14} /> {pos.text}</div>}
      {note && <div className="form-hint">{note}</div>}
      {p?.upcoming.length > 0 && (
        <ol className="tm-next">
          {p.upcoming.map((s) => (
            <li key={s.index} className={s.inJourney ? "in" : ""}>
              <span className="tm-next-name">{s.name}</span>
              <span className="tm-next-time mono">{s.time}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Carte d'un train (/trains/carte?id=) : tracé, gares, position si publiée, prochaines
 * gares. Actualisation : 30 s si des positions sont publiées pour un train en route,
 * 2 min sinon (temps réel SNCF) ; le tracé, statique, est mis en cache.
 */
export default function TrainMapPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("id");
  const { data, error, loading, refresh, refreshing, load } = useTrainJourney(id, { refreshMs: mapRefreshMs });
  const routeRes = useTrainRoute(id);
  const { theme } = useTheme();
  const now = useNow(10_000);
  const mapRef = useRef(null);
  const [showBikes, setShowBikes] = useState(false);
  const [bikes, setBikes] = useState(null);

  const back = (
    <button type="button" className="link-btn back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(id ? `/trains/trajet?id=${encodeURIComponent(id)}` : "/trains"))}>
      <Icon name="arrow-left" size={16} /> Retour
    </button>
  );

  if (!id) return <div className="view-pad">{back}<div className="view-state">Aucun trajet sélectionné.</div></div>;
  const err = (error && !data) ? error : (routeRes.error && !routeRes.data ? routeRes.error : null);
  if (err) {
    return (
      <div className="view-pad">
        {back}
        <div className="error-box">
          <div className="error-title">{err}</div>
          <button className="error-retry" onClick={() => { load(); routeRes.load(); }}>Réessayer</button>
        </div>
      </div>
    );
  }

  const j = data?.journey ?? null;
  const route = routeRes.data?.route ?? null;
  const vehicle = data?.position?.vehicle ?? null;
  const rNote = routeNote(route, data?.provider ?? routeRes.data?.provider);
  const nearAmiens = routeNear(route, DEFAULT_CENTER);

  return (
    <div className="train-map-page">
      <div className="tm-map">
        <TrainMap ref={mapRef} route={route} journey={j} position={data?.position ?? null} bikeStations={showBikes ? bikes : null} theme={theme} />
        {(loading || routeRes.loading) && <div className="map-loading">Chargement du trajet…</div>}
        {route && MAPBOX_TOKEN && (
          <div className="tm-map-actions">
            {vehicle && (
              <button type="button" className="tm-map-btn" onClick={() => mapRef.current?.focusTrain()}>
                <Icon name="train" size={16} /> Train
              </button>
            )}
            <button type="button" className="tm-map-btn" onClick={() => mapRef.current?.fitRoute()}>
              <Icon name="route" size={16} /> Trajet
            </button>
          </div>
        )}
      </div>

      <aside className="tm-panel">
        {back}
        {j && (
          <>
            <div className="journey-head">
              <LineBadge line={j.line} journey={j} />
              <span className="train-num">{[j.brand, j.trainNumber && `n° ${j.trainNumber}`].filter(Boolean).join(" · ")}</span>
              <TrainStatus journey={j} />
            </div>
            <h1 className="page-title tm-title">{j.departureStation.name} → {j.arrivalStation.name}</h1>
            <div className="page-count">{fmtDayLong(j.serviceDate)}</div>
            <Freshness realtime={data.realtime} onRefresh={data.realtime?.applicable ? refresh : null} refreshing={refreshing} />
            {j.status === "cancelled" && j.cancellation?.reason && <div className="train-note danger">{j.cancellation.reason}</div>}
            <ProgressPanel data={data} now={now} />
          </>
        )}
        {rNote && <div className="form-hint">{rNote}</div>}
        {nearAmiens && (
          <label className="tm-toggle">
            <input type="checkbox" checked={showBikes} onChange={(e) => setShowBikes(e.target.checked)} />
            <span>Stations Vélam</span>
          </label>
        )}
        {showBikes && <BikeStationsLoader onData={setBikes} />}
        {j && <Link className="form-hint" to={`/trains/trajet?id=${encodeURIComponent(j.id)}`}>Détail du trajet</Link>}
      </aside>
    </div>
  );
}
