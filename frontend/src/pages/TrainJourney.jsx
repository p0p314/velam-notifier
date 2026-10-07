import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import PullToRefresh from "../components/PullToRefresh";
import BottomSheet from "../components/BottomSheet";
import LineBadge from "../components/trains/LineBadge";
import TrainStatus from "../components/trains/TrainStatus";
import Freshness from "../components/trains/Freshness";
import TrainAlertForm from "../components/trains/TrainAlertForm";
import { useTrainJourney, useMyTrains } from "../trainHooks";
import { fmtClock, fmtDayLong, timeInfo, describeTrainAlert, statusInfo, delayLabel } from "../lib/trains";

/** Bloc « Départ » / « Arrivée » : prévu, estimé (seulement s'il diffère) et retard. */
function TimeBlock({ title, station, scheduled, estimated, delay, cancelled }) {
  const t = timeInfo(scheduled, estimated, delay);
  return (
    <div className="journey-time">
      <div className="journey-time-title">{title}</div>
      <div className="journey-time-station">{station.name}</div>
      {t.estimated ? (
        <dl className="journey-time-rows">
          <div><dt>Prévu</dt><dd className="mono old">{t.scheduled}</dd></div>
          <div><dt>Estimé</dt><dd className="mono">{t.estimated}</dd></div>
          {t.delay && <div><dt>Retard</dt><dd className="mono t-delay">{t.delay}</dd></div>}
        </dl>
      ) : (
        <div className={"journey-time-main mono" + (cancelled ? " old" : "")}>{t.scheduled}</div>
      )}
    </div>
  );
}

/** Trajet favori correspondant (mêmes gares + même numéro de train, sinon même heure). */
function findFavorite(favorites, j) {
  return favorites.find((f) => f.origin_id === j.departureStation.id && f.destination_id === j.arrivalStation.id
    && (f.train_number && j.trainNumber ? f.train_number === j.trainNumber : f.departure_time === fmtClock(j.scheduledDeparture))) ?? null;
}

