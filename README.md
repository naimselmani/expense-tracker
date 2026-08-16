# expense-tracker

[![CI](https://github.com/naimselmani/expense-tracker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/naimselmani/expense-tracker/actions/workflows/ci.yml)
[![Deploy](https://github.com/naimselmani/expense-tracker/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/naimselmani/expense-tracker/actions/workflows/pages.yml)
[![Live](https://img.shields.io/badge/live-ledger-1ec97e?style=flat&labelColor=18181b)](https://naimselmani.github.io/expense-tracker/)

A construction-cost ledger. Static page, no build step, deployed to GitHub Pages.
The browser side is **read-only** — every expense is written by a Claude Code session
that commits per-expense files and opens a PR.

**Live**: https://naimselmani.github.io/expense-tracker/

> ⚠️ This repo is public and Pages serves it publicly. Amounts, vendor names and
> scanned receipts are readable by anyone with the URL.

## Layout

```
.
├── index.html          The app (inline splash CSS must stay in <head>)
├── styles.css
├── app.js
├── data/
│   ├── meta.json           Base currency + fixed rates (MKD pegged at 61.5/EUR)
│   ├── projects.json       Project registry — the header picker
│   ├── categories.json     Category registry, shared across projects
│   ├── expenses/<project>/<yyyy>/<mm>/<id>.json    One expense per file
│   └── expenses.json       GENERATED at deploy time — gitignored, never commit
├── files/<guid>.<ext>  Attachment originals (receipt photos)
└── scripts/
    └── build-expenses-data.mjs   Aggregates + validates the ledger
```

Adding an expense is a data change, not a code change: drop the receipt in `files/`
under a GUID, write one JSON under `data/expenses/…`, and the aggregate is rebuilt at
deploy. `CLAUDE.md` documents the full authoring flow, including the mandatory
duplicate check.

## Local development

```sh
npm install
npm run dev      # http://localhost:8080  (predev regenerates data/expenses.json)
```

## Linting and validation

CI runs on every PR to `main` and every push to a non-`main` branch
(`.github/workflows/ci.yml`):

- JS syntax check via `node --check` for every `.js` file
- Ledger validation via `node scripts/build-expenses-data.mjs --check` — rejects
  malformed expenses, unknown categories/projects, attachment size mismatches, and
  duplicate `sha256` or date+amount+currency+vendor without `"allowDuplicate": true`
- HTML linting via [`htmlhint`](https://htmlhint.com/) using `.htmlhintrc`
- CSS linting via [`stylelint`](https://stylelint.io/) using `.stylelintrc.json`

Run them locally:

```sh
npm run lint            # html + css
npm run build:data      # same validation as CI, and writes the aggregate
```

## Deployment

`.github/workflows/pages.yml` deploys every push:

| Branch | Path on Pages | URL |
|---|---|---|
| `main` | `/` (root) | `https://naimselmani.github.io/expense-tracker/` |
| any other | `/preview/<slug>/<short-sha>/` | `https://naimselmani.github.io/expense-tracker/preview/<slug>/<short-sha>/` |

`<slug>` is the branch name lowercased with `/`, `_`, and spaces turned into `-`.
Each push gets its own immutable, SHA-keyed preview URL; the branch's previous preview
is pruned on the next deploy. Production and previews coexist on `gh-pages` thanks to
`keep_files: true`.

### One-time setup

GitHub Pages must be configured to serve from the `gh-pages` branch. Go to
**Settings → Pages → Build and deployment**:

- **Source**: *Deploy from a branch*
- **Branch**: `gh-pages` / `(root)`

Until this is set, every Pages URL 404s even when the Deploy workflow is green.

## Origin

Adapted from [xhevops-claude/claude-default](https://github.com/xhevops-claude/claude-default)
(upstream `main` @ `0551aa9`), where this app lived at `apps/expenses/` inside a
multi-app "arcade" shell. Only the ledger was kept; the shell, the games and the other
apps were dropped and the app was lifted to the repo root.

Upstream's three scheduled data workflows — `data-refresh.yml`, `tiles-build.yml` and
`youtube-refresh.yml` — were never imported. They served the map and video apps that no
longer exist here.
