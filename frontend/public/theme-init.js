// Applique le thème avant le rendu (évite le flash de couleur).
// Fichier externe : la CSP de prod (script-src 'self') bloque les scripts inline.
(function () {
  try {
    var t = localStorage.getItem("velopulse-theme");
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) { document.documentElement.dataset.theme = "light"; }
})();
