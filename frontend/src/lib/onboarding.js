// Accueil (premier lancement) : quelles étapes restent utiles pour cet utilisateur ?
// Sans React → testable.

export const ONBOARDING_KEY = "velopulse-onboarding-done";

export function isOnboardingDone() {
  try { return localStorage.getItem(ONBOARDING_KEY) === "1"; } catch { return true; }
}
export function markOnboardingDone() {
  try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* facultatif */ }
}

/**
 * Étapes à montrer, dans l'ordre : installer l'app (préalable aux notifications
 * sur iPhone), activer les notifications, ajouter des favoris. Une étape déjà
 * satisfaite (ou impossible) est omise ; liste vide = rien à montrer.
 */
export function onboardingSteps({ isMobile, isInstalled, permission, favoritesCount }) {
  const steps = [];
  if (isMobile && !isInstalled) steps.push("install");
  if (permission === "default") steps.push("notifications");
  if (favoritesCount === 0) steps.push("favorites");
  return steps;
}
