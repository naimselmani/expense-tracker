# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

Talk to the user like a person, not a report. Keep replies short and conversational — a couple of sentences, not multi-paragraph write-ups. Lead with the answer or what changed; skip exhaustive bullet lists, feature recaps, and restating things they already know. Add detail only when asked.

## Commands

```sh
npm install
npm run dev            # http://localhost:8080  (npx serve@14; predev runs build:data)
npm run build:data     # regenerate data/expenses.json from data/expenses/**
npm run lint           # lint:html + lint:css
npm run lint:html      # htmlhint with .htmlhintrc
npm run lint:css       # stylelint with .stylelintrc.json
```

There is no test runner. CI (`.github/workflows/ci.yml`) additionally runs `node --check` against every `*.js` file outside `node_modules`, and validates the ledger with `node scripts/build-expenses-data.mjs --check`. Reproduce the JS check locally with:

```sh
shopt -s globstar nullglob; for f in **/*.js; do [[ "$f" == node_modules/* ]] || node --check "$f"; done
```

CI runs on pull requests to `main` and on every push to a non-`main` branch.

## Architecture

### One app, at the repo root, no build step

This repo is a single static page — the Expenses ledger — served straight from the
repo root. `index.html`, `styles.css` and `app.js` at the top level *are* the app;
there is no bundler, no framework, no transpile step. `npm run dev` statically serves
the repo root. Anything that works in a modern browser works in production.

The app is read-only in the browser. Every write happens through a Claude Code session
that edits the per-expense files and pushes — see the Expenses ledger chapter below.

> This repo was imported from `xhevops-claude/claude-default`, where the ledger lived
> at `apps/expenses/` inside an "arcade" shell that embedded it in an iframe. The shell,
> the games and the other apps were dropped; the ledger was lifted to the root. If you
> find a stray reference to `apps/expenses/`, a tile registry, a theme picker or a
> `/cdn/` data pipeline, it is a leftover — delete it.

### Loading screen (mandatory pattern)

`index.html` ships an `#app-loading` element painted by an inline `<style>` block in
`<head>`, BEFORE the external `<link rel="stylesheet">`. This guarantees a branded
splash on the very first frame, before `styles.css` resolves. `app.js` removes it once
the data is ready AND at least 3 seconds have elapsed (`MIN_SPLASH_MS`). Don't move
this CSS into `styles.css` — the whole point is that it paints before that file loads.

## Deployment

`.github/workflows/pages.yml` deploys every push using `peaceiris/actions-gh-pages` with `keep_files: true`:

| Branch | Path |
|---|---|
| `main` | `/` |
| any other | `/preview/<slug>/<short-sha>/` where `<slug>` = branch name with `/`, `_`, ` ` → `-` and lowercased, and `<short-sha>` = the 7-char commit SHA |

So pushing commit `abc1234` to e.g. `claude/foo-bar` deploys to `https://naimselmani.github.io/expense-tracker/preview/claude-foo-bar/abc1234/`. Production and previews coexist on `gh-pages` because of `keep_files: true`.

Each push gets its own immutable, SHA-keyed preview URL, so the browser never serves a cached copy of a stale build. A "Prune this branch's previous preview" step deletes the branch's *old* `preview/<slug>/` directory (operating on `gh-pages` via a worktree) before the new SHA dir is published — old preview deleted, new one added. Production (`main` → `/`) and other branches' previews are never touched. Because the preview URL changes every push, you can't bookmark a stable per-branch preview link; grab the latest from the deploy notice / the reply's final line.

The `exclude_assets` list in `pages.yml` controls what gets excluded from the deploy. If you add a new top-level dev-only file/dir (lockfiles, configs, docs), append it there.

**One-time setup:** GitHub Pages must be configured to serve from the `gh-pages` branch — Settings → Pages → Build and deployment → Source *Deploy from a branch*, Branch `gh-pages` / `(root)`. Until that is set, every Pages URL 404s even when the Deploy workflow is green.

### Asset cache-busting

Source HTML references local `.js`/`.css` with bare relative paths (`<script src="app.js">`, `<link rel="stylesheet" href="styles.css">`) — no `?v=` query strings in the repo. The "Cache-bust local assets" step in `pages.yml` rewrites every relative `.js`/`.css` ref to append `?v=<short-sha>` before the deploy lands on `gh-pages`. This applies to both production and preview deploys.

Don't add `?v=` query strings manually to source HTML — they'd be redundant with the deploy-time rewrite and would also break the `htmlhint` lint rule. CDN-pinned URLs (`https://unpkg.com/foo@1.2.3/...`) already have version tokens in the path and aren't touched by the rewrite. If you introduce a new local asset type (say, a `.wasm` or a `.json` config that has to bypass cache), extend the `sed` alternation in `pages.yml` accordingly.

### Verify the deploy is actually served before sharing any link

The `Deploy` workflow going green only means files landed on the `gh-pages` **branch**. GitHub then runs its own `pages-build-deployment` workflow (1–2 min more) to publish that branch to the CDN — and because each push writes two `gh-pages` commits (preview prune + publish), the first Pages build is usually cancelled and restarted. A link shared before that finishes 404s.

So before posting a preview/production link: poll the `pages-build-deployment` workflow (look up its id for this repo via the GitHub MCP actions tools) until the latest run is `completed`/`success` **and** its `head_sha` equals the current `gh-pages` tip (`git fetch origin gh-pages && git rev-parse FETCH_HEAD`), and confirm the tip tree contains the path you're linking (`git ls-tree FETCH_HEAD:<path>`). Only then share the link.

### Always end with a clickable preview link

