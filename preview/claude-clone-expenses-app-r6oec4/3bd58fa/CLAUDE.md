# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

Talk to the user like a person, not a report. Keep replies short and conversational — a couple of sentences, not multi-paragraph write-ups. Lead with the answer or what changed; skip exhaustive bullet lists, feature recaps, and restating things they already know. Add detail only when asked.

## Commands

```sh
npm install
npm run dev            # http://localhost:8080  (npx serve@14)
npm run lint           # lint:html + lint:css
npm run lint:html      # htmlhint with .htmlhintrc
npm run lint:css       # stylelint with .stylelintrc.json
```

There is no test runner. CI (`.github/workflows/ci.yml`) additionally runs `node --check` against every `*.js` file outside `node_modules`; reproduce it locally with:

```sh
shopt -s globstar nullglob; for f in **/*.js; do [[ "$f" == node_modules/* ]] || node --check "$f"; done
```

CI runs on pull requests to `main` and on every push to a non-`main` branch.

## Architecture

### Static, no build step

The site is plain HTML/CSS/JS served as files. There is no bundler, no framework, no transpile step — `npm run dev` just statically serves the repo root. Anything that works in a modern browser works in production.

### Shell vs. embedded experiences

The repo is a "shell" home page (`index.html`, `styles.css`, `app.js`, `theme.js`, `themes.css`) that hosts independent sub-experiences in `games/<slug>/` and `apps/<slug>/`. Each sub-experience is fully self-contained: its own `index.html`, `styles.css`, `app.js`, no shared imports. The shell embeds them via `<iframe>`. That isolation is load-bearing — do not try to pull a sub-experience's JS/CSS into the shell or vice versa.

### Tile registry → grid → iframe morph

`app.js` declares two arrays at the top: `games` and `apps`. Each entry needs `{ slug, name, meta, tagline, icon, url }` (or `comingSoon: true` and no `url`). The arrays drive the rendered grid tiles, the iframe loader, and deep-link resolution. Adding a tile = create `games/<slug>/` (or `apps/<slug>/`) and append one entry to the relevant array.

When a tile is tapped, `openGame` positions `#frame-wrap` over the tapped card's bounding rect with `transform: translate(...) scale(...)`, then transitions to fullscreen. A `.frame-skin` layer paints the card art on top of the loading iframe and crossfades out — `ZOOM_MS` (550ms) is the wrap's size animation, and the skin/frame crossfade is intentionally faster (220ms in CSS) so the morph reads as the card *becoming* the experience. `closeGame` runs the same animation in reverse. If you change the timing in CSS, mirror it in `ZOOM_MS`.

### Section pager (Home / Apps / Tools / Games)

The IIFE labelled `pager()` in `app.js` is a transform-driven barrel carousel — there is no scroll container and no DOM clones. `pos` is a continuous float; `paint()` places each slide at its visually-nearest copy via `((d % N) + N) % N`. After settle, `pos` is renormalised back into `[0, N)` to stay bounded. Touch uses Pointer Events with axis detection (`DIR_LOCK_PX = 8`) so vertical pans inside a grid still scroll natively. A swipe that ends over a card sets `suppressClickUntil` to swallow the click that would otherwise open the game — preserve this when changing gesture handling.

### Deep linking and embedded close

- The shell pushes `#games/<slug>/` (or `#apps/<slug>/`) to history on open and listens for `popstate` to close. The deep-link IIFE at the bottom of `app.js` opens the matching tile if the page loads with such a hash.
- Embedded experiences must NOT navigate the parent. Their "Quit" button posts `{ type: 'close-game' }` to `window.parent`; the shell's `message` handler triggers `history.back()` (or `closeGame()` directly). When standalone (`window.self === window.top`), the same button does `location.href = '../../'`. Both games already implement this — copy the pattern.
- Each sub-experience adds `embedded` to `<html>` when iframed: `if (window.self !== window.top) document.documentElement.classList.add('embedded');`. CSS uses `.embedded` to hide elements that don't belong inside the shell (e.g. back links).

### Loading screens (mandatory pattern)

Every sub-experience's `index.html` ships a `#game-loading` (or `#app-loading`) element painted by an inline `<style>` block in `<head>`, BEFORE any external `<link rel="stylesheet">`. This guarantees a black/branded splash on the very first frame, before `styles.css` resolves. The sub-experience's `app.js` removes it once ready AND at least 3 seconds have elapsed. Don't move this CSS to `styles.css` — the whole point is that it paints before that file loads.

### Theme system

`themes.css` defines five palettes via `[data-theme="..."]` selectors: `noir`, `bone`, `steel`, `jade`, `ember`. (The README lists older names like `dark`/`light`/`space` — those are stale; use the actual five.) `theme.js` reads `localStorage.getItem('arcade-theme')`, falls back to `prefers-color-scheme`, applies `document.documentElement.dataset.theme`, and dispatches a `themechange` CustomEvent. The shell's `index.html` runs an inlined boot script BEFORE `themes.css` loads to set the attribute pre-paint and avoid a flash. Sub-experiences are NOT themed — they ship their own palette. If you add a theme, update both `themes.css` and the `THEMES` array in `theme.js` and the `valid` array in `index.html`'s boot script.

