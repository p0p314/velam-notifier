// Zoom de l'application : pas de zoom au pincement, mais l'iPhone peut agrandir un champ
// de saisie au focus (texte < 16 px) — l'échelle normale est rétablie dès qu'on quitte
// les champs (clavier fermé, formulaire validé).

const FIELD = "input, select, textarea";
// Le temps pour iOS d'appliquer l'échelle forcée avant de rendre le viewport libre.
export const RESET_DELAY_MS = 300;

const isField = (el) => !!el?.matches?.(FIELD);

/**
 * Remet l'échelle à 1 : iOS n'a pas d'API de dézoom, mais applique un `maximum-scale=1`
 * posé sur le viewport ; on le retire ensuite pour que le prochain champ puisse zoomer.
 */
export function resetZoom(doc = document) {
  const meta = doc.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const base = meta.dataset.base ?? meta.getAttribute("content");
  meta.dataset.base = base;
  meta.setAttribute("content", `${base}, maximum-scale=1.0`);
  setTimeout(() => meta.setAttribute("content", base), RESET_DELAY_MS);
}

/**
 * - pincement bloqué sur iOS (Safari ignore `touch-action` pour ce geste) ;
 * - sortie d'un champ vers autre chose qu'un champ ⇒ retour à l'échelle normale
 *   (passer d'un champ à l'autre garde le zoom, sans va-et-vient).
 * Android : pincement et double-tap bloqués en CSS (`touch-action`), pas de zoom au focus.
 */
export function installZoomControl(doc = document) {
  doc.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  doc.addEventListener("focusout", (e) => {
    if (isField(e.target) && !isField(e.relatedTarget)) resetZoom(doc);
  });
}
