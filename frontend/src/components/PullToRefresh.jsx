import { useEffect, useRef, useState } from "react";

// Distance à tirer (px, après résistance) pour déclencher l'actualisation, et maximum.
export const PULL_THRESHOLD = 72;
const PULL_MAX = 110;
const RESISTANCE = 0.5; // le contenu suit le doigt à mi-vitesse (sensation « élastique »)
const RING = 2 * Math.PI * 9;

// Zones où le geste appartient à autre chose (carte, feuilles, champs, listes de suggestions).
const IGNORE = ".sheet-overlay, .map-container, .ac-list, input, textarea, select, [data-no-pull]";

/**
 * « Tirer pour actualiser » (mobile) : tirer la page vers le bas depuis le haut remplit
 * un anneau ; relâché plein, `onRefresh` est appelé (l'anneau tourne jusqu'à la fin),
 * relâché avant, rien ne se passe. Norme des apps mobiles : déclenchement à la distance
 * tirée (~70 px), pas à la durée. Sans effet à la souris (événements tactiles seulement).
 */
export default function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);   // { x, y } du doigt au début du geste
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const set = (v) => { pullRef.current = v; setPull(v); };
    const onStart = (e) => {
      if (busyRef.current || window.scrollY > 0 || e.touches.length !== 1) return;
      if (e.target.closest?.(IGNORE)) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false };
    };
    const onMove = (e) => {
      const s = start.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // Geste horizontal (glisser pour supprimer) ou vers le haut : pas pour nous.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) { start.current = null; return; }
        s.decided = true;
      }
      if (window.scrollY > 0 || dy <= 0) { set(0); return; }
      if (e.cancelable) e.preventDefault(); // pas de rebond natif pendant qu'on tire
      set(Math.min(PULL_MAX, dy * RESISTANCE));
    };
    const onEnd = async () => {
      if (!start.current) return;
      start.current = null;
      if (pullRef.current < PULL_THRESHOLD) { set(0); return; }
      busyRef.current = true;
      setBusy(true);
      set(PULL_THRESHOLD * 0.7);
      try { await refreshRef.current?.(); } catch { /* l'erreur est affichée par la page */ }
      busyRef.current = false;
      setBusy(false);
      set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const label = busy ? "Actualisation…" : progress >= 1 ? "Relâchez pour actualiser" : "Tirez pour actualiser";
  return (
    <>
      <div className={"ptr" + (busy ? " busy" : "") + (start.current ? "" : " settle")} style={{ height: pull }}
        role={busy ? "status" : undefined} aria-hidden={!busy && pull === 0}>
        {pull > 8 && (
          <div className="ptr-inner">
            <svg className="ptr-ring" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle cx="12" cy="12" r="9" className="ptr-track" />
              <circle cx="12" cy="12" r="9" className="ptr-fill"
                style={{ strokeDasharray: RING, strokeDashoffset: busy ? RING * 0.7 : RING * (1 - progress) }} />
            </svg>
            <span>{label}</span>
          </div>
        )}
      </div>
      {children}
    </>
  );
}
