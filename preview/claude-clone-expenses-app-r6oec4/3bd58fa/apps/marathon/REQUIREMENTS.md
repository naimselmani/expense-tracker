# Marathon — requirements

## Concept

Marathon is a chronological movie-watching app modelled after Binge, driven by
a **static actor pool**. The pool is curated in code (`ACTORS` in `app.js`) and
only changes when the owner asks for an update — there is no in-app search.
Every film by every selected actor merges into one deduplicated list, sorted
chronologically **oldest first**, so the whole pool can be watched in release
order.

## Screen

One screen, Binge-style:

- **Actor chip bar** (always visible): one chip per pool actor with photo.
  Tapping a chip solos that actor (a preset filter — e.g. Leonardo DiCaprio →
  all of his movies); tapping the soloed chip again restores all actors.
- **Filters** (collapsible): one switch per actor (with film counts,
  select/clear all), a "released up to" **date cutoff** (year / month / day
  sliders), and show-watched + clear-watched.
- **Toolbar**: sort (oldest first — default — / newest first) and grouping
  (flat Timeline — default —, by Actor, by Year).
- **Progress bar**, **Up next** strip (first unwatched film in chronological
  order, respecting filters), watched checkmarks per film.
- **Film detail** modal: poster, plot, director, runtime, genres, saga
  membership, cast with roles and photos, IMDb / Wikipedia / Wikidata links,
  mark-watched.

## The static pool

- `ACTORS` in `app.js` lists Wikidata QIDs (+ fallback display names).
- Actor names/photos and each filmography (acted, voiced, directed, produced)
  resolve live from Wikidata at first load and are cached in localStorage,
  keyed to `POOL_VERSION` — bumping it (done whenever the pool is edited)
  invalidates the cache. "Refresh data" in the filters re-fetches manually.

## Data

Live, keyless, client-side only: Wikidata SPARQL (filmographies, film facts,
cast) + Wikipedia (posters, plot summaries). No backend; all state in
localStorage. Watched-film state survives pool updates (keyed by film QID).