After pushing changes, the final line of every reply must be a clickable Markdown link to the deployed preview, in the form `[Preview](https://naimselmani.github.io/expense-tracker/preview/<slug>/<short-sha>/)`, where `<short-sha>` is the 7-char SHA of the commit you just pushed (`git rev-parse --short=7 HEAD`). No bold, no surrounding `**`, no extra prose on that line — just the link. If pushed to `main`, link to `https://naimselmani.github.io/expense-tracker/`.

### Branch names — match the work

Branch names should describe what's on the branch. Use the pattern `claude/<short-kebab-descriptor>` (lowercase, dashes, no random suffixes), e.g. `claude/expense-search-fix`, `claude/add-july-invoices`, `claude/category-registry-cleanup`. If the work pivots mid-branch (you started on X and ended up shipping Y), rename the branch before opening the PR so the name still tells the truth.

Auto-generated names like `claude/add-claude-documentation-0XFkn` get reused across unrelated work and end up meaning nothing. Don't keep them — rename on first push (`git branch -m`) or, if a PR is already open with a stale name, mention it to the user and offer to migrate.

### Merging to main — always via a PR with green CI

Direct pushes to `main` are blocked. To land changes on production:

1. Open a pull request from the feature branch into `main`.
2. Wait for CI on the PR to go green — the `lint` and `node --check` jobs in `.github/workflows/ci.yml` plus the preview deploy in `pages.yml`. Inspect any failures and fix them before merging; do not merge a PR with a red or pending check unless the user explicitly tells you to override.
3. Only then merge the PR (default to a normal merge commit so the feature-branch history stays inspectable; squash if the user asks).

This applies even when the user just says "merge it" — the PR + green-checks loop is the merge mechanism, not an extra step.

## Expenses ledger

The Expenses app is a read-only construction-cost ledger whose writes happen through Claude Code sessions. Source of truth is committed per-expense files, aggregated at deploy time:

- `data/meta.json` — `baseCurrency`, `fixedRates` (MKD pegged at 61.5 per EUR).
- `data/projects.json` — project registry (`id` slug, `name`, `icon`); the app shows one project at a time via the header picker.
- `data/categories.json` — category registry, **shared across projects**; each category declares its own `fields`, so new expense types need data changes only.
- `data/expenses/<project-id>/<yyyy>/<mm>/<id>.json` — one expense per file; the top folder is the project (must match a `projects.json` id), the date folders derive from the expense's ISO UTC `date`. Filename must equal the expense `id` (a GUID). When adding an expense, ask which project it belongs to if it isn't obvious.
- `files/<guid>.<ext>` — attachment originals; metadata keeps `originalName` (used as label and download name) and `size` (must match the file on disk).
- `data/expenses.json` is **generated** by `scripts/build-expenses-data.mjs` (run automatically by `pages.yml` on deploy and by `npm run dev` via `predev`). It is gitignored — never edit or commit it. CI runs the script with `--check` to block malformed data.

Adding an expense from an uploaded document: store the file under a GUID in `files/`, transcribe **all readable text verbatim** (original script — e.g. Macedonian Cyrillic) into the attachment's `extractedText` field for future content search, compute the file's `sha256` (`sha256sum <file>`) into the attachment metadata, write the per-expense JSON, then land it on `main` via the normal PR + green CI flow. The user confirms extracted details before anything is committed.

**This repo is public and GitHub Pages serves it publicly.** Every invoice added here — amounts, vendor names, scanned receipt images — is world-readable to anyone with the URL. The `noindex` meta tag stops search engines, not people. Flag this to the user if they upload anything they may not want public.

### Duplicate check (mandatory before writing any expense)

Do this with `grep` only — never read expense files in bulk; the check must cost the same at 10,000 expenses as at 20:

1. **Exact re-upload:** `grep -rl "<sha256-of-new-file>" data/expenses/` — a hit means this exact document is already attached to an expense.
2. **Same invoice, different photo:** `grep -rl '"amount": <amount>' data/expenses/<project-id>/<yyyy>/` then narrow the (few) hits by currency/date/vendor, and compare invoice/reference numbers against the new document's text. (The `sha256` check stays global across projects; the semantic check is per project, matching the validator.)

### On detection: always prompt, and batch the prompts

A suspected duplicate is never resolved in prose or by guessing — put an explicit choice in front of the user with the AskUserQuestion tool:

- **Single bill:** show the matching existing expense (vendor, date, amount, its attached file) next to the new bill's extracted details, and ask with options like **Skip — already recorded** / **Add as intentional duplicate**. Do not write anything for that bill until one of those is picked.
- **Batch upload (several bills at once):** extract and duplicate-check *all* files first, then raise all suspects together in one prompt round — one question per suspected bill, each self-contained (new bill vs. matching expense) so it can be answered without scrolling back. AskUserQuestion takes up to 4 questions per call; chunk into consecutive calls if there are more. Clean bills are written without prompting; skipped bills are dropped entirely.

Only a bill the user explicitly confirmed gets `"allowDuplicate": true`. The build script remains the backstop: CI fails on duplicate `sha256` or duplicate date+amount+currency+vendor without that flag, so an unconfirmed duplicate cannot merge either way.

## Conventions worth preserving

- `escapeHTML` in `app.js` is used for any user-supplied or data-supplied string interpolated into innerHTML. Vendor names, descriptions, `details` keys and values, category labels, filenames and `extractedText` all come from the ledger data and MUST go through it.
- Keep every path in the app relative (`data/expenses.json`, `styles.css`, `files/<guid>.jpeg`). That's what lets the identical tree serve correctly from both `/` and `/preview/<slug>/<sha>/`.
- Attachment paths are stored inside each expense JSON as `files/<guid>.<ext>`. The GUID filename is the stored name; `originalName` is only a label and a download filename.
- Don't introduce a build tool, package, or framework just to add one feature. The "no build step" property is what makes preview deploys and the static hosting model work.