## Deployment

`.github/workflows/pages.yml` deploys every push using `peaceiris/actions-gh-pages` with `keep_files: true`:

| Branch | Path |
|---|---|
| `main` | `/` |
| any other | `/preview/<slug>/<short-sha>/` where `<slug>` = branch name with `/`, `_`, ` ` → `-` and lowercased, and `<short-sha>` = the 7-char commit SHA |

So pushing commit `abc1234` to e.g. `claude/foo-bar` deploys to `https://naimselmani.github.io/expense-tracker/preview/claude-foo-bar/abc1234/`. Production and previews coexist on `gh-pages` because of `keep_files: true`.

Each push gets its own immutable, SHA-keyed preview URL, so the browser never serves a cached copy of a stale build. A "Prune this branch's previous preview" step deletes the branch's *old* `preview/<slug>/` directory (operating on `gh-pages` via a worktree) before the new SHA dir is published — old preview deleted, new one added. Production (`main` → `/`) and other branches' previews are never touched. Because the preview URL changes every push, you can't bookmark a stable per-branch preview link; grab the latest from the deploy notice / the reply's final line.

The `exclude_assets` list in `pages.yml` controls what gets excluded from the deploy. If you add a new top-level dev-only file/dir (lockfiles, configs, docs), append it there.

### Asset cache-busting

Source HTML references local `.js`/`.css` with bare relative paths (`<script src="app.js">`, `<link rel="stylesheet" href="styles.css">`) — no `?v=` query strings in the repo. The "Cache-bust local assets" step in `pages.yml` rewrites every relative `.js`/`.css` ref to append `?v=<short-sha>` before the deploy lands on `gh-pages`. This applies to both production and preview deploys.

Don't add `?v=` query strings manually to source HTML — they'd be redundant with the deploy-time rewrite and would also break the `htmlhint` lint rule. CDN-pinned URLs (`https://unpkg.com/foo@1.2.3/...`) already have version tokens in the path and aren't touched by the rewrite. If you introduce a new local asset type (say, a `.wasm` or a `.json` config that has to bypass cache), extend the `sed` alternation in `pages.yml` accordingly.

### Verify the deploy is actually served before sharing any link

The `Deploy` workflow going green only means files landed on the `gh-pages` **branch**. GitHub then runs its own `pages-build-deployment` workflow (1–2 min more) to publish that branch to the CDN — and because each push writes two `gh-pages` commits (preview prune + publish), the first Pages build is usually cancelled and restarted. A link shared before that finishes 404s.

So before posting a preview/production link: poll the `pages-build-deployment` workflow (look up its id for this repo via the GitHub MCP actions tools) until the latest run is `completed`/`success` **and** its `head_sha` equals the current `gh-pages` tip (`git fetch origin gh-pages && git rev-parse FETCH_HEAD`), and confirm the tip tree contains the path you're linking (`git ls-tree FETCH_HEAD:<path>`). Only then share the link.

### Always end with a clickable preview link

After pushing changes, the final line of every reply must be a clickable Markdown link to the deployed preview, in the form `[Preview](https://naimselmani.github.io/expense-tracker/preview/<slug>/<short-sha>/...)`, where `<short-sha>` is the 7-char SHA of the commit you just pushed (`git rev-parse --short=7 HEAD`). No bold, no surrounding `**`, no extra prose on that line — just the link. If the change targets a specific sub-experience, deep-link directly into it (e.g. `.../preview/<slug>/<short-sha>/apps/locator/`). If pushed to `main`, link to the corresponding production path under `https://naimselmani.github.io/expense-tracker/`.

### Branch names — match the work

Branch names should describe what's on the branch. Use the pattern `claude/<short-kebab-descriptor>` (lowercase, dashes, no random suffixes), e.g. `claude/terrain-app`, `claude/locator-cluster-fix`, `claude/cdn-pipeline-retry`. If the work pivots mid-branch (you started on X and ended up shipping Y), rename the branch before opening the PR so the name still tells the truth.

Auto-generated names like `claude/add-claude-documentation-0XFkn` get reused across unrelated work and end up meaning nothing. Don't keep them — rename on first push (`git branch -m`) or, if a PR is already open with a stale name, mention it to the user and offer to migrate.

### Merging to main — always via a PR with green CI

Direct pushes to `main` are blocked. To land changes on production:

1. Open a pull request from the feature branch into `main`.
2. Wait for CI on the PR to go green — the `lint` and `node --check` jobs in `.github/workflows/ci.yml` plus the preview deploy in `pages.yml`. Inspect any failures and fix them before merging; do not merge a PR with a red or pending check unless the user explicitly tells you to override.
3. Only then merge the PR (default to a normal merge commit so the feature-branch history stays inspectable; squash if the user asks).

This applies even when the user just says "merge it" — the PR + green-checks loop is the merge mechanism, not an extra step.

