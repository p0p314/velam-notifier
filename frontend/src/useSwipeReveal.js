// Glisser vers la gauche pour révéler un bouton (supprimer), avec verrouillage d'axe :
// le premier mouvement net décide du geste pour toute sa durée.
//  - horizontal → la ligne suit le doigt et le défilement vertical de la page est bloqué
//    (touchmove natif non passif : React ne permet pas d'annuler un touchmove) ;
//  - vertical → la page défile, la ligne ne bouge plus jusqu'au lâcher.
// Partagé par les favoris et les alertes (SwipeRow).
import { useCallback, useEffect, useRef, useState } from "react";

export const DRAG_MIN = 8; // px avant de décider de l'axe (en deçà : un appui)

export function useSwipeReveal(reveal) {
  const [tx, setTx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null); // { x, y, base, axis: null | "x" | "y" }
  const moved = useRef(false); // le geste en cours / dernier geste était un glissement
  const el = useRef(null);
  const txRef = useRef(0);
  txRef.current = tx;

  // Bloque le défilement vertical tant qu'un glissement horizontal est engagé.
  useEffect(() => {
    const node = el.current;
    if (!node) return undefined;
    const block = (e) => { if (start.current?.axis === "x" && e.cancelable) e.preventDefault(); };
    node.addEventListener("touchmove", block, { passive: false });
    return () => node.removeEventListener("touchmove", block);
  }, []);

  const onPointerDown = useCallback((e) => {
    start.current = { x: e.clientX, y: e.clientY, base: txRef.current, axis: null };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback((e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < DRAG_MIN && Math.abs(dy) < DRAG_MIN) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "y") return; // défilement : la ligne reste en place
      moved.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (s.axis !== "x") return;
    setTx(Math.max(-reveal, Math.min(0, s.base + dx)));
  }, [reveal]);

  const end = useCallback(() => {
    const s = start.current;
    if (s?.axis === "x") setTx((t) => (t < -reveal / 2 ? -reveal : 0));
    start.current = null;
    setDragging(false);
  }, [reveal]);

  const close = useCallback(() => setTx(0), []);

  return {
    tx,
    dragging,
    revealed: tx < 0,
    moved,
    close,
    bind: { ref: el, onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