/** Détail d'un train : horaires, retard, statut, événements, arrêts, favori et alerte. */
export default function TrainJourney() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("id");
  const { data, loading, error, refresh, refreshing, load } = useTrainJourney(id);
  const my = useMyTrains();
  const [alertOpen, setAlertOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const back = (
    <button type="button" className="link-btn back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/trains"))}>
      <Icon name="arrow-left" size={16} /> Trains
    </button>
  );

  if (!id) return <div className="view-pad">{back}<div className="view-state">Aucun trajet sélectionné.</div></div>;
  if (loading) return <div className="view-pad">{back}<div className="view-state">Chargement du trajet…</div></div>;
  if (error && !data) {
    return (
      <div className="view-pad">
        {back}
        <div className="error-box">
          <div className="error-title">{error}</div>
          <button className="error-retry" onClick={() => load()}>Réessayer</button>
        </div>
      </div>
    );
  }

  const j = data.journey;
  const cancelled = j.status === "cancelled";
  const fav = findFavorite(my.favorites, j);
  const alert = fav?.alert ?? null;

  const act = async (fn) => {
    setBusy(true);
    setActionError(null);
    try { await fn(); } catch (e) { setActionError(e.message); } finally { setBusy(false); }
  };
  const toggleFav = () => act(() => (fav ? my.removeFavorite(fav.id) : my.addFavorite(j.id)));
  const saveAlert = async (payload) => {
    if (alert) await my.updateAlert(alert.id, payload);
    else await my.createAlert(fav ? { scope: "trip", favorite_id: fav.id, ...payload } : { scope: "trip", journey_id: j.id, ...payload });
    setAlertOpen(false);
  };
  const s = statusInfo(j);

  return (
    <PullToRefresh onRefresh={refresh}>
    <div className="view-pad journey-page">
      {back}
      <div className="journey-head">
        <LineBadge line={j.line} journey={j} />
        <span className="train-num">{[j.brand, j.trainNumber && `n° ${j.trainNumber}`].filter(Boolean).join(" · ")}</span>
      </div>
      <h1 className="page-title journey-title">{j.departureStation.name} → {j.arrivalStation.name}</h1>
      <div className="page-count">
        {fmtDayLong(j.serviceDate)}{j.terminus !== j.arrivalStation.name ? ` · terminus ${j.terminus}` : ""}{j.line?.longName ? ` · ${j.line.longName}` : ""}
      </div>

      <Freshness realtime={data.realtime} onRefresh={data.realtime?.applicable ? refresh : null} refreshing={refreshing} />

      <div className="journey-card">
        <div className="journey-times">
          <TimeBlock title="Départ" station={j.departureStation} scheduled={j.scheduledDeparture} estimated={j.estimatedDeparture} delay={j.departureDelay} cancelled={cancelled} />
          <TimeBlock title="Arrivée" station={j.arrivalStation} scheduled={j.scheduledArrival} estimated={j.estimatedArrival} delay={j.arrivalDelay} cancelled={cancelled} />
        </div>
        <div className="journey-status">
          <span className="form-label">Statut</span>
          <TrainStatus journey={j} />
        </div>
        {cancelled && j.cancellation?.reason && <div className="train-note danger">{j.cancellation.reason}</div>}
        {s.tone === "neutral" && data.realtime?.applicable && data.realtime?.available && (
          <div className="form-hint">Aucune information temps réel pour ce train pour l'instant : horaire théorique.</div>
        )}
      </div>

      <div className="journey-actions">
        <button type="button" className={"detail-cta" + (fav ? " on" : "")} onClick={toggleFav} disabled={busy}>
          <Icon name="star" size={16} /> {fav ? "Retirer des favoris" : "Ajouter aux favoris"}
        </button>
        <button type="button" className="detail-cta secondary" onClick={() => setAlertOpen(true)}>
          <Icon name="bell-plus" size={16} /> {alert ? "Modifier l'alerte" : "Créer une alerte"}
        </button>
        {alert && <div className="form-hint">Alerte : {describeTrainAlert(alert)}{alert.active ? "" : " (désactivée)"}</div>}
        {fav && <Link className="form-hint" to="/trains?onglet=mes-trains">Voir dans Mes trains</Link>}
        {actionError && <div className="form-error" role="alert">{actionError}</div>}
      </div>

      {j.alerts.length > 0 && (
        <section className="journey-section">
          <h2 className="section-title">Événements</h2>
          {j.alerts.map((a) => (
            <div key={a.id} className={"journey-event" + (a.major ? " major" : "")}>
              <Icon name="alert-triangle" size={16} />
              <div>
                <div className="journey-event-title">{a.header || "Perturbation"}</div>
                {a.description && a.description !== a.header && <div className="journey-event-text">{a.description}</div>}
                <div className="form-hint">{a.scope === "trip" ? "Ce train" : a.scope === "line" ? "Toute la ligne" : "Gare"}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="journey-section">
        <h2 className="section-title">Arrêts</h2>
        <ol className="journey-stops">
          {j.stops.map((st, i) => {
            const at = st.estimatedDeparture ?? st.estimatedArrival;
            const sched = i === 0 ? st.scheduledDeparture : st.scheduledArrival;
            const est = i === 0 ? st.estimatedDeparture : st.estimatedArrival;
            const changed = est && fmtClock(est) !== fmtClock(sched);
            return (
              <li key={`${st.station.id}-${i}`} className={"journey-stop" + (st.inJourney ? " in" : "") + (st.skipped ? " skipped" : "")}>
                <span className="journey-stop-dot" aria-hidden="true" />
                <span className="journey-stop-name">{st.station.name}{st.skipped && <span className="journey-stop-flag"> · supprimé</span>}</span>
                <span className="journey-stop-time mono">
                  <span className={changed ? "old" : ""}>{fmtClock(sched)}</span>
                  {changed && <span className="t-est"> {fmtClock(est)}</span>}
                  {at && st.delay > 0 ? <span className="t-delay"> {delayLabel(st.delay)}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <BottomSheet open={alertOpen} onClose={() => setAlertOpen(false)} heightVh={80}>
        {alertOpen && (
          <TrainAlertForm scope="trip" alert={alert} subject={`${j.line?.name ?? ""} ${fmtClock(j.scheduledDeparture)} ${j.departureStation.name} → ${j.arrivalStation.name}`.trim()}
            onSubmit={saveAlert} onCancel={() => setAlertOpen(false)}
            onDelete={alert ? async () => { await act(() => my.deleteAlert(alert.id)); setAlertOpen(false); } : null} />
        )}
      </BottomSheet>
    </div>
    </PullToRefresh>
  );
}
