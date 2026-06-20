import { useEffect, useRef, useState } from "react";

/**
 * Bottom sheet accessible, sans librairie.
 * - part du bas, hauteur paramétrable (heightVh)
 * - fermeture : tap overlay, swipe vers le bas (barre de drag), touche Échap
 * - focus trap + verrouillage du scroll du body pendant l'ouverture
 */
export default function BottomSheet({ open, onClose, heightVh = 70, children, labelledBy }) {
  const panelRef = useRef(null);
  const dragStart = useRef(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDragY(0);

    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") trapTab(e);
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector(
        "[data-autofocus], button:not([disabled]), input, select, textarea, a[href]"
      );
      el?.focus();
    }, 40);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, onClose]);

  const trapTab = (e) => {
    const nodes = panelRef.current?.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes) return;
    const list = Array.from(nodes).filter((el) => !el.disabled && el.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;

  const onPointerDown = (e) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (dragStart.current == null) return;
    const dy = e.clientY - dragStart.current;
    if (dy > 0) setDragY(dy);
  };
  const onPointerUp = () => {
    if (dragStart.current == null) return;
    if (dragY > 120) onClose();
    else setDragY(0);
    dragStart.current = null;
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        style={{
          // hauteur pilotée en CSS (var) pour permettre l'override desktop (modale)
          "--sheet-h": `${heightVh}vh`,
          transform: `translateY(${dragY}px)`,
          transition: dragStart.current == null ? "transform 0.25s ease" : "none",
        }}
      >
        <div
          className="sheet-handle-wrap"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="sheet-handle" />
        </div>
        {/* Croix de fermeture — visible uniquement en desktop (modale) */}
        <button className="sheet-close" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="sheet-content">{children}</div>
      </div>
    </div>
  );
}
