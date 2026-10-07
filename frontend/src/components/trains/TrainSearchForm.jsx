import { useState } from "react";
import Icon from "../Icon";
import Autocomplete from "./Autocomplete";
import { networkToday, searchError } from "../../lib/trains";

const lineItem = (l) => (
  <span className="ac-line"><b>{l.name}</b>{l.longName && <span>{l.longName}</span>}</span>
);

/**
 * Formulaire de recherche : gare de départ, gare d'arrivée (avec inversion du sens),
 * ligne facultative, date et heure de départ facultative. Une gare seule = tous ses
 * départs ; une ligne seule = tous les trajets de la ligne ce jour-là.
 */
export default function TrainSearchForm({ initial, onSearch }) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [line, setLine] = useState(initial.line);
  const [date, setDate] = useState(initial.date || networkToday());
  const [after, setAfter] = useState(initial.after);
  const [error, setError] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const search = { from, to, line, date, after };
    const err = searchError(search);
    setError(err);
    if (!err) onSearch(search);
  };

  return (
    <form className="train-search" onSubmit={submit} aria-label="Rechercher des trains">
      <div className="train-search-route">
        <div className="train-search-stations">
          <Autocomplete kind="stations" label="Gare de départ" placeholder="Départ (ex. Lille Flandres)" icon="map-pin" value={from} onChange={setFrom} />
          <Autocomplete kind="stations" label="Gare d'arrivée" placeholder="Arrivée (ex. Amiens)" icon="map-pin" value={to} onChange={setTo} />
        </div>
        <button type="button" className="icon-btn train-swap" aria-label="Inverser le sens du trajet" onClick={() => { setFrom(to); setTo(from); }}>
          <Icon name="swap" size={18} />
        </button>
      </div>
      <Autocomplete kind="lines" label="Ligne" placeholder="Ligne facultative (ex. K44)" icon="route" value={line} onChange={setLine} renderItem={lineItem} />
      <div className="train-search-when">
        <label className="train-field">
          <span className="form-label">Date</span>
          <input type="date" className="field mono" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" required />
        </label>
        <label className="train-field">
          <span className="form-label">À partir de</span>
          <input type="time" className="field mono" value={after} onChange={(e) => setAfter(e.target.value)} aria-label="Heure de départ minimale" />
          {after
            ? <button type="button" className="link-btn field-clear" onClick={() => setAfter("")}>Toute la journée</button>
            : <span className="form-hint">Vide : toute la journée</span>}
        </label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="submit-btn">Voir les trains</button>
    </form>
  );
}
