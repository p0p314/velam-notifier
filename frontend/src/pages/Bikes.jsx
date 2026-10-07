import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import Seg from "../components/Seg";
import { OnlineOnly } from "../components/Offline";
import Stations from "./Stations";

// Carte chargée à la demande : mapbox-gl (~1,5 Mo) reste hors du bundle principal.
const MapPage = lazy(() => import("./MapPage"));

const VIEW_KEY = "velopulse-velos-vue";
const VIEWS = [
  { value: "liste", label: "Liste" },
  { value: "carte", label: "Carte" },
];

function savedView() {
  try { return localStorage.getItem(VIEW_KEY) === "carte" ? "carte" : "liste"; } catch { return "liste"; }
}

/** Onglet Vélos : les stations en liste ou sur la carte (dernier choix mémorisé sur l'appareil). */
export default function Bikes() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vue") === "carte" || params.get("vue") === "liste" ? params.get("vue") : savedView();
  const choose = (v) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* facultatif */ }
    setParams({ vue: v }, { replace: true });
  };
  return (
    <div className={"bikes-page " + view}>
      <div className="view-switch">
        <Seg label="Affichage" options={VIEWS} value={view} onChange={choose} />
      </div>
      {view === "carte" ? (
        <OnlineOnly>
          <Suspense fallback={<div className="view-state">Chargement de la carte…</div>}><MapPage /></Suspense>
        </OnlineOnly>
      ) : <Stations />}
    </div>
  );
}
