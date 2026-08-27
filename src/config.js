// ─────────────────────────────────────────────────────────────
// Runtime configuration
// ─────────────────────────────────────────────────────────────
// The form's pillars, problem statements, involvement modes and
// user-facing copy all live in the Google Sheet. This module fetches
// them and degrades gracefully:
//
//   live fetch  →  localStorage cache  →  bundled defaults
//
// So the form always renders something sensible: fresh content when
// the backend is reachable, the last-known-good content when it isn't,
// and the defaults below on a cold device with no backend at all.

// Apps Script /exec URL. Empty = artifact/offline mode (defaults only).
export const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxazlKXiqY8CqmkcsCmXSYjsVaiSoREAsZZKYCG1DNb_gRO2PB1qbO29-dIX4LbvNp5hg/exec";

// SHA-256 of the organiser passcode. This gates the UI only — the real
// check happens server-side against the ORGANISER_CODE script property.
// Anyone reading the bundle can find this hash, which is why the
// endpoint has its own gate. Regenerate with:
//   echo -n "yourcode" | shasum -a 256
export const ADMIN_HASH =
  "c7480de97a58bf51cbf62351279040ed50e636891597950f68f9ee92280ebf0c";

// localStorage on *.github.io is shared across every repo on the account,
// so this key needs to stay distinctive.
const CACHE_KEY = "gsc2026-problem-interest-form:config";
const FETCH_TIMEOUT_MS = 4000;

// ─────────────────────────────────────────────────────────────
// Bundled defaults — the last line of fallback, and the seed values
// that Code.gs's setup() writes into a fresh sheet. Keep the two in
// sync when editing either.
// ─────────────────────────────────────────────────────────────
export const DEFAULT_CONFIG = {
  pillars: [
    {
      id: "p1",
      name: "Equity & Inclusion",
      color: "#2F5AA8",
      statements: [
        { id: "p1s1", title: "Social isolation & loneliness", sub: "Young working adults" },
        { id: "p1s2", title: "PWDs post-18 cliffs", sub: "Support drop-off after age 18" },
        { id: "p1s3", title: "End of life, palliative care & grief support", sub: "" },
        { id: "p1s4", title: "Caregiving & sandwiched generation support", sub: "" },
      ],
    },
    {
      id: "p2",
      name: "Education & Employment",
      color: "#1E7A6F",
      statements: [
        { id: "p2s1", title: "Impact of AI on fresh grads", sub: "" },
        { id: "p2s2", title: "Education arms race & anxiety", sub: "" },
        { id: "p2s3", title: "Upskilling for retrenched mid-career workers", sub: "" },
        { id: "p2s4", title: "Social mobility", sub: "" },
        { id: "p2s5", title: "NEET youths", sub: "Not in education, employment or training" },
      ],
    },
    {
      id: "p3",
      name: "Climate & Environment",
      color: "#8A5A1E",
      statements: [
        { id: "p3s1", title: "Waste & circularity", sub: "" },
        { id: "p3s2", title: "Heat resilience & environmental justice", sub: "" },
      ],
    },
  ],
  modes: [
    { id: "discuss", label: "Discuss", desc: "Join panels & discussions, share perspectives" },
    { id: "research", label: "Research", desc: "Help write issue briefs, do field research" },
    { id: "build", label: "Build", desc: "Work hands-on on a project tackling this" },
  ],
  copy: {
    eyebrow: "Global Shapers · Singapore Hub",
    headline: "Where do you want to make a dent?",
    intro:
      "We mapped the landscape and shortlisted {count} problem statements across {pillarCount} pillars. Tell us which ones you'd actually show up for — and how deep you'd go.",
    stepName: "Your name",
    stepCauses: "Pick your causes",
    stepInvolvement: "How you'd get involved",
    stepSkills: "Passions, skills & networks",
    stepReview: "Review & send",
    nameLabel: "Name",
    namePlaceholder: "Your full name",
    causesPrompt: "Select every problem you'd genuinely make time for. There's no limit.",
    involvementPrompt:
      "For each cause you picked, choose every way you'd be willing to contribute. Pick more than one if that's true.",
    modesHint:
      "Discuss — panels & discussions · Research — issue briefs & research · Build — hands-on project work",
    notesPlaceholder:
      "Optional — got a project idea that could address this gap? Any relevant experience in this problem space (work, volunteering, lived experience)? Share both here.",
    // Step 4 asks three things, in this order. The order is deliberate:
    // causes first, following on from the problem statements just picked.
    otherCausesLabel: "Other causes you're passionate about",
    otherCausesHelp:
      "What do you deeply care about that isn't on our list — and why does it matter to you? Free-form; list as many as you like, and we'll consider adding them to the repository.",
    skillsLabel: "Skills & past experience",
    skillsHelp:
      "What can you actually do, and what have you done before? e.g. research, design, engineering, policy, fundraising, comms — plus any work, volunteering or lived experience that's relevant.",
    networksLabel: "Networks & resources",
    networksHelp:
      "Who or what can you open doors to? e.g. connections to specific communities, NGOs, government agencies, companies or funders — or access to space, tools, data or budget.",
    reviewNote: "Your response goes to the Global Shapers Singapore organising team.",
    submitLabel: "Send my response",
    doneHeadline: "Thanks, {firstName}.",
    doneBody:
      "Your interests are with the organising team. We'll reach out when we start forming groups around each problem statement.",
    footer: "Global Shapers Singapore · Landscape research → action",
    errName: "Your name helps us follow up — please add it.",
    errCauses: "Pick at least one problem statement to continue.",
    errModes:
      "Choose at least one way to get involved for each cause (Discuss / Research / Build).",
    errSend:
      "Couldn't save your response just now. Use “Copy my answers” and send them to the organisers directly.",
  },
};

