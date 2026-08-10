/**
 * Google Apps Script backend for the Global Shapers SG interest form.
 *
 * ── SETUP ────────────────────────────────────────────────────────────────
 * 1. Create a new Google Sheet. Name it whatever you like.
 * 2. Extensions → Apps Script. Delete the placeholder, paste this file, Save.
 * 3. Run the `setup` function once (select it in the toolbar dropdown → Run).
 *    Grant the permissions it asks for. This creates and seeds all five tabs
 *    — you do NOT need to build the sheet by hand.
 * 4. Deploy → New deployment → type "Web app".
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Copy the /exec URL into SCRIPT_URL in src/config.js.
 * 5. Set ORGANISER_CODE below to your own code, then re-deploy (see below).
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

// The organiser code. Checked server-side, so this is a real gate — unlike
// the client-side hash in the app bundle, which only stops casual clicking.
const ORGANISER_CODE = "pw2026";

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
    const supplied = (e.parameter.code || "").trim();
    if (supplied !== ORGANISER_CODE) {
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
    const selections = Array.isArray(d.selections) ? d.selections : [];

    sheet_(TAB.responses).appendRow([
      now,
      String(d.name).trim(),
      JSON.stringify(selections),
      d.skills || "",
      d.otherProblems || "",
      d.submittedAt || now.toISOString(),
    ]);

    // Mirror into a flat, one-row-per-(person × statement) tab so the sheet
    // is directly pivotable. The JSON blob above stays the source of truth.
    const flat = sheet_(TAB.flat);
    selections.forEach(function (s) {
      const modes = Array.isArray(s.modes) ? s.modes : [];
      flat.appendRow([
        now,
        String(d.name).trim(),
        s.pillar || "",
        s.id || "",
        s.title || "",
        modes.indexOf("Discuss") > -1 ? 1 : 0,
        modes.indexOf("Research") > -1 ? 1 : 0,
        modes.indexOf("Build") > -1 ? 1 : 0,
        s.notes || "",
      ]);
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
        skills: String(r.Skills || ""),
        otherProblems: String(r.OtherProblems || ""),
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

  ensureTab_(ss, TAB.responses, [
    ["Timestamp", "Name", "Selections", "Skills", "OtherProblems", "SubmittedAt"],
  ]);

  ensureTab_(ss, TAB.flat, [
    [
      "Timestamp",
      "Name",
      "Pillar",
      "StatementId",
      "Statement",
      "Discuss",
      "Research",
      "Build",
      "Notes",
    ],
  ]);

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
    ["stepSkills", "Skills & what we missed"],
    ["stepReview", "Review & send"],
    ["nameLabel", "Name"],
    ["namePlaceholder", "Your full name"],
    ["causesPrompt", "Select every problem you'd genuinely make time for. There's no limit."],
    ["involvementPrompt", "For each cause you picked, choose every way you'd be willing to contribute. Pick more than one if that's true."],
    ["modesHint", "Discuss — panels & discussions · Research — issue briefs & research · Build — hands-on project work"],
    ["notesPlaceholder", "Optional — got a project idea that could address this gap? Any relevant experience in this problem space (work, volunteering, lived experience)? Share both here."],
    ["skillsLabel", "Skills or networks you bring"],
    ["skillsHelp", "Regardless of problem space — what skills or networks do you bring to the hub, and what would you want to contribute through them? e.g. research, design, engineering, fundraising, media, connections to specific communities or organisations."],
    ["missedLabel", "Problems we missed"],
    ["missedHelp", "What do you deeply care about that isn't on our list? Free-form — list as many as you like, and we'll consider adding them to the repository."],
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
