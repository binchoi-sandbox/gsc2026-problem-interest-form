/**
 * Google Apps Script backend for the Global Shapers SG interest form.
 *
 * ── SETUP ────────────────────────────────────────────────────────────────
 * 1. Create a new Google Sheet. Name it whatever you like.
 * 2. Extensions → Apps Script. Delete the placeholder, paste this file, Save.
 * 3. Run the `setup` function once (select it in the toolbar dropdown → Run).
 *    Grant the permissions it asks for. This creates and seeds all five tabs
 *    — you do NOT need to build the sheet by hand.
 * 4. Project Settings (⚙) → Script Properties → Add:
 *      Property: ORGANISER_CODE   Value: <your code>
 *    Until this is set, the responses endpoint refuses everyone.
 * 5. Deploy → New deployment → type "Web app".
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Copy the /exec URL into SCRIPT_URL in src/config.js, and put the
 *    SHA-256 of your code into ADMIN_HASH there:
 *      echo -n "yourcode" | shasum -a 256
 *
 * ── THE RE-DEPLOY GOTCHA ─────────────────────────────────────────────────
 * Saving this file does NOT change what /exec serves. After ANY edit:
 *   Deploy → Manage deployments → (pencil) → Version: New version → Deploy
 * The /exec URL stays the same. Creating a *new* deployment instead gives you
 * a different URL and is the usual reason "my change didn't do anything".
 *
 * ── ENDPOINTS ────────────────────────────────────────────────────────────
 *   GET  ?mode=config              → { pillars, modes, copy }  (public)
 *   GET  ?mode=responses&code=XXX  → [ submissions ]           (code-gated)
 *   POST (body = submission JSON)  → { ok: true }
 */

// The organiser code lives in a script property, NOT in this file — so
// re-pasting this file can't silently revert it, and the secret never
// reaches the git repo.
//
// Set it once: Project Settings (⚙) → Script Properties → Add
//   Property: ORGANISER_CODE     Value: <your code>
//
// Checked server-side, so this is a real gate — unlike the client-side
// hash in the app bundle, which only decides whether the UI renders.
function organiserCode_() {
  return PropertiesService.getScriptProperties().getProperty("ORGANISER_CODE") || "";
}

// Seconds to cache the parsed config. Sheet edits appear after this expires.
const CONFIG_CACHE_SECONDS = 30;

const TAB = {
  responses: "Responses",
  flat: "Flat",
  statements: "Statements",
  modes: "Modes",
  copy: "Copy",
};

// ─────────────────────────────────────────────────────────────────────────
// HTTP entry points
// ─────────────────────────────────────────────────────────────────────────

