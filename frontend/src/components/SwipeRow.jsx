import Icon from "./Icon";
import { useSwipeReveal } from "../useSwipeReveal";

const REVEAL = 84;

/**
 * Ligne glissable (mobile) : glisser vers la gauche révèle un bouton « Supprimer », axe
 * verrouillé (useSwipeReveal : glissement horizontal = pas de défilement, et inversement).
 * Contrairement aux favoris, le contenu a ses propres boutons (interrupteur, jours…) :
 * le pointeur n'est capturé qu'une fois le glissement engagé, et le clic qui suit un
 * glissement — ou un appui quand le bouton est révélé (il referme) — est neutralisé.
 * Desktop : pas de glissement (CSS), la suppression passe par le formulaire.
 */
export default function SwipeRow({ onDelete, label = "Supprimer", children }) {
  const { tx, dragging, revealed, moved, close, bind } = useSwipeReveal(REVEAL);
  const clickCapture = (e) => {
    if (moved.current) { moved.current = false; e.stopPropagation(); e.preventDefault(); return; }
    if (revealed) { close(); e.stopPropagation(); e.preventDefault(); }
  };

  return (
    <div className="swipe-wrap">
      <button className={"swipe-delete" + (revealed ? " shown" : "")} onClick={onDelete}
        tabIndex={revealed ? 0 : -1} aria-hidden={!revealed} aria-label={label}>
        <Icon name="trash" />
      </button>
      <div className="swipe-fg"
        style={{ transform: `translateX(${tx}px)`, transition: dragging ? "none" : "transform 0.2s ease", touchAction: "pan-y" }}
        {...bind}
        onClickCapture={clickCapture}>
        {children}
      </div>
    </div>
  );
}
