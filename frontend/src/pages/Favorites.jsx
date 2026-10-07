import { useState } from "react";
import { useSwipeReveal } from "../useSwipeReveal";
import { useBikeCity } from "../authContext";
import PullToRefresh from "../components/PullToRefresh";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import Icon from "../components/Icon";
import { OfflineBanner } from "../components/Offline";
import LocateHint from "../components/LocateHint";
import { useStations, useFavorites, useGeolocation, distanceKm } from "../hooks";
import { SORTS, loadSortPref, saveSortPref, moveItem, displayStation, sortFavorites } from "../lib/favorites";

const REVEAL = 84;

/**
 * Card favori : glisser à gauche révèle « Supprimer ». Axe verrouillé (useSwipeReveal) :
 * un glissement horizontal bloque le défilement de la page, et inversement.
 */
function FavoriteItem({ s, onOpen, onDelete, dist }) {
  const { tx, dragging, revealed, moved, close, bind } = useSwipeReveal(REVEAL);
  const click = () => {
    if (moved.current) { moved.current = false; return; } // c'était un glissement, pas un appui
    if (revealed) { close(); return; }                    // refermer si déjà révélé
    onOpen();
  };

  return (
    <div className="swipe-wrap">
      {/* Mobile : bouton révélé par le glissement */}
      <button
        className={"swipe-delete" + (revealed ? " shown" : "")}
        onClick={() => onDelete(s)}
        tabIndex={revealed ? 0 : -1}
        aria-hidden={!revealed}
        aria-label="Supprimer"
      >
        <Icon name="trash" />
      </button>
      {/* Desktop : corbeille au survol (CSS) */}
      <button className="fav-trash" aria-label="Retirer des favoris" onClick={() => onDelete(s)}><Icon name="trash" /></button>
      <div
        className="swipe-fg"
        style={{ transform: `translateX(${tx}px)`, transition: dragging ? "none" : "transform 0.2s ease", touchAction: "pan-y" }}
        {...bind}
        onClick={click}
      >
        <StationListItem s={s} dist={dist} />
      </div>
    </div>
  );
}

/** Ligne du mode « Organiser » : renommer + monter / descendre. */
function OrganizeItem({ fav, index, count, onMove, onRename }) {
  const [label, setLabel] = useState(fav.label ?? "");
  const commit = () => { if ((fav.label ?? "") !== label.trim()) onRename(fav.station_id, label.trim()); };
  return (
    <div className="organize-item">
      <div className="organize-fields">
        <input className="field" value={label} maxLength={40} placeholder={fav.station_name}
          aria-label={`Nom personnalisé pour ${fav.station_name}`}
          onChange={(e) => setLabel(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        {label.trim() && <span className="organize-sub">{fav.station_name}</span>}
      </div>
      <button type="button" className="icon-btn" aria-label={`Monter ${fav.station_name}`}
        disabled={index === 0} onClick={() => onMove(index, -1)}><Icon name="arrow-up" size={18} /></button>
      <button type="button" className="icon-btn" aria-label={`Descendre ${fav.station_name}`}
        disabled={index === count - 1} onClick={() => onMove(index, 1)}><Icon name="arrow-down" size={18} /></button>
    </div>
  );
}

/**
 * Stations favorites. Page autonome (ancienne route) ou section de « Mes trajets »
 * (`embedded`), qui fournit alors l'état des stations (`st`) pour n'en charger qu'un.
 */
export default function Favorites() {
  const st = useStations();
  const fav = useFavorites();
  return (
    <PullToRefresh onRefresh={() => Promise.all([st.reload(), fav.reload()])}>
      <div className="view-pad"><FavoriteStations st={st} fav={fav} /></div>
    </PullToRefresh>
  );
}

export function FavoriteStations({ st, fav, embedded = false }) {
  const city = useBikeCity();
  const { stations, loading, stale, staleReason, lastUpd } = st;
  const { favorites, favIds, toggleFav, rename, reorder, loading: favLoading, stale: favStale } = fav;
  const { coords, status: geoStatus, locate } = useGeolocation();
  const [selId, setSelId] = useState(null);
  const [sort, setSort] = useState(loadSortPref);
  const [organizing, setOrganizing] = useState(false);
  const changeSort = (v) => {
    setSort(v);
    saveSortPref(v);
    if (v === SORTS.distance && !coords) locate(); // clic = consentement explicite
  };

  // Données live de chaque favori (repli sur le nom enregistré si la station manque),
  // nom personnalisé en titre, puis tri : proximité (si position) ou ordre choisi.
  const favStations = sortFavorites(
    favorites.map((f) => displayStation(
      stations.find((s) => s.station_id === f.station_id) ?? {
        station_id: f.station_id, name: f.station_name, electrical: 0, mechanical: 0, capacity: 0, docks_available: 0,
      },
      f,
    )),
    sort,
    coords,
  );

  const move = (index, delta) => reorder(moveItem(favorites, index, delta).map((f) => f.station_id));

  const selected = stations.find((s) => s.station_id === selId) ?? null;

  return (
    <>
      <div className="page-head">
        {embedded
          ? <h2 className="section-title">Stations {city.system}</h2>
          : <h2 className="page-title">Mes favoris</h2>}
        {favStations.length > 0 && <span className="page-count">{favStations.length} station{favStations.length !== 1 ? "s" : ""}</span>}
        {favorites.length > 1 && (
          <button type="button" className="organize-toggle" onClick={() => setOrganizing((o) => !o)}>
            {organizing ? "Terminé" : "Organiser"}
          </button>
        )}
      </div>

      {favorites.length > 1 && !organizing && (
        <div className="seg fav-sort" role="group" aria-label="Trier les favoris">
          <button type="button" aria-pressed={sort === SORTS.distance} className={sort === SORTS.distance ? "active" : ""}
            onClick={() => changeSort(SORTS.distance)}>Proximité</button>
          <button type="button" aria-pressed={sort === SORTS.custom} className={sort === SORTS.custom ? "active" : ""}
            onClick={() => changeSort(SORTS.custom)}>Mon ordre</button>
        </div>
      )}

      {favorites.length > 1 && !organizing && sort === SORTS.distance && !coords && (
        <LocateHint status={geoStatus} onLocate={locate} />
      )}

      <OfflineBanner stale={stale || favStale} staleReason={staleReason ?? (favStale ? "server" : null)} lastUpd={lastUpd} />

      {(loading || favLoading) ? (
        <div className="view-state">Chargement…</div>
      ) : favStations.length === 0 ? (
        <div className="empty-state">
          <Icon name="star" size={40} />
          <div className="empty-title">Ajoutez des stations en favoris</div>
          <div className="empty-sub">Depuis l'onglet Vélos, touchez l'étoile d'une station (maison, travail…).</div>
        </div>
      ) : organizing ? (
        <div className="organize-list">
          {favorites.map((f, i) => (
            <OrganizeItem key={f.station_id} fav={f} index={i} count={favorites.length} onMove={move} onRename={rename} />
          ))}
        </div>
      ) : (
        <div className="favoris-grid">
          {favStations.map((s) => (
            <FavoriteItem
              key={s.station_id}
              s={s}
              dist={coords ? distanceKm(coords, s) : null}
              onOpen={() => setSelId(s.station_id)}
              onDelete={(st) => toggleFav(st)}
            />
          ))}
        </div>
      )}

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
