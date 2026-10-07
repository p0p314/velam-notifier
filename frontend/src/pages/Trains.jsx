import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import PullToRefresh from "../components/PullToRefresh";
import BottomSheet from "../components/BottomSheet";
import TrainSearchForm from "../components/trains/TrainSearchForm";
import TrainFilters from "../components/trains/TrainFilters";
import JourneyCard from "../components/trains/JourneyCard";
import Freshness from "../components/trains/Freshness";
import TrainAlertForm from "../components/trains/TrainAlertForm";
import { useTrainSearch, useMyTrains } from "../trainHooks";
import { useIsMobile } from "../hooks";
import {
  searchFromQuery, queryFromSearch, apiSearchQuery, searchError, searchTitle, fmtDayLong,
  applyFilters, activeFilterCount, DEFAULT_FILTERS,
} from "../lib/trains";

/** Bouton « Suivre cette ligne » d'une recherche par ligne (alerte de ligne). */
function FollowLine({ line }) {
  const { lineAlerts, createAlert } = useMyTrains();
  const [open, setOpen] = useState(false);
  const following = lineAlerts.some((a) => a.line_id === line.id);
  return (
    <>
      <button type="button" className="push-banner-btn ghost" disabled={following} onClick={() => setOpen(true)}>
        <Icon name="bell-plus" size={15} /> {following ? "Ligne suivie" : "Suivre cette ligne"}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} heightVh={80}>
        {open && (
          <TrainAlertForm scope="line" subject={`${line.name}${line.longName ? ` — ${line.longName}` : ""}`}
            onSubmit={async (payload) => { await createAlert({ scope: "line", line: line.id, ...payload }); setOpen(false); }}
            onCancel={() => setOpen(false)} />
        )}
      </BottomSheet>
    </>
  );
}

function Results({ search }) {
  const isMobile = useIsMobile();
  const query = apiSearchQuery(search);
  const { data, loading, error, refresh, refreshing, load } = useTrainSearch(query);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sheet, setSheet] = useState(false);
  useEffect(() => setFilters(DEFAULT_FILTERS), [query]);

  if (loading) return <div className="view-state">Recherche des trains…</div>;
  if (error && !data) {
    return (
      <div className="error-box">
        <div className="error-title">{error}</div>
        <button className="error-retry" onClick={() => load()}>Réessayer</button>
      </div>
    );
  }
  const journeys = data.journeys;
  const shown = applyFilters(journeys, filters);
  const nFilters = activeFilterCount(filters);
  const singleLine = data.lines?.length === 1 ? data.lines[0] : null;
  const filtersPanel = (
    <TrainFilters journeys={journeys} value={filters} onChange={setFilters} count={shown.length} onDone={isMobile ? () => setSheet(false) : null} />
  );

  return (
    <PullToRefresh onRefresh={refresh}>
    <div className="train-results">
      <div className="train-results-head">
        <div>
          <h2 className="page-title train-results-title">{searchTitle(search)}</h2>
          <div className="page-count">{fmtDayLong(data.date)} · {shown.length} train{shown.length !== 1 ? "s" : ""}</div>
        </div>
        {journeys.length > 0 && isMobile && (
          <button className={"filter-btn" + (nFilters ? " active" : "")} aria-label="Filtrer et trier" onClick={() => setSheet(true)}>
            <Icon name="sliders" size={18} />
          </button>
        )}
      </div>
      <Freshness realtime={data.realtime} onRefresh={data.realtime?.applicable ? refresh : null} refreshing={refreshing} />
      {singleLine && <FollowLine line={singleLine} />}
      {data.out_of_coverage && (
        <div className="offline-banner"><Icon name="calendar" size={16} />
          <span>Horaires disponibles du {fmtDayLong(data.coverage.from)} au {fmtDayLong(data.coverage.until)}.</span>
        </div>
      )}
      {data.truncated && <div className="form-hint">Liste limitée aux 300 premiers trains : précisez la recherche.</div>}

      <div className="train-results-body">
        {!isMobile && journeys.length > 0 && <aside className="train-filters-aside">{filtersPanel}</aside>}
        <div className="train-list">
          {journeys.length === 0 ? (
            <div className="empty-state">
              <Icon name="train" size={40} />
              <div className="empty-title">Aucun train ce jour-là</div>
              <div className="empty-sub">Aucun trajet direct ne correspond à cette recherche.</div>
            </div>
          ) : shown.length === 0 ? (
            <div className="view-state">Aucun train ne correspond aux filtres.</div>
          ) : (
            shown.map((j) => <JourneyCard key={j.id} j={j} />)
          )}
        </div>
      </div>
      {isMobile && <BottomSheet open={sheet} onClose={() => setSheet(false)} heightVh={85}>{filtersPanel}</BottomSheet>}
    </div>
    </PullToRefresh>
  );
}

/** Onglet Trains : recherche (trajet, gare, ligne) + filtres + liste. Les trains suivis sont dans « Mes trajets ». */
export default function Trains() {
  const [params, setParams] = useSearchParams();
  const search = searchFromQuery(params);
  const ready = !searchError(search);
  const onSearch = (s) => setParams(queryFromSearch(s));
  // Ancien onglet « Mes trains » (liens et notifications d'avant la v1.7).
  if (params.get("onglet") === "mes-trains") return <Navigate to="/trajets" replace />;

  return (
    <div className="view-pad trains-page">
      <div className="page-head">
        <h1 className="page-title">Trains</h1>
      </div>
      <div className="trains-layout">
          <TrainSearchForm key={params.toString()} initial={search} onSearch={onSearch} />
          {ready ? <Results search={search} /> : (
            <div className="empty-state">
              <Icon name="train" size={40} />
              <div className="empty-title">Cherchez un train</div>
              <div className="empty-sub">Par trajet (Lille Flandres → Amiens), par gare, ou par ligne (K44). Les horaires sont ceux du jour choisi, avec les retards en temps réel.</div>
            </div>
          )}
      </div>
    </div>
  );
}