// ─────────────────────────────────────────────────────────────
// Normalisation — a hand-edited sheet will produce rough data.
// Anything malformed falls back rather than crashing the form.
// ─────────────────────────────────────────────────────────────
function normalise(raw) {
  const pillars = (Array.isArray(raw?.pillars) ? raw.pillars : [])
    .map((p, i) => ({
      id: String(p?.id || `pillar-${i}`),
      name: String(p?.name || "").trim(),
      color: /^#[0-9a-f]{3,8}$/i.test(String(p?.color || "").trim())
        ? String(p.color).trim()
        : "#8892A6",
      statements: (Array.isArray(p?.statements) ? p.statements : [])
        .map((s, j) => ({
          id: String(s?.id || `${p?.id || i}s${j}`),
          title: String(s?.title || "").trim(),
          sub: String(s?.sub || "").trim(),
        }))
        .filter((s) => s.title),
    }))
    .filter((p) => p.name && p.statements.length);

  const modes = (Array.isArray(raw?.modes) ? raw.modes : [])
    .map((m, i) => ({
      id: String(m?.id || `mode-${i}`),
      label: String(m?.label || "").trim(),
      desc: String(m?.desc || "").trim(),
    }))
    .filter((m) => m.label);

  // Merge copy over the defaults so a sheet missing a key still renders
  // that string rather than an empty gap.
  const copy = { ...DEFAULT_CONFIG.copy };
  if (raw?.copy && typeof raw.copy === "object") {
    for (const [k, v] of Object.entries(raw.copy)) {
      if (typeof v === "string" && v.trim()) copy[k] = v;
    }
  }

  return {
    pillars: pillars.length ? pillars : DEFAULT_CONFIG.pillars,
    modes: modes.length ? modes : DEFAULT_CONFIG.modes,
    copy,
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(raw) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {
    // Private browsing / quota — cache is an optimisation, not a requirement.
  }
}

/**
 * Resolves to { config, source } where source is one of:
 *   "live"    — fetched from the sheet just now
 *   "cache"   — last successful fetch on this device
 *   "default" — bundled defaults
 */
export async function loadConfig() {
  if (!SCRIPT_URL) {
    const cached = readCache();
    return cached
      ? { config: cached, source: "cache" }
      : { config: DEFAULT_CONFIG, source: "default" };
  }

  try {
    const ctrl = new AbortController();
    // A cold Apps Script can take a couple of seconds; past that, show the
    // form with cached/default content rather than making people wait.
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${SCRIPT_URL}?mode=config`, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
    const raw = await res.json();
    if (raw?.error) throw new Error(raw.error);

    writeCache(raw);
    return { config: normalise(raw), source: "live" };
  } catch {
    const cached = readCache();
    return cached
      ? { config: cached, source: "cache" }
      : { config: DEFAULT_CONFIG, source: "default" };
  }
}

/** Fills {placeholders} in a copy string. Unknown keys are left as-is. */
export function fill(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] === undefined ? m : String(vars[k])
  );
}
