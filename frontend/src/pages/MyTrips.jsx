import PullToRefresh from "../components/PullToRefresh";
import MyTrains from "../components/trains/MyTrains";
import { FavoriteStations } from "./Favorites";
import { useStations, useFavorites, useOnline } from "../hooks";
import { useMyTrains } from "../trainHooks";

/**
 * « Mes trajets » (accueil) : tout ce que l'utilisateur suit, vélo et train, avec
 * l'état actuel. Les stations favorites restent consultables hors ligne (cache) ;
 * les trains demandent une connexion.
 */
export default function MyTrips() {
  const online = useOnline();
  const st = useStations();
  const fav = useFavorites();
  const trains = useMyTrains();

  return (
    <PullToRefresh onRefresh={() => Promise.all([st.reload(), fav.reload(), online ? trains.refresh() : null])}>
      <div className="view-pad trips-page">
        <div className="page-head">
          <h1 className="page-title">Mes trajets</h1>
        </div>
        {online
          ? <MyTrains t={trains} stations={st.stations} />
          : <div className="form-hint">Trains indisponibles hors ligne.</div>}
        <section className="my-trains-section" aria-label="Stations Vélam">
          <FavoriteStations st={st} fav={fav} embedded />
        </section>
      </div>
    </PullToRefresh>
  );
}
