# expense-tracker

[![CI](https://github.com/naimselmani/expense-tracker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/naimselmani/expense-tracker/actions/workflows/ci.yml)
[![Deploy](https://github.com/naimselmani/expense-tracker/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/naimselmani/expense-tracker/actions/workflows/pages.yml)
[![Live](https://img.shields.io/badge/live-arcade-22d3ee?style=flat&labelColor=18181b)](https://naimselmani.github.io/expense-tracker/)

A small static games arcade. Tap a tile, the card morphs into the game; tap home, the game morphs back into the card. Deployed to GitHub Pages.

**Live**: https://naimselmani.github.io/expense-tracker/

Imported from [xhevops-claude/claude-default](https://github.com/xhevops-claude/claude-default)
(upstream `main` @ `0551aa9`). See [Differences from upstream](#differences-from-upstream).

## Layout

```
.
├── index.html              Gallery (home page)
├── styles.css              Gallery layout + iframe morph
├── app.js                  Gallery logic — tile rendering, open/close animation
├── theme.js                Theme picker (gallery only)
├── themes.css              Theme variables (gallery only)
└── games/
    ├── snake/              Self-contained game
    │   ├── index.html
    │   ├── styles.css
    │   └── app.js
    └── tic-tac-toe/
        ├── index.html
        ├── styles.css
        └── app.js
```

Each game is fully self-contained: it links no shared CSS or JS and ships its own black palette. The gallery embeds it via an `<iframe>`. The theme picker on the home page only affects the home page.

## Adding a new game

1. Create `games/<slug>/` with its own `index.html`, `styles.css`, `app.js`.
2. Append an entry to the `games` array in `app.js`:
   ```js
   {
     slug: 'pong',
     name: 'Pong',
     tagline: 'Classic two-paddle volley.',
     icon: '🏓',
     url: 'games/pong/',
   }
   ```
3. (Optional) Mark it `comingSoon: true` and omit `url` to render the tile as a non-clickable "Coming soon" card.

The tile gets its colors from the active theme's accents (rotated per `nth-child`) — no per-game color config needed.

## Game loading screen

Each game's `index.html` includes a critical inline `<style>` block plus a `#game-loading` element so a black + logo + sliding bar paints on the very first frame, before any external stylesheet loads. The game's `app.js` removes it once the game is ready and at least 3 seconds have elapsed.

## Open / close animation

The iframe is wrapped in `#frame-wrap`. On open, the wrap is positioned at the tapped tile's bounding rect with `transform: translate(...) scale(...)` and `border-radius: 16px`, then transitioned to fullscreen. A `.frame-skin` layer carries the tile's gradient + icon + name + tagline so the wrap visually reads as the card at the small end. The skin and iframe crossfade in 220ms — faster than the wrap's 550ms size animation — so the user sees the card design morph into the game smoothly. Close runs the same animation in reverse.

## Local development

```sh
npm install
npm run dev      # http://localhost:8080
```

## Linting

CI runs on every PR to `main` and every push to a non-`main` branch (`.github/workflows/ci.yml`):

- JS syntax check via `node --check` for every `.js` file
- HTML linting via [`htmlhint`](https://htmlhint.com/) using `.htmlhintrc`
- CSS linting via [`stylelint`](https://stylelint.io/) using `.stylelintrc.json`

Run them locally:

```sh
npm run lint            # all of the below
npm run lint:html
npm run lint:css
```

## Deployment

`.github/workflows/pages.yml` deploys every push:

| Branch | Path on Pages | URL |
|---|---|---|
| `main` | `/` (root) | `https://naimselmani.github.io/expense-tracker/` |
| any other | `/preview/<slug>/` | `https://naimselmani.github.io/expense-tracker/preview/<slug>/` |

`<slug>` is the branch name lowercased with `/`, `_`, and spaces turned into `-`. So pushing `claude/foo-bar` deploys to `…/preview/claude-foo-bar/`.

The workflow uses [`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) to publish to the `gh-pages` branch with `keep_files: true`, so production and previews coexist without overwriting each other.

### One-time setup

GitHub Pages must be configured to serve from the `gh-pages` branch. Go to **Settings → Pages → Build and deployment**:

- **Source**: *Deploy from a branch*
- **Branch**: `gh-pages` / `(root)`

The first push after this PR merges will create the `gh-pages` branch automatically.

### Cleaning up old previews

Preview folders accumulate on `gh-pages` over time. To remove a stale preview, just delete the folder on the `gh-pages` branch (e.g. via the GitHub web UI) and the URL stops resolving on the next deploy.

## Differences from upstream

This repo is a snapshot of `xhevops-claude/claude-default` @ `0551aa9` with two changes:

1. **The three scheduled data workflows were not imported** — `data-refresh.yml`
   (daily OSM extract download), `tiles-build.yml` (planetiler PMTiles build), and
   `youtube-refresh.yml` (daily yt-dlp channel scrape, needs a `YT_API_KEY` secret).
   They publish large assets to `gh-pages` under `/cdn/` and would burn Actions
   minutes here for no benefit. `data-sources/` and `.github/scripts/` are still
   present, so restoring any of them is just adding the workflow file back.
2. **Docs and the deploy-URL notice point at this repo**; the apps do not. Locator,
   Binge and Usage fetch their data from absolute upstream URLs
   (`xhevops-claude.github.io/claude-default/cdn/…` and a public gist), which is
   deliberate — that is where the data actually lives, and repointing them at this
   origin would 404 while the workflows above are disabled.

## Themes

`themes.css` defines variables per `[data-theme="..."]`:
- `dark` (default), `light`, `space`, `sunset`
- `mono`, `solarized`, `gameboy` (classic, gradient-free)

`theme.js` reads `localStorage.getItem('arcade-theme')` and wires the swatch buttons. The choice persists. Games never read this — they're standalone black.
