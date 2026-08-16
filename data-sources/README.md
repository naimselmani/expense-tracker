# Data sources

Configuration for the daily data-refresh + tiles-build pipeline. Each
file in this directory declares one *type* of upstream data; the
workflows under `.github/workflows/` read them, fetch / process the
listed assets, and publish the result to the live site under
`/cdn/<type>/`.

## Layout

```
data-sources/
  maps-osm.txt        # OSM PBF extracts (Geofabrik) — one region per line
```

Add new files here as new data types are introduced — for example a
future `tide-tables.txt`, `gtfs-feeds.txt`, etc. The workflows can be
extended in lockstep to handle each.

## Pipeline

Two workflows, each looping per region with a per-region
skip-if-unchanged check, so quiet days do nothing and noisy days
process only what actually changed.

```
data-refresh   →   tiles-build
   .pbf            .pmtiles
```

### 1. data-refresh (`.github/workflows/data-refresh.yml`)

Runs at **05:30 UTC daily** and on `workflow_dispatch`. For every
region in `maps-osm.txt`:

1. Fetch the upstream MD5 sidecar from Geofabrik (`<pbf>.md5`, ~10 bytes).
2. Fetch our last-published MD5 from gh-pages.
3. If they match, skip the download.
4. If they differ (or there is no published MD5 yet), download the
   PBF, verify its actual MD5, and write the sidecar.

Publishes only when at least one region changed.

### 2. tiles-build (`.github/workflows/tiles-build.yml`)

Runs **after data-refresh completes** (via `workflow_run`) and on
`workflow_dispatch`. For every region:

1. Read the source PBF MD5 from gh-pages (published by data-refresh).
2. Read the tile sidecar `<pmtiles>.source-md5` from gh-pages.
3. The sidecar holds `<source-md5> <BUILD_VERSION>`. If both match
   the current source + build version, skip the rebuild.
4. Otherwise download the PBF, verify it against the sidecar MD5,
   build PMTiles, and write a fresh sidecar.

Publishes only when at least one region was rebuilt.

`BUILD_VERSION` (set in the workflow env) is the manual override
key — bump it whenever the renderer or style changes meaningfully
to force every region to rebuild on the next run.

## Where it lands

| Artefact                                | URL                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Raw PBF (data-refresh output)           | `https://xhevops-claude.github.io/claude-default/cdn/maps/osm/<slug>.osm.pbf`                    |
| PBF MD5 sidecar                         | `https://xhevops-claude.github.io/claude-default/cdn/maps/osm/<slug>.osm.pbf.md5`                |
| Built PMTiles (tiles-build output)      | `https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/<slug>.pmtiles`                |
| Tile sidecar (source-md5 + build-ver)   | `https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/<slug>.pmtiles.source-md5`     |

The `cdn/` tree on `gh-pages` is intentionally **decoupled from the
app source** — apps fetch from these URLs, never from a path inside
the repo. That keeps app code free of large binaries and lets the
data refresh on its own cadence.

## Adding a new region

1. Add a `<slug> <url>` line to `maps-osm.txt`.
2. Commit. The next scheduled run picks it up; or kick the workflow
   off manually from the Actions tab to fetch immediately.
3. tiles-build will pick up the new region once data-refresh
   publishes its PBF + MD5.

Quiet steady-state cost per region: ~40 bytes of HTTP + zero CI
minutes. A region whose upstream rebuilds: one PBF download + one
tile rebuild for *that region only*; everything else is left
untouched.
