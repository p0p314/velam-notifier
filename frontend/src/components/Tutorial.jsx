import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Logo from "./Logo";
import { TUTORIAL_SLIDES } from "../lib/tutorial";

// Glissement horizontal minimal (px) pour changer de slide au doigt.
const SWIPE_MIN = 50;

/**
 * Tutoriel en slides : « Suivant » (ou glisser) avance, « Arrêter » le ferme à tout
 * moment ; la dernière slide se termine par « C'est parti ». `onClose` est appelé
 * dans tous les cas (terminé ou arrêté). Plein écran, par-dessus toute l'app :
 * défilement de la page bloqué, Échap = arrêter, focus sur « Suivant ».
 */
export default function Tutorial({ onClose, slides = TUTORIAL_SLIDES }) {
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);
  const slide = slides[index];
  const last = index === slides.length - 1;

  const go = (i) => setIndex(Math.max(0, Math.min(slides.length - 1, i)));
  const next = () => (last ? onClose() : go(index + 1));

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx <= -SWIPE_MIN) go(index + 1);
    else if (dx >= SWIPE_MIN) go(index - 1);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Escape") onClose();
  };

  const nextRef = useRef(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nextRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tutorial-title"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onKeyDown={onKeyDown}>
      <div className="tutorial-inner">
        <div className="tutorial-head">
          <span className="brand-logo"><Logo /></span>
          <span className="tutorial-count" aria-live="polite">{index + 1} / {slides.length}</span>
        </div>
        <div className="tutorial-slide" key={index}>
          <span className="tutorial-icon" aria-hidden="true"><Icon name={slide.icon} size={40} /></span>
          <div id="tutorial-title" className="tutorial-title">{slide.title}</div>
          <p className="tutorial-text">{slide.text}</p>
          {slide.points?.length > 0 && (
            <ul className="tutorial-points">
              {slide.points.map((p) => <li key={p}><Icon name="check" size={15} /><span>{p}</span></li>)}
            </ul>
          )}
        </div>

        <div className="tutorial-dots">
          {slides.map((s, i) => (
            <button key={s.title} type="button" className={i === index ? "on" : ""}
              aria-label={`Aller à l'étape ${i + 1} : ${s.title}`} aria-current={i === index ? "step" : undefined}
              onClick={() => go(i)} />
          ))}
        </div>

        <div className="tutorial-nav">
          {!last && <button type="button" className="cancel-btn" onClick={onClose}>Arrêter le tutoriel</button>}
          <button type="button" className="onboarding-next" ref={nextRef} onClick={next}>
            {last ? "C'est parti" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}
