// Appui long (doigt maintenu ~0,5 s, ou clic droit / appui long système qui ouvre le
// menu contextuel) sur une zone qui contient des liens. Après un appui long, le clic
// qui suit (lâcher du doigt) est annulé : ni lien ouvert, ni panneau refermé.
import { useRef } from "react";

export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10; // px : au-delà, c'est un défilement, pas un appui long

/**
 * Le clic qui suit le lâcher du doigt atteindrait ce qui vient de s'ouvrir sous lui
 * (fond d'un panneau → fermeture immédiate, ou lien) : il est ignoré, jusqu'à 350 ms
 * après le lâcher (3 s au plus si aucun lâcher n'est reçu, ex. clic droit).
 */
function swallowNextClick() {
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  const stop = () => document.removeEventListener("click", swallow, true);
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerup", () => setTimeout(stop, 350), { capture: true, once: true });
  setTimeout(stop, 3000);
}

export function useLongPress(onLongPress, { ms = LONG_PRESS_MS } = {}) {
  const timer = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const fire = () => {
    clear();
    fired.current = true;
    swallowNextClick();
    navigator.vibrate?.(10);
    cb.current();
  };

  return {
    onPointerDown(e) {
      fired.current = false;
      if (e.button !== undefined && e.button !== 0) return; // clic droit : voir onContextMenu
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(fire, ms);
    },
    onPointerMove(e) {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE_TOLERANCE) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // Android : l'appui long déclenche le menu contextuel ; ordinateur : clic droit.
    onContextMenu(e) {
      e.preventDefault();
      if (!fired.current) fire();
    },
  };
}