## Data pipeline (cdn/)

**The scheduled data workflows are NOT enabled in this repo.** `data-refresh.yml`,
`tiles-build.yml` and `youtube-refresh.yml` were deliberately left out when this repo
was imported from `xhevops-claude/claude-default` — they publish large assets to
`gh-pages` under `/cdn/` and would burn Actions minutes here for no benefit.

Consequently there is no `/cdn/` on this origin. Locator, Binge and Usage fetch their
data from **absolute upstream URLs** (`https://xhevops-claude.github.io/claude-default/cdn/…`
and a public gist) and keep working that way. Do **not** "fix" those URLs to point at
this origin — they would 404.

`data-sources/` and `.github/scripts/` are still present, so re-enabling any of the
three is just restoring its workflow file from upstream (and adding a `YT_API_KEY`
secret for the YouTube one). If you do, note they share a `concurrency: pages-deploy`
group with `pages.yml` to serialize `gh-pages` writes, and `.gitignore` excludes `cdn/`.

## Expenses ledger (apps/expenses/)

The Expenses app is a read-only construction-cost ledger whose writes happen through Claude Code sessions. Source of truth is committed per-expense files, aggregated at deploy time:

- `apps/expenses/data/meta.json` — `baseCurrency`, `fixedRates` (MKD pegged at 61.5 per EUR).
- `apps/expenses/data/projects.json` — project registry (`id` slug, `name`, `icon`); the app shows one project at a time via the header picker.
- `apps/expenses/data/categories.json` — category registry, **shared across projects**; each category declares its own `fields`, so new expense types need data changes only.
- `apps/expenses/data/expenses/<project-id>/<yyyy>/<mm>/<id>.json` — one expense per file; the top folder is the project (must match a `projects.json` id), the date folders derive from the expense's ISO UTC `date`. Filename must equal the expense `id` (a GUID). When adding an expense, ask which project it belongs to if it isn't obvious.
- `apps/expenses/files/<guid>.<ext>` — attachment originals; metadata keeps `originalName` (used as label and download name) and `size` (must match the file on disk).
- `apps/expenses/data/expenses.json` is **generated** by `scripts/build-expenses-data.mjs` (run automatically by `pages.yml` on deploy and by `npm run dev` via `predev`). It is gitignored — never edit or commit it. CI runs the script with `--check` to block malformed data.

Adding an expense from an uploaded document: store the file under a GUID in `files/`, transcribe **all readable text verbatim** (original script — e.g. Macedonian Cyrillic) into the attachment's `extractedText` field for future content search, compute the file's `sha256` (`sha256sum <file>`) into the attachment metadata, write the per-expense JSON, then land it on `main` via the normal PR + green CI flow. The user confirms extracted details before anything is committed.

### Duplicate check (mandatory before writing any expense)

Do this with `grep` only — never read expense files in bulk; the check must cost the same at 10,000 expenses as at 20:

1. **Exact re-upload:** `grep -rl "<sha256-of-new-file>" apps/expenses/data/expenses/` — a hit means this exact document is already attached to an expense.
2. **Same invoice, different photo:** `grep -rl '"amount": <amount>' apps/expenses/data/expenses/<project-id>/<yyyy>/` then narrow the (few) hits by currency/date/vendor, and compare invoice/reference numbers against the new document's text. (The `sha256` check stays global across projects; the semantic check is per project, matching the validator.)

### On detection: always prompt, and batch the prompts

A suspected duplicate is never resolved in prose or by guessing — put an explicit choice in front of the user with the AskUserQuestion tool:

- **Single bill:** show the matching existing expense (vendor, date, amount, its attached file) next to the new bill's extracted details, and ask with options like **Skip — already recorded** / **Add as intentional duplicate**. Do not write anything for that bill until one of those is picked.
- **Batch upload (several bills at once):** extract and duplicate-check *all* files first, then raise all suspects together in one prompt round — one question per suspected bill, each self-contained (new bill vs. matching expense) so it can be answered without scrolling back. AskUserQuestion takes up to 4 questions per call; chunk into consecutive calls if there are more. Clean bills are written without prompting; skipped bills are dropped entirely.

Only a bill the user explicitly confirmed gets `"allowDuplicate": true`. The build script remains the backstop: CI fails on duplicate `sha256` or duplicate date+amount+currency+vendor without that flag, so an unconfirmed duplicate cannot merge either way.

## Conventions worth preserving

- `escapeHTML` in `app.js` is used for any user-supplied or registry-supplied string interpolated into innerHTML. Anything that ends up in `cardHtml`/`cardInner` MUST go through it.
- Prefer adding `comingSoon: true` (with no `url`) over removing entries — the shell renders these as locked tiles with a shake animation on tap.
- Tile colors come from CSS variables `--tile-<slug>` defined in `themes.css` — these are constant across themes so each card keeps its identity. Add a `--tile-<newslug>` when adding a tile.
- Don't introduce a build tool, package, or framework just to add one feature. The "no build step" property is what makes preview deploys, deep links, and the static CDN model work.
