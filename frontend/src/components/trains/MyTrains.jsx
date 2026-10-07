import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import BottomSheet from "../BottomSheet";
import LineBadge from "./LineBadge";
import JourneyCard from "./JourneyCard";
import TrainStatus from "./TrainStatus";
import Freshness from "./Freshness";
import TrainAlertForm from "./TrainAlertForm";
import { describeTrainAlert, favoriteTitle, fmtClock, nearbyVelam } from "../../lib/trains";
import { fmtDistance } from "../../hooks";
import { useLongPress } from "../../useLongPress";

const dayLabel = (j) => new Date(`${j.serviceDate}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** Bouton en deux temps (« Retirer » puis « Confirmer ») : pas de suppression par erreur. */
function ConfirmButton({ label, confirmLabel, onConfirm }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={"link-btn" + (armed ? " danger-text" : "")}
      onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)}>
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Interrupteur actif / en pause d'une alerte. */
export function AlertSwitch({ alert, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={alert.active} aria-label={alert.active ? "Désactiver l'alerte" : "Activer l'alerte"}
      className={"switch" + (alert.active ? " on" : "")} onClick={() => onToggle(alert)}>
      <span className="switch-knob" />
    </button>
  );
}

/**
 * Correspondance Vélam d'un train : places libres près de la gare de départ (on y
 * dépose son vélo), vélos près de la gare d'arrivée (on repart à vélo). Rien si la
 * gare est loin de toute station (hors d'Amiens).
 */
function VelamLinks({ journey, stations }) {
  const rows = [
    { label: "Au départ", hit: nearbyVelam(stations, journey.departureStation, "docks"), unit: (n) => `${n} place${n > 1 ? "s" : ""}` },
    { label: "À l'arrivée", hit: nearbyVelam(stations, journey.arrivalStation, "bikes"), unit: (n) => `${n} vélo${n > 1 ? "s" : ""}` },
  ].filter((r) => r.hit);
  if (!rows.length) return null;
  return (
    <ul className="velam-links" aria-label="Stations Vélam proches">
      {rows.map((r) => (
        <li key={r.label}>
          <Icon name="bike" size={15} />
          <span>{r.label} : <b>{r.hit.station.name}</b> · {r.hit.count ? r.unit(r.hit.count) : "vide"} · {fmtDistance(r.hit.km)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Un train favori : seulement sa prochaine circulation (celle du jour, sinon la
 * suivante). Les autres jours s'ouvrent en maintenant le doigt sur le train (ou par
 * clic droit, ou le bouton « Autres jours » réservé au clavier / lecteur d'écran).
 */
function FavoriteTrain({ f, stations, onEditAlert, onRemove, onToggleAlert }) {
  const [current, ...later] = f.next ?? [];
  const [othersOpen, setOthersOpen] = useState(false);
  const press = useLongPress(() => setOthersOpen(true));
  return (
    <article className="my-train">
      <div className="my-train-head">
        {/* Le badge de ligne figure déjà sur la carte du prochain train. */}
        {!current && <LineBadge line={{ name: f.line_name }} />}
        <div className="my-train-title">
          <div className="my-train-name">{favoriteTitle(f)}</div>
          {f.label && <div className="my-train-sub">{f.departure_time} {f.origin_name} → {f.destination_name}</div>}
        </div>
        <ConfirmButton label="Retirer" confirmLabel="Confirmer" onConfirm={() => onRemove(f)} />
      </div>

      {f.next === null ? (
        <div className="form-hint">État indisponible pour le moment (horaires en cours de chargement).</div>
      ) : current ? (
        <>
          {current.scheduleChanged && (
            <div className="train-note warn"><Icon name="clock" size={14} /><span>Horaire modifié : départ à {fmtClock(current.scheduledDeparture)} au lieu de {f.departure_time}</span></div>
          )}
          <div className="my-train-press" {...press} title="Maintenir pour voir les autres jours">
            <JourneyCard j={current} showDate />
          </div>
          <button type="button" className="sr-only" onClick={() => setOthersOpen(true)}>Autres jours</button>
          <VelamLinks journey={current} stations={stations} />
          <BottomSheet open={othersOpen} onClose={() => setOthersOpen(false)} heightVh={50} labelledBy={`autres-jours-${f.id}`}>
            <h2 id={`autres-jours-${f.id}`} className="section-title">Autres jours</h2>
            <div className="form-hint">{favoriteTitle(f)}</div>
            {later.length > 0 ? (
              <ul className="my-train-next" aria-label="Prochaines circulations">
                {later.map((j) => (
                  <li key={j.id}>
                    <Link to={`/trains/trajet?id=${encodeURIComponent(j.id)}`}>
                      <span>{dayLabel(j)} · {fmtClock(j.scheduledDeparture)}</span>
                      <TrainStatus journey={j} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="view-state">Aucune autre circulation dans les 8 prochains jours.</div>
            )}
          </BottomSheet>
        </>
      ) : (
        <div className="form-hint">Aucune circulation prévue dans les 8 prochains jours.</div>
      )}

      <div className="my-train-alert">
        <Icon name="bell" size={16} />
        {f.alert ? (
          <>
            <button type="button" className="link-btn my-train-alert-text" onClick={() => onEditAlert(f)}>{describeTrainAlert(f.alert)}</button>
            <AlertSwitch alert={f.alert} onToggle={onToggleAlert} />
          </>
        ) : (
          <button type="button" className="link-btn" onClick={() => onEditAlert(f)}>Créer une alerte</button>
        )}
      </div>
    </article>
  );
}

/**
 * Trains favoris (section de « Mes trajets ») : état actuel, prochaines circulations,
 * correspondance Vélam, alerte. `t` : état de useMyTrains ; `stations` : stations Vélam.
 */
export default function MyTrains({ t, stations = [] }) {
  const [editing, setEditing] = useState(null); // favori dont on crée / modifie l'alerte
  const [error, setError] = useState(null);

  const act = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
  };
  const toggleAlert = (a) => act(() => t.updateAlert(a.id, { active: !a.active }));
  const save = async (payload) => {
    if (editing.alert) await t.updateAlert(editing.alert.id, payload);
    else await t.createAlert({ scope: "trip", favorite_id: editing.id, ...payload });
    setEditing(null);
  };
  const remove = async () => {
    await act(() => t.deleteAlert(editing.alert.id));
    setEditing(null);
  };

  return (
    <section className="my-trains-section" aria-label="Trains">
      <div className="page-head">
        <h2 className="section-title">Trains</h2>
        {t.favorites.length > 0 && <Link to="/trains" className="link-btn section-link">Chercher un train</Link>}
      </div>
      {t.loading ? (
        <div className="view-state">Chargement…</div>
      ) : t.error && !t.data ? (
        <div className="error-box">
          <div className="error-title">{t.error}</div>
          <button className="error-retry" onClick={() => t.load()}>Réessayer</button>
        </div>
      ) : t.favorites.length === 0 ? (
        <div className="empty-inline">
          <Icon name="train" size={22} />
          <span>Aucun train suivi. <Link to="/trains">Cherchez un train</Link> (Lille Flandres → Amiens…) puis ajoutez-le aux favoris.</span>
        </div>
      ) : (
        <>
          <Freshness realtime={t.data?.realtime} />
          {error && <div className="form-error" role="alert">{error}</div>}
          {t.favorites.map((f) => (
            <FavoriteTrain key={f.id} f={f} stations={stations} onToggleAlert={toggleAlert}
              onRemove={(fav) => act(() => t.removeFavorite(fav.id))}
              onEditAlert={(fav) => setEditing(fav)} />
          ))}
        </>
      )}

      <BottomSheet open={!!editing} onClose={() => setEditing(null)} heightVh={80}>
        {editing && (
          <TrainAlertForm key={editing.id} scope="trip" alert={editing.alert} subject={favoriteTitle(editing)}
            onSubmit={save} onCancel={() => setEditing(null)} onDelete={remove} />
        )}
      </BottomSheet>
    </section>
  );
}
