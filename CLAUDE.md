# Global Shapers Singapore — Member Interest Form

Multi-step React form for collecting member interest across the hub's problem
statements, built originally as a Claude artifact and ported to a Vite app.
Content is driven by a Google Sheet at runtime.

## What this is

- **Flow**: Name → select problem statements (multi-select, grouped by pillar) →
  per-problem involvement depth (Discuss / Research / Build chips, multi-select)
  with one optional textarea per problem (project idea + relevant experience) →
  general skills/networks + "problems we missed" free text → review → submit.
- **Organiser view**: link in the footer, gated by a passcode. Shows analytics
  (interest counts per problem with Discuss/Research/Build breakdown, build
  commitments, suggested problems, skills in the room) and raw responses with
  JSON export.
- **Design intent**: pillar-coded left borders on cards, ink-blue palette
  (`#1C2B4A` ink on `#F7F8FA` paper), Space Grotesk display + Public Sans body.
  Keep it quiet; the pillar colour coding is the signature.

## Architecture

Three modules, split by concern:

- **`src/config.js`** — `SCRIPT_URL`, `ADMIN_HASH`, `DEFAULT_CONFIG`, and
  `loadConfig()`. Owns the fallback chain: live fetch → localStorage cache →
  bundled defaults. `normalise()` defends against a hand-edited sheet — bad
  colours, blank titles and missing keys degrade rather than crash.
- **`src/storage.js`** — `saveResponse` / `loadResponses` / `sha256`. Uses
  `window.storage` in a Claude artifact, otherwise the Apps Script endpoint.
- **`src/App.jsx`** — the UI. Reads everything from config; no content literals.

**Content lives in the Sheet, not the code.** Pillars, statements, involvement
modes and every user-facing string come from the `Statements`, `Modes` and
`Copy` tabs. `DEFAULT_CONFIG` in `config.js` is the offline fallback *and* the
seed data for `setup()` in `Code.gs` — when you change one, change both.

See [README.md](README.md) for the sheet schema and setup steps.

## Things that will bite you

- **Apps Script re-deploy**: saving `Code.gs` does not change what `/exec`
  serves. Deploy → Manage deployments → edit → Version: **New version**. This
  is the most common "my change did nothing" cause.
- **Apps Script POSTs use `Content-Type: text/plain` deliberately** — it avoids
  the CORS preflight that Apps Script web apps can't answer. Don't "fix" it to
  application/json.
- **`saveResponse` checks `res.ok` *and* the JSON body.** Apps Script returns
  200 with an error page when the script throws, so status alone isn't proof
  the row landed. Without both checks, members see "Thanks!" while their
  response is dropped.
- **Statement ids are load-bearing.** Responses store `id` alongside `title`,
  and analytics key off the id when present. Renaming a `Title` in the sheet is
  safe; reusing a `StatementId` for a different statement silently merges two
  problems' data.
- **Two gates, two purposes.** `ADMIN_HASH` in the bundle only decides whether
  the organiser UI renders. The `ORGANISER_CODE` **script property** is the real
  check — the responses endpoint would otherwise be a public dump of names and
  personal free text. Change both together, and hash with `echo -n` (a trailing
  newline yields a hash that rejects the correct code).
- **The organiser code is not in the repo.** It lives in the Apps Script
  project's Script Properties, so `Code.gs` here is safe to re-paste and the
  secret never lands in git. `organiserCode_()` returns `""` when unset, and an
  unset code denies everyone rather than admitting everyone.
- **Config cache is 30s** server-side (`CONFIG_CACHE_SECONDS`) plus whatever is
  in the browser's localStorage. A sheet edit isn't instant; `flushConfigCache()`
  in the Apps Script editor forces it.

## Setup / deploy

1. `npm install && npm run dev` to run locally.
2. Backend: create a Sheet → paste `apps-script/Code.gs` → run `setup()` →
   deploy as web app (access "Anyone") → copy the `/exec` URL into `SCRIPT_URL`
   in `src/config.js`.
3. GitHub Pages: set `base: "/<repo-name>/"` in `vite.config.js`, push to
   `main`; `.github/workflows/deploy.yml` builds and deploys. Enable Pages
   (Settings → Pages → Source: GitHub Actions) once.

## Known gaps / ideas

- No duplicate-submission guard (same person can submit twice). Could dedupe by
  name in the organiser view, or add a hidden-field token.
- The organiser code is shared rather than per-user; rotating it means editing
  `Code.gs`, re-deploying, and updating `ADMIN_HASH`.
- Analytics are computed client-side from raw rows; fine at club scale.
- Mode labels `Discuss` / `Research` / `Build` are hardcoded in the analytics
  aggregation and in the `Flat` sheet columns. Renaming them in the `Modes` tab
  changes the form but orphans the counts.
