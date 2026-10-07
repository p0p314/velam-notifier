import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import BottomSheet from "../BottomSheet";
import LineBadge from "./LineBadge";
import Autocomplete from "./Autocomplete";
import TrainAlertForm from "./TrainAlertForm";
import { AlertSwitch } from "./MyTrains";
import { describeTrainAlert, favoriteTitle } from "../../lib/trains";

const lineItem = (l) => (
  <span className="ac-line"><b>{l.name}</b>{l.longName && <span>{l.longName}</span>}</span>
);

const titleOf = (a) => (a.scope === "line"
  ? a.line_long_name || `Ligne ${a.line_name}`
  : a.favorite ? favoriteTitle(a.favorite) : "Trajet");

/**
 * Alertes trains de la page Alertes : trajets (créées depuis un train) et lignes
 * suivies. Appui sur le titre = modifier ; interrupteur = activer / suspendre.
 */
export default function TrainAlertsList({ t, paused }) {
  const [editing, setEditing] = useState(null); // alerte modifiée
  const [lineSheet, setLineSheet] = useState(false);
  const [line, setLine] = useState(null);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
  };
  const closeLine = () => { setLineSheet(false); setLine(null); };

  const trips = t.alerts.filter((a) => a.scope === "trip");
  const lines = t.alerts.filter((a) => a.scope === "line");
  const card = (a) => (
    <article key={a.id} className={"alert-card" + (a.active && !paused ? "" : " off")}>
      <div className="alert-card-head">
        <span className="alert-kind" aria-hidden="true"><Icon name={a.scope === "line" ? "route" : "train"} size={16} /></span>
        {a.scope === "line" ? <LineBadge line={{ name: a.line_name }} /> : a.favorite?.line_name && <LineBadge line={{ name: a.favorite.line_name }} />}
        <button type="button" className="alert-card-main" onClick={() => setEditing(a)}>
          <span className="alert-card-name">{titleOf(a)}</span>
          <span className="alert-card-sub">{describeTrainAlert(a)}</span>
        </button>
        <AlertSwitch alert={a} onToggle={(x) => act(() => t.updateAlert(x.id, { active: !x.active }))} />
      </div>
    </article>
  );

  return (
    <div className="train-alerts">
      {error && <div className="form-error" role="alert">{error}</div>}
      {t.loading ? <div className="view-state">Chargement…</div> : (
        <>
          <h3 className="section-title">Trajets</h3>
          {trips.length ? trips.map(card) : (
            <div className="empty-inline">
              <Icon name="train" size={20} />
              <span>Ouvrez un train (onglet <Link to="/trains">Trains</Link> ou Mes trajets) puis « Créer une alerte » : retard, suppression, perturbation.</span>
            </div>
          )}
          <h3 className="section-title">Lignes suivies</h3>
          {lines.map(card)}
          <button type="button" className="push-banner-btn ghost follow-line" onClick={() => setLineSheet(true)}>
            <Icon name="bell-plus" size={15} /> Suivre une ligne
          </button>
        </>
      )}

      <BottomSheet open={!!editing} onClose={() => setEditing(null)} heightVh={80}>
        {editing && (
          <TrainAlertForm key={editing.id} scope={editing.scope} alert={editing} subject={titleOf(editing)}
            onSubmit={async (payload) => { await t.updateAlert(editing.id, payload); setEditing(null); }}
            onCancel={() => setEditing(null)}
            onDelete={async () => { await act(() => t.deleteAlert(editing.id)); setEditing(null); }} />
        )}
      </BottomSheet>

      <BottomSheet open={lineSheet} onClose={closeLine} heightVh={85}>
        {lineSheet && (line ? (
          <TrainAlertForm scope="line" subject={`${line.name}${line.longName ? ` — ${line.longName}` : ""}`}
            onSubmit={async (payload) => { await t.createAlert({ scope: "line", line: line.id, ...payload }); closeLine(); }}
            onCancel={closeLine} />
        ) : (
          <div className="train-alert-form">
            <div className="form-title">Suivre une ligne</div>
            <span className="form-hint">Perturbations importantes et trains supprimés sur toute la ligne.</span>
            <Autocomplete kind="lines" label="Ligne" placeholder="Ligne (ex. K44)" icon="route" value={null} onChange={setLine} renderItem={lineItem} />
          </div>
        ))}
      </BottomSheet>
    </div>
  );
}
