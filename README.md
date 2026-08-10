# Global Shapers Singapore — Member Interest Form

A multi-step form for collecting member interest across the hub's problem
statements, backed by a Google Sheet. Organisers edit the sheet; the form
picks the changes up on the next page load.

```bash
npm install
npm run dev
```

---

## The Google Sheet

You don't build the sheet by hand. `apps-script/Code.gs` has a `setup()`
function that creates and seeds every tab.

1. Create a new Google Sheet.
2. **Extensions → Apps Script**, delete the placeholder, paste in
   `apps-script/Code.gs`, Save.
3. Select `setup` in the function dropdown and **Run**. Grant permissions.
4. **Project Settings (⚙) → Script Properties → Add**
   - Property: `ORGANISER_CODE`  Value: *your code*

   The code lives here rather than in `Code.gs` so that re-pasting the file
   can't silently revert it, and so the secret never reaches the git repo.
   **Until this property is set, the responses endpoint refuses everyone.**
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the `/exec` URL into `SCRIPT_URL` in [`src/config.js`](src/config.js),
   and set `ADMIN_HASH` there to the SHA-256 of your code:
   `echo -n "yourcode" | shasum -a 256`

   Use `echo -n`. Plain `echo` appends a newline and hashes a different
   string, so the organiser view will reject a code that looks correct.

### ⚠️ The re-deploy gotcha

Saving the Apps Script does **not** change what `/exec` serves. After any edit:

**Deploy → Manage deployments → ✏️ → Version: New version → Deploy**

The URL stays the same. Creating a *new* deployment instead gives you a
different URL, and is the usual reason an edit "didn't do anything".

### Tabs

`setup()` creates five. The first two collect data; the last three configure
the form.

| Tab | Purpose |
|---|---|
| `Responses` | One row per submission. `Selections` is a JSON blob — the source of truth. |
| `Flat` | One row per *(person × statement)*. Denormalised for pivot tables and charts. |
| `Statements` | The pillars and problem statements shown in step 2. |
| `Modes` | The involvement chips (Discuss / Research / Build). |
| `Copy` | Every user-facing string in the form. |

Columns are matched **by header name**, so you can reorder or add columns
without breaking anything.

#### `Statements`

| PillarId | Pillar | Color | StatementId | Title | Subtitle | Order | Active |
|---|---|---|---|---|---|---|---|
| `p1` | Equity & Inclusion | `#2F5AA8` | `p1s1` | Social isolation & loneliness | Young working adults | 10 | TRUE |

- **PillarId** groups rows into pillars. Pillars appear in the order their
  first row appears.
- **Color** is the pillar's accent — the left border on cards and the bar in
  analytics. Use hex; anything unparseable falls back to grey.
- **StatementId** must be stable and unique. It travels with each response,
  so you can rename a `Title` later without orphaning the data already
  collected under it. **Don't reuse an old id for a new statement.**
- **Order** sorts statements within a pillar. Leave gaps (10, 20, 30…) so you
  can insert without renumbering.
- **Active** — set `FALSE` to retire a statement while keeping its history.
  Blank counts as active.

#### `Modes`

| ModeId | Label | Description | Order | Active |
|---|---|---|---|---|
| `build` | Build | Work hands-on on a project tackling this | 30 | TRUE |

`Description` is the chip's hover tooltip. Note that the analytics view counts
the labels `Discuss`, `Research` and `Build` specifically — renaming those
labels will orphan the counts, so rename with care.

#### `Copy`

Key/value. Every string the member sees. Missing keys fall back to the
bundled default, so you can delete rows you don't want to override.

Three keys take placeholders:

| Key | Placeholders |
|---|---|
| `intro` | `{count}` — number of statements · `{pillarCount}` — number of pillars |
| `doneHeadline` | `{firstName}` |

---

## How config reaches the form

```
live fetch  →  localStorage cache  →  bundled defaults
```

On load the app calls `GET /exec?mode=config`. If that succeeds it renders the
sheet's content and caches it. If the backend is slow (>4s), unreachable, or
returns garbage, it falls back to the last good config on that device, and
failing that to the defaults compiled into
[`src/config.js`](src/config.js).

The form therefore never hard-fails on a config problem — worst case, someone
sees slightly stale questions. Apps Script caches the parsed config for 30s,
so a sheet edit goes live within about half a minute. Run `flushConfigCache()`
in the Apps Script editor to skip the wait.

**Keep `DEFAULT_CONFIG` in `src/config.js` roughly in sync with the sheet.**
It's the fallback, and it's also what `setup()` seeds a new sheet with.

---

## Endpoints

| Request | Returns |
|---|---|
| `GET ?mode=config` | `{ pillars, modes, copy }` — public |
| `GET ?mode=responses&code=XXX` | All submissions — requires the organiser code |
| `POST` (body = submission JSON) | `{ ok: true }` |

The responses endpoint is gated **server-side**. The passcode in the app
bundle only controls whether the UI renders — it can't protect the data,
which is why the check also happens in `Code.gs`.

---

## Deploying to GitHub Pages

1. Set `base: "/<repo-name>/"` in [`vite.config.js`](vite.config.js).
2. Push to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   builds and publishes.
3. One-time: **Settings → Pages → Source: GitHub Actions**.

---

## Known gaps

- **No duplicate-submission guard.** The same person can submit twice. Dedupe
  by name in the sheet, or add a token if it becomes a problem.
- **The organiser code is shared, not per-user.** Rotating it means editing
  `Code.gs`, re-deploying, and updating `ADMIN_HASH`.
- **Analytics are computed client-side** from raw rows. Fine at club scale.
- **Free-text answers can be personal** (lived experience of grief,
  caregiving). The responses endpoint is code-gated, but anyone with the code
  sees everything. Consider what you promise members on the form.
