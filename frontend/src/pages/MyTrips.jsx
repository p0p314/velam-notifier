import { useSearchParams } from "react-router-dom";
import PullToRefresh from "../components/PullToRefresh";
import Seg from "../components/Seg";
import MyTrains from "../components/trains/MyTrains";
import { FavoriteStations } from "./Favorites";
import { useStations, useFavorites, useOnline } from "../hooks";
import { useMyTrains } from "../trainHooks";
import { useModules } from "../auth";

const VIEW_KEY = "velopulse-trajets-vue";
const VIEWS = [
  { value: "trains", label: "Trains" },
  { value: "velos", label: "Vélos" },
];

function savedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((o) => o.value === v) ? v : null;
  } catch { return null; }
}

/**
 * Vue affichée : celle de l'URL (?vue=), sinon le dernier choix, sinon une vue utile —
 * les trains si l'utilisateur en suit (ou tant qu'ils chargent), les vélos s'il ne
 * suit que des stations ; hors ligne, les vélos (les trains demandent une connexion).
 */
export function tripsView({ param, saved, online, trainsLoaded, trainCount, stationCount }) {
  if (VIEWS.some((o) => o.value === param)) return param;
  if (saved) return saved;
  if (!online) return "velos";
  if (trainsLoaded && trainCount === 0 && stationCount > 0) return "velos";
  return "trains";
}

/** En-tête de la page ; la bascule n'apparaît que si les deux fonctionnalités sont actives. */
function Head({ view, onChoose }) {
  return (
    <div className="page-head">
      <h1 className="page-title">Mes trajets</h1>
      {onChoose && (
        <div className="trips-switch">
          <Seg options={VIEWS} value={view} onChange={onChoose} label="Afficher" />
        </div>
      )}
    </div>
  );
}

/** Trains seuls (fonctionnalité vélos désactivée) : aucune donnée Vélam chargée. */
function TrainsOnly() {
  const online = useOnline();
  const trains = useMyTrains(true);
  return (
    <PullToRefresh onRefresh={() => (online ? trains.refresh() : null)}>
      <div className="view-pad trips-page">
        <Head />
        {online
          ? <MyTrains t={trains} stations={[]} />
          : <div className="form-hint">Trains indisponibles hors ligne.</div>}
      </div>
    </PullToRefresh>
  );
}

/**
 * Vélos, et trains s'ils sont activés : une seule catégorie à la fois (bascule, choix
 * mémorisé). Les stations favorites restent consultables hors ligne (cache) ; les
 * trains demandent une connexion. Les stations Vélam sont lues une fois et partagées
 * (correspondance Vélam des trains).
 */
function WithBikes({ trainsOn }) {
  const online = useOnline();
  const st = useStations();
  const fav = useFavorites();
  const trains = useMyTrains(trainsOn);
  const [params, setParams] = useSearchParams();

  const view = trainsOn ? tripsView({
    param: params.get("vue"),
    saved: savedView(),
    online,
    trainsLoaded: !trains.loading,
    trainCount: trains.favorites.length,
    stationCount: fav.favorites.length,
  }) : "velos";
  const choose = (v) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* stockage indisponible */ }
    setParams({ vue: v }, { replace: true });
  };

  const refresh = () => (view === "trains"
    ? Promise.all([online ? trains.refresh() : null, st.reload()])
    : Promise.all([st.reload(), fav.reload()]));

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="view-pad trips-page">
        <Head view={view} onChoose={trainsOn ? choose : null} />
        {view === "trains" ? (
          online
            ? <MyTrains t={trains} stations={st.stations} />
            : <div className="form-hint">Trains indisponibles hors ligne.</div>
        ) : (
          <section className="my-trains-section" aria-label="Stations Vélam">
            <FavoriteStations st={st} fav={fav} embedded />
          </section>
        )}
      </div>
    </PullToRefresh>
  );
}

/**
 * « Mes trajets » (accueil) : ce que l'utilisateur suit. Les deux fonctionnalités
 * actives : bascule Trains / Vélos ; une seule : elle seule, sans bascule, et rien
 * n'est chargé pour l'autre.
 */
export default function MyTrips() {
  const modules = useModules();
  return modules.bikes ? <WithBikes trainsOn={modules.trains} /> : <TrainsOnly />;
}