function doGet(e) {
  const mode = (e && e.parameter && e.parameter.mode) || "config";

  if (mode === "responses") {
    const expected = organiserCode_();
    const supplied = (e.parameter.code || "").trim();
    // An unset property must never mean "everyone is authorised".
    if (!expected || supplied !== expected) {
      return json_({ error: "unauthorised" });
    }
    return json_(readResponses_());
  }

  // Default to config. Never fall through to responses — an unauthenticated
  // dump of names and free-text answers is the failure mode to avoid here.
  return json_(readConfig_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Serialise appends. Without this, simultaneous submissions at an event
    // can interleave and clobber each other's rows.
    lock.waitLock(20000);

    const d = JSON.parse(e.postData.contents);
    if (!d || !String(d.name || "").trim()) {
      return json_({ ok: false, error: "name is required" });
    }

    const now = new Date();
    const name = String(d.name).trim();
    const selections = Array.isArray(d.selections) ? d.selections : [];

    appendByHeader_(sheet_(TAB.responses), {
      Timestamp: now,
      Name: name,
      Selections: JSON.stringify(selections),
      OtherCauses: d.otherCauses || "",
      Skills: d.skills || "",
      Networks: d.networks || "",
      SubmittedAt: d.submittedAt || now.toISOString(),
    });

    // Mirror into a flat, one-row-per-(person × statement) tab so the sheet
    // is directly pivotable. The JSON blob above stays the source of truth.
    const flat = sheet_(TAB.flat);
    const modeLabels = readModes_().map(function (m) {
      return m.label;
    });
    selections.forEach(function (s) {
      const modes = Array.isArray(s.modes) ? s.modes : [];
      const row = {
        Timestamp: now,
        Name: name,
        Pillar: s.pillar || "",
        StatementId: s.id || "",
        Statement: s.title || "",
        // Plain-text mirror of the selections. Survives any mode rename,
        // so the data is never lost even if the 1/0 columns below don't
        // line up with the current mode labels.
        Modes: modes.join(", "),
        Notes: s.notes || "",
      };
      // One 1/0 column per configured mode, keyed by label. appendByHeader_
      // drops keys with no matching header, so a renamed mode simply stops
      // filling its old column instead of shifting every value after it.
      modeLabels.forEach(function (label) {
        row[label] = modes.indexOf(label) > -1 ? 1 : 0;
      });
      appendByHeader_(flat, row);
    });

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────

function readResponses_() {
  const rows = rowObjects_(sheet_(TAB.responses));
  return rows
    .filter(function (r) {
      return String(r.Name || "").trim();
    })
    .map(function (r) {
      return {
        name: String(r.Name),
        selections: safeParse_(r.Selections, []),
        otherCauses: String(r.OtherCauses || ""),
        skills: String(r.Skills || ""),
        networks: String(r.Networks || ""),
        submittedAt: toIso_(r.SubmittedAt || r.Timestamp),
      };
    });
}

function readConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("config");
  if (hit) return JSON.parse(hit);

  const config = {
    pillars: readPillars_(),
    modes: readModes_(),
    copy: readCopy_(),
  };

  cache.put("config", JSON.stringify(config), CONFIG_CACHE_SECONDS);
  return config;
}

function readPillars_() {
  const rows = rowObjects_(sheet_(TAB.statements)).filter(function (r) {
    return String(r.Title || "").trim() && isTrue_(r.Active);
  });

  rows.sort(function (a, b) {
    return num_(a.Order) - num_(b.Order);
  });

  // Group into pillars, preserving first-seen pillar order.
  const order = [];
  const byPillar = {};
  rows.forEach(function (r) {
    const pid = String(r.PillarId || r.Pillar || "").trim();
    if (!byPillar[pid]) {
      byPillar[pid] = {
        id: pid,
        name: String(r.Pillar || "").trim(),
        color: String(r.Color || "#8892A6").trim(),
        statements: [],
      };
      order.push(pid);
    }
    byPillar[pid].statements.push({
      id: String(r.StatementId || "").trim(),
      title: String(r.Title).trim(),
      sub: String(r.Subtitle || "").trim(),
    });
  });

  return order.map(function (pid) {
    return byPillar[pid];
  });
}

function readModes_() {
  const rows = rowObjects_(sheet_(TAB.modes)).filter(function (r) {
    return String(r.Label || "").trim() && isTrue_(r.Active);
  });
  rows.sort(function (a, b) {
    return num_(a.Order) - num_(b.Order);
  });
  return rows.map(function (r) {
    return {
      id: String(r.ModeId || "").trim(),
      label: String(r.Label).trim(),
      desc: String(r.Description || "").trim(),
    };
  });
}

function readCopy_() {
  const out = {};
  rowObjects_(sheet_(TAB.copy)).forEach(function (r) {
    const k = String(r.Key || "").trim();
    if (k) out[k] = String(r.Value == null ? "" : r.Value);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function sheet_(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) {
    throw new Error(
      'Sheet tab "' + name + '" not found. Run the setup() function once to create it.'
    );
  }
  return s;
}

/**
 * Appends a row by matching object keys to the sheet's header text.
 *
 * Writes used to be positional while reads matched on header name, so
 * inserting or reordering a column silently sent data to the wrong place.
 * Both directions now agree on the header row as the single source of truth:
 * reorder columns freely, and an unrecognised key is dropped rather than
 * shifting everything after it.
 */
function appendByHeader_(sheet, values) {
  const headers = sheet
    .getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
    .getValues()[0]
    .map(function (h) {
      return String(h).trim();
    });
  const row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(values, h) ? values[h] : "";
  });
  sheet.appendRow(row);
}

/** Rows as objects keyed by header text, so columns can be reordered freely. */
function rowObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function (h) {
    return String(h).trim();
  });
  return values.slice(1).map(function (row) {
    const o = {};
    headers.forEach(function (h, i) {
      if (h) o[h] = row[i];
    });
    return o;
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function safeParse_(v, fallback) {
  try {
    return JSON.parse(v);
  } catch (err) {
    return fallback;
  }
}

function isTrue_(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  // Blank means active — an organiser adding a row shouldn't have to
  // remember to type TRUE for it to show up.
  return s === "" || s === "true" || s === "yes" || s === "y" || s === "1";
}

function num_(v) {
  const n = Number(v);
  return isNaN(n) ? 9999 : n;
}

function toIso_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v || "");
}

// ─────────────────────────────────────────────────────────────────────────
// One-time setup: builds and seeds every tab.
// Safe to re-run — it only creates tabs that don't already exist.
// ─────────────────────────────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActive();

  // Config tabs first: Flat's per-mode columns are named after whatever the
  // Modes tab actually contains, so that tab has to exist before we read it.
  ensureConfigTabs_(ss);

  ensureTab_(ss, TAB.responses, [
    [
      "Timestamp",
      "Name",
      "Selections",
      "OtherCauses",
      "Skills",
      "Networks",
      "SubmittedAt",
    ],
  ]);

  // One 1/0 column per configured mode, named after the current labels — so
  // deleting this tab and re-running setup() after renaming a mode produces
  // headers that match. The Modes text column is correct regardless.
  const modeLabels = readModes_().map(function (m) {
    return m.label;
  });
  ensureTab_(ss, TAB.flat, [
    ["Timestamp", "Name", "Pillar", "StatementId", "Statement", "Modes"]
      .concat(modeLabels)
      .concat(["Notes"]),
  ]);
}

