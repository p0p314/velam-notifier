import { useRef, useState } from "react";
import BottomSheet from "./BottomSheet";
import Icon from "./Icon";
import { TUTORIAL_SLIDES } from "../lib/tutorial";

// Glissement horizontal minimal (px) pour changer de slide au doigt.
const SWIPE_MIN = 50;

/**
 * Tutoriel en slides : « Suivant » (ou glisser) avance, « Arrêter » le ferme à tout
 * moment ; la dernière slide se termine par « C'est parti ». `onClose` est appelé
 * dans tous les cas (terminé ou arrêté).
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
  };

  return (
    <BottomSheet open onClose={onClose} heightVh={72} labelledBy="tutorial-title">
      <div className="tutorial" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onKeyDown={onKeyDown}>
        <div className="tutorial-count" aria-live="polite">{index + 1} / {slides.length}</div>
        <div className="tutorial-slide" key={index}>
          <span className="tutorial-icon" aria-hidden="true"><Icon name={slide.icon} size={30} /></span>
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
          <button type="button" className="onboarding-next" data-autofocus onClick={next}>
            {last ? "C'est parti" : "Suivant"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
