import { useId } from "react";

/**
 * Logotype « mox » : le « o » est le cadran du logo, cercle complet aux proportions d'un
 * « o » de la police (unité 1/1000 em : diamètre 530, trait 140), avec le point de signal
 * posé dans l'anneau à 11 h, détaché par un liseré découpé (masque, donc valable sur tout fond).
 * Couleurs : tokens --brand-mark / --brand-signal (styles.css). Taille : font-size du parent.
 */
export default function Wordmark({ className = "" }) {
  const mask = `mox-o-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={`wordmark ${className}`.trim()} role="img" aria-label="Mox">
      <span aria-hidden="true">m</span>
      <svg className="wordmark-o" viewBox="0 0 530 530" aria-hidden="true" focusable="false">
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="530" height="530">
          <rect width="530" height="530" fill="#fff" />
          <circle cx="167.5" cy="96.13" r="88" fill="#000" />
        </mask>
        <circle cx="265" cy="265" r="195" fill="none" stroke="var(--brand-mark)" strokeWidth="140" mask={`url(#${mask})`} />
        <circle cx="167.5" cy="96.13" r="70" fill="var(--brand-signal)" />
      </svg>
      <span aria-hidden="true">x</span>
    </span>
  );
}