function ensureConfigTabs_(ss) {
  ensureTab_(ss, TAB.statements, [
    ["PillarId", "Pillar", "Color", "StatementId", "Title", "Subtitle", "Order", "Active"],
    ["p1", "Equity & Inclusion", "#2F5AA8", "p1s1", "Social isolation & loneliness", "Young working adults", 10, true],
    ["p1", "Equity & Inclusion", "#2F5AA8", "p1s2", "PWDs post-18 cliffs", "Support drop-off after age 18", 20, true],
    ["p1", "Equity & Inclusion", "#2F5AA8", "p1s3", "End of life, palliative care & grief support", "", 30, true],
    ["p1", "Equity & Inclusion", "#2F5AA8", "p1s4", "Caregiving & sandwiched generation support", "", 40, true],
    ["p2", "Education & Employment", "#1E7A6F", "p2s1", "Impact of AI on fresh grads", "", 50, true],
    ["p2", "Education & Employment", "#1E7A6F", "p2s2", "Education arms race & anxiety", "", 60, true],
    ["p2", "Education & Employment", "#1E7A6F", "p2s3", "Upskilling for retrenched mid-career workers", "", 70, true],
    ["p2", "Education & Employment", "#1E7A6F", "p2s4", "Social mobility", "", 80, true],
    ["p2", "Education & Employment", "#1E7A6F", "p2s5", "NEET youths", "Not in education, employment or training", 90, true],
    ["p3", "Climate & Environment", "#8A5A1E", "p3s1", "Waste & circularity", "", 100, true],
    ["p3", "Climate & Environment", "#8A5A1E", "p3s2", "Heat resilience & environmental justice", "", 110, true],
  ]);

  ensureTab_(ss, TAB.modes, [
    ["ModeId", "Label", "Description", "Order", "Active"],
    ["discuss", "Discuss", "Join panels & discussions, share perspectives", 10, true],
    ["research", "Research", "Help write issue briefs, do field research", 20, true],
    ["build", "Build", "Work hands-on on a project tackling this", 30, true],
  ]);

  ensureTab_(ss, TAB.copy, [
    ["Key", "Value"],
    ["eyebrow", "Global Shapers · Singapore Hub"],
    ["headline", "Where do you want to make a dent?"],
    ["intro", "We mapped the landscape and shortlisted {count} problem statements across {pillarCount} pillars. Tell us which ones you'd actually show up for — and how deep you'd go."],
    ["stepName", "Your name"],
    ["stepCauses", "Pick your causes"],
    ["stepInvolvement", "How you'd get involved"],
    ["stepSkills", "Passions, skills & networks"],
    ["stepReview", "Review & send"],
    ["nameLabel", "Name"],
    ["namePlaceholder", "Your full name"],
    ["causesPrompt", "Select every problem you'd genuinely make time for. There's no limit."],
    ["involvementPrompt", "For each cause you picked, choose every way you'd be willing to contribute. Pick more than one if that's true."],
    ["modesHint", "Discuss — panels & discussions · Research — issue briefs & research · Build — hands-on project work"],
    ["notesPlaceholder", "Optional — got a project idea that could address this gap? Any relevant experience in this problem space (work, volunteering, lived experience)? Share both here."],
    ["otherCausesLabel", "Other causes you're passionate about"],
    ["otherCausesHelp", "What do you deeply care about that isn't on our list — and why does it matter to you? Free-form; list as many as you like, and we'll consider adding them to the repository."],
    ["skillsLabel", "Skills & past experience"],
    ["skillsHelp", "What can you actually do, and what have you done before? e.g. research, design, engineering, policy, fundraising, comms — plus any work, volunteering or lived experience that's relevant."],
    ["networksLabel", "Networks & resources"],
    ["networksHelp", "Who or what can you open doors to? e.g. connections to specific communities, NGOs, government agencies, companies or funders — or access to space, tools, data or budget."],
    ["reviewNote", "Your response goes to the Global Shapers Singapore organising team."],
    ["submitLabel", "Send my response"],
    ["doneHeadline", "Thanks, {firstName}."],
    ["doneBody", "Your interests are with the organising team. We'll reach out when we start forming groups around each problem statement."],
    ["footer", "Global Shapers Singapore · Landscape research → action"],
    ["errName", "Your name helps us follow up — please add it."],
    ["errCauses", "Pick at least one problem statement to continue."],
    ["errModes", "Choose at least one way to get involved for each cause (Discuss / Research / Build)."],
    ["errSend", "Couldn't save your response just now. Use “Copy my answers” and send them to the organisers directly."],
  ]);
}

function ensureTab_(ss, name, rows) {
  if (ss.getSheetByName(name)) return;
  const sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/** Clears the config cache so the next request re-reads the sheet immediately. */
function flushConfigCache() {
  CacheService.getScriptCache().remove("config");
}
