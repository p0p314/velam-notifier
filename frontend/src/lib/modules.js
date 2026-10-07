// Fonctionnalités utilisées par le compte : vélos (Vélam) et / ou trains (SNCF), au
// moins l'une des deux (réglage serveur, porté par l'utilisateur : `user.modules`).
// Une fonctionnalité désactivée disparaît de la navigation, des pages et des
// réglages ; ses alertes ne sont plus envoyées. Sans React → testable.

/** { bikes, trains } de l'utilisateur ; absent ou incohérent (aucun des deux) = les deux. */
export function modulesOf(user) {
  const m = { bikes: user?.modules?.bikes !== false, trains: user?.modules?.trains !== false };
  return m.bikes || m.trains ? m : { bikes: true, trains: true };
}

/** Peut-on désactiver `name` ? Non s'il est la seule fonctionnalité active. */
export const canDisable = (modules, name) => !modules[name] || Object.entries(modules).some(([k, v]) => k !== name && v);

/** Page de repli quand une adresse mène à une fonctionnalité désactivée. */
export const fallbackPath = () => "/trajets";
