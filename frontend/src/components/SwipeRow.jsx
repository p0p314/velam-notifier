import { useRef, useState } from "react";
import Icon from "./Icon";

const REVEAL = 84;
const DRAG_MIN = 8; // px avant de considérer un glissement (sinon c'est un appui)

/**
 * Ligne glissable (mobile) : glisser vers la gauche révèle un bouton « Supprimer ».
 * Contrairement aux favoris, le contenu a ses propres boutons (interrupteur, jours…) :
 * le pointeur n'est capturé qu'une fois le glissement engagé, et le clic qui suit un
 * glissement — ou un appui quand le bouton est révélé (il referme) — est neutralisé.
 * Desktop : pas de glissement (CSS), la suppression passe par le formulaire.
 */
export default function SwipeRow({ onDelete, label = "Supprimer", children }) {
  const [tx, setTx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null); // { x, y, base }
  const moved = useRef(false);

  const down = (e) => {
    start.current = { x: e.clientX, y: e.clientY, base: tx };
    moved.current = false;
  };
  const move = (e) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    if (!moved.current) {
      // Défilement vertical : on laisse faire la page.
      if (Math.abs(e.clientY - start.current.y) > Math.abs(dx)) { start.current = null; return; }
      if (Math.abs(dx) < DRAG_MIN) return;
      moved.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setTx(Math.max(-REVEAL, Math.min(0, start.current.base + dx)));
  };
  const up = () => {
    if (start.current && moved.current) setTx((t) => (t < -REVEAL / 2 ? -REVEAL : 0));
    start.current = null;
    setDragging(false);
  };
  const clickCapture = (e) => {
    if (moved.current) { moved.current = false; e.stopPropagation(); e.preventDefault(); return; }
    if (tx < 0) { setTx(0); e.stopPropagation(); e.preventDefault(); }
  };

  const revealed = tx < 0;
  return (
    <div className="swipe-wrap">
      {/* Masqué au repos : sinon son rouge déborde à l'anticrénelage des coins arrondis. */}
      <button className="swipe-delete" onClick={onDelete} tabIndex={revealed ? 0 : -1}
        aria-hidden={!revealed} aria-label={label}
        style={{ visibility: revealed || dragging ? "visible" : "hidden" }}>
        <Icon name="trash" />
      </button>
      <div className="swipe-fg"
        style={{ transform: `translateX(${tx}px)`, transition: dragging ? "none" : "transform 0.2s ease", touchAction: "pan-y" }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={clickCapture}>
        {children}
      </div>
    </div>
  );
}
