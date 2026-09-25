import { useState, useRef } from "react";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import Icon from "../components/Icon";
import { OfflineBanner } from "../components/Offline";
import LocateHint from "../components/LocateHint";
import { useStations, useFavorites, useGeolocation, distanceKm } from "../hooks";
import { SORTS, loadSortPref, saveSortPref, moveItem, displayStation, sortFavorites } from "../lib/favorites";

const REVEAL = 84;

/** Card favori avec swipe gauche → bouton supprimer (pointer events natifs). */
function FavoriteItem({ s, onOpen, onDelete, dist }) {
  const [tx, setTx] = useState(0);
  const base = useRef(0);
  const startX = useRef(null);
  const moved = useRef(false);

  const down = (e) => {
    startX.current = e.clientX;
    base.current = tx;
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) moved.current = true;
    setTx(Math.max(-REVEAL, Math.min(0, base.current + dx)));
  };
  const up = () => {
    if (startX.current == null) return;
    setTx(tx < -REVEAL / 2 ? -REVEAL : 0);
    startX.current = null;
  };
  const click = () => {
    if (moved.current) return;       // c'était un swipe, pas un tap
    if (tx < 0) { setTx(0); return; } // refermer si déjà révélé
    onOpen();
  };

  const revealed = tx < 0;
  return (
    <div className="swipe-wrap">
      {/* Mobile : bouton révélé par le swipe */}
      <button
        className="swipe-delete"
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
        style={{ transform: `translateX(${tx}px)`, transition: startX.current == null ? "transform 0.2s ease" : "none", touchAction: "pan-y" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
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

export default function Favorites() {
  const { stations, loading, stale, staleReason, lastUpd } = useStations();
  const { favorites, favIds, toggleFav, rename, reorder, loading: favLoading, stale: favStale } = useFavorites();
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
    <div className="view-pad">
      <div className="page-head">
        <h2 className="page-title">Mes favoris</h2>
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
          <div className="empty-sub">Depuis l'onglet Stations, ouvrez une station puis « Ajouter aux favoris ».</div>
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
    </div>
  );
}
