// Partage du lien de l'application : feuille de partage du système si disponible,
// sinon copie dans le presse-papiers. Sans React → testable unitairement.

/**
 * Renvoie "shared" (partagé ou annulé par l'utilisateur), "copied" (lien copié)
 * ou "failed" (ni partage ni copie possibles : afficher le lien).
 */
export async function shareApp(url = window.location.origin) {
  const data = {
    title: "Mox",
    text: "Mox : les vélos en libre-service (Vélam, Vélo'v…) et les trains, en temps réel, avec des alertes quand il le faut.",
    url,
  };
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      // Fenêtre fermée par l'utilisateur : ce n'est pas un échec, rien à copier.
      if (err?.name === "AbortError") return "shared";
      // Autre refus (contexte non autorisé…) : repli sur le presse-papiers.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
