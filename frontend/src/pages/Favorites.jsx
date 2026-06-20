import { useState, useRef } from "react";
import StationListItem from "../components/StationListItem";
import StationDetailSheet from "../components/StationDetailSheet";
import { useStations, useFavorites } from "../hooks";
import { C } from "../theme";

const REVEAL = 84;

/** Card favori avec swipe gauche → bouton supprimer (pointer events natifs). */
function FavoriteItem({ s, onOpen, onDelete }) {
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
      >
        Supprimer
      </button>
      {/* Desktop : corbeille au survol (CSS) */}
      <button className="fav-trash" aria-label="Retirer des favoris" onClick={() => onDelete(s)}>🗑</button>
      <div
        className="swipe-fg"
        style={{ transform: `translateX(${tx}px)`, transition: startX.current == null ? "transform 0.2s ease" : "none", touchAction: "pan-y" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={click}
      >
        <StationListItem s={s} />
      </div>
    </div>
  );
}

export default function Favorites() {
  const { stations, loading } = useStations();
  const { favorites, favIds, toggleFav, loading: favLoading } = useFavorites();
  const [selId, setSelId] = useState(null);

  const favStations = favorites
    .map((f) => stations.find((s) => s.station_id === f.station_id) ?? {
      station_id: f.station_id, name: f.station_name, electrical: 0, mechanical: 0, capacity: 0, docks_available: 0,
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const selected = stations.find((s) => s.station_id === selId) ?? null;

  return (
    <div className="view-pad">
      <h2 style={{ fontSize: 18, fontWeight: 800 }}>Mes favoris</h2>

      {(loading || favLoading) ? (
        <div className="view-state">Chargement…</div>
      ) : favStations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "72px 16px", color: C.muted }}>
          <div style={{ fontSize: 52, marginBottom: 14, opacity: 0.7 }}>⭐</div>
          <div style={{ fontSize: 15 }}>Ajoutez des stations en favoris</div>
          <div style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>Depuis l'onglet Stations, tapez une station puis « Ajouter aux favoris ».</div>
        </div>
      ) : (
        <div className="favoris-grid">
          {favStations.map((s) => (
            <FavoriteItem
              key={s.station_id}
              s={s}
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
