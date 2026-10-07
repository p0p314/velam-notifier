import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import BottomSheet from "../BottomSheet";
import LineBadge from "./LineBadge";
import JourneyCard from "./JourneyCard";
import TrainStatus from "./TrainStatus";
import Freshness from "./Freshness";
import TrainAlertForm from "./TrainAlertForm";
import { useMyTrains } from "../../trainHooks";
import { describeTrainAlert, favoriteTitle, fmtClock } from "../../lib/trains";

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
function AlertSwitch({ alert, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={alert.active} aria-label={alert.active ? "Désactiver l'alerte" : "Activer l'alerte"}
      className={"switch" + (alert.active ? " on" : "")} onClick={() => onToggle(alert)}>
      <span className="switch-knob" />
    </button>
  );
}

function FavoriteTrain({ f, onEditAlert, onRemove, onToggleAlert }) {
  const [current, ...later] = f.next ?? [];
  return (
    <article className="my-train">
      <div className="my-train-head">
        <LineBadge line={current?.line ?? { name: f.line_name }} />
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
          <JourneyCard j={current} showDate />
          {later.length > 0 && (
            <ul className="my-train-next" aria-label="Prochaines circulations">
              {later.map((j) => (
                <li key={j.id}>
                  <Link to={`/trains/trajet?id=${encodeURIComponent(j.id)}`}>
                    <span>{new Date(`${j.serviceDate}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {fmtClock(j.scheduledDeparture)}</span>
                    <TrainStatus journey={j} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
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

/** « Mes trains » : trajets favoris (état actuel, prochaines circulations, alerte) et lignes suivies. */
export default function MyTrains() {
  const t = useMyTrains();
  const [editing, setEditing] = useState(null); // { scope, alert, favorite?, subject }
  const [error, setError] = useState(null);

  const act = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
  };
  const toggleAlert = (a) => act(() => t.updateAlert(a.id, { active: !a.active }));
  const save = async (payload) => {
    const { scope, alert, favorite } = editing;
    if (alert) await t.updateAlert(alert.id, payload);
    else await t.createAlert({ scope, favorite_id: favorite.id, ...payload });
    setEditing(null);
  };
  const remove = async () => {
    await act(() => t.deleteAlert(editing.alert.id));
    setEditing(null);
  };

  if (t.loading) return <div className="view-state">Chargement…</div>;
  if (t.error && !t.data) {
    return (
      <div className="error-box">
        <div className="error-title">{t.error}</div>
        <button className="error-retry" onClick={() => t.load()}>Réessayer</button>
      </div>
    );
  }

  const empty = !t.favorites.length && !t.lineAlerts.length;
  return (
    <div className="my-trains">
      {t.favorites.length > 0 && <Freshness realtime={t.data?.realtime} onRefresh={t.refresh} refreshing={t.refreshing} />}
      {error && <div className="form-error" role="alert">{error}</div>}

      {empty ? (
        <div className="empty-state">
          <Icon name="train" size={40} />
          <div className="empty-title">Aucun trajet suivi</div>
          <div className="empty-sub">Recherchez un train (par exemple Lille Flandres → Amiens), ouvrez-le puis touchez « Ajouter aux favoris ».</div>
        </div>
      ) : (
        <>
          {t.favorites.length > 0 && (
            <section className="my-trains-section">
              <h3 className="section-title">Trajets favoris</h3>
              {t.favorites.map((f) => (
                <FavoriteTrain key={f.id} f={f} onToggleAlert={toggleAlert}
                  onRemove={(fav) => act(() => t.removeFavorite(fav.id))}
                  onEditAlert={(fav) => setEditing({ scope: "trip", alert: fav.alert, favorite: fav, subject: favoriteTitle(fav) })} />
              ))}
            </section>
          )}
          {t.lineAlerts.length > 0 && (
            <section className="my-trains-section">
              <h3 className="section-title">Lignes suivies</h3>
              {t.lineAlerts.map((a) => (
                <article key={a.id} className={"my-train" + (a.active ? "" : " off")}>
                  <div className="my-train-head">
                    <LineBadge line={{ name: a.line_name }} />
                    <div className="my-train-title">
                      <div className="my-train-name">{a.line_long_name || `Ligne ${a.line_name}`}</div>
                      <button type="button" className="link-btn my-train-alert-text"
                        onClick={() => setEditing({ scope: "line", alert: a, subject: `${a.line_name} — ${a.line_long_name}` })}>
                        {describeTrainAlert(a)}
                      </button>
                    </div>
                    <AlertSwitch alert={a} onToggle={toggleAlert} />
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      <BottomSheet open={!!editing} onClose={() => setEditing(null)} heightVh={80}>
        {editing && (
          <TrainAlertForm key={`${editing.scope}-${editing.alert?.id ?? editing.favorite?.id}`} scope={editing.scope} alert={editing.alert}
            subject={editing.subject} onSubmit={save} onCancel={() => setEditing(null)} onDelete={remove} />
        )}
      </BottomSheet>
    </div>
  );
}
