import React, { useState, useEffect, useMemo } from "react";
import { loadConfig, fill, ADMIN_HASH, DEFAULT_CONFIG } from "./config.js";
import { saveResponse, loadResponses, sha256 } from "./storage.js";

const INK = "#1C2B4A";
const PAPER = "#F7F8FA";

const Fonts = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Public+Sans:wght@400;500;600&display=swap');
    .gs-display { font-family: 'Space Grotesk', sans-serif; }
    .gs-body { font-family: 'Public Sans', system-ui, sans-serif; }
    .gs-card { transition: border-color .15s, box-shadow .15s; }
    .gs-card:focus-visible { outline: 3px solid #2F5AA8; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .gs-card { transition: none; } }
  `}</style>
);

export default function App() {
  // ── config ──────────────────────────────────────────────────
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let alive = true;
    loadConfig().then(({ config }) => {
      if (alive) setConfig(config);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── form state ──────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]); // statement ids, in click order
  const [modes, setModes] = useState({}); // statement id -> [modeId]
  const [notes, setNotes] = useState({}); // statement id -> text
  const [skills, setSkills] = useState("");
  const [otherProblems, setOtherProblems] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── organiser view ──────────────────────────────────────────
  const [adminOpen, setAdminOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [adminData, setAdminData] = useState(null);
  const [adminTab, setAdminTab] = useState("analytics");

  const cfg = config || DEFAULT_CONFIG;
  const { pillars, modes: MODES, copy } = cfg;

  const ALL = useMemo(
    () =>
      pillars.flatMap((p) =>
        p.statements.map((s) => ({ ...s, pillar: p.name, color: p.color }))
      ),
    [pillars]
  );
  const byId = useMemo(() => Object.fromEntries(ALL.map((s) => [s.id, s])), [ALL]);
  const modeLabel = (id) => MODES.find((m) => m.id === id)?.label || id;

  const STEPS = [
    copy.stepName,
    copy.stepCauses,
    copy.stepInvolvement,
    copy.stepSkills,
    copy.stepReview,
  ];

  const toggleStatement = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const toggleMode = (sid, mid) =>
    setModes((m) => {
      const cur = m[sid] || [];
      return {
        ...m,
        [sid]: cur.includes(mid) ? cur.filter((x) => x !== mid) : [...cur, mid],
      };
    });

  const validate = () => {
    setError("");
    if (step === 0 && !name.trim()) return setError(copy.errName), false;
    if (step === 1 && selected.length === 0) return setError(copy.errCauses), false;
    if (step === 2) {
      const missing = selected.filter((id) => !(modes[id] || []).length);
      if (missing.length) return setError(copy.errModes), false;
    }
    return true;
  };

  const next = () => {
    if (validate()) {
      setStep((s) => s + 1);
      window.scrollTo(0, 0);
    }
  };
  const back = () => {
    setError("");
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo(0, 0);
  };

  const payload = () => ({
    name: name.trim(),
    selections: selected.map((id) => ({
      // The id travels with the response so renaming a statement in the
      // sheet doesn't orphan the rows already collected under it.
      id,
      pillar: byId[id].pillar,
      title: byId[id].title,
      modes: (modes[id] || []).map(modeLabel),
      notes: (notes[id] || "").trim(),
    })),
    skills: skills.trim(),
    otherProblems: otherProblems.trim(),
    submittedAt: new Date().toISOString(),
  });

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      await saveResponse(payload());
      setDone(true);
    } catch {
      setError(copy.errSend);
    }
    setSending(false);
  };

  const copySummary = async () => {
    const d = payload();
    const lines = [
      `Global Shapers Singapore — interest form — ${d.name}`,
      "",
      ...d.selections.map(
        (s) =>
          `• ${s.title} [${s.pillar}] — ${s.modes.join(", ")}${
            s.notes ? `\n  Notes: ${s.notes}` : ""
          }`
      ),
      "",
      d.skills && `Skills & networks: ${d.skills}`,
      d.otherProblems && `Problems we missed: ${d.otherProblems}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const tryUnlock = async () => {
    setCodeError("");
    const h = await sha256(code);
    if (h !== ADMIN_HASH) {
      setCodeError("That's not the organiser code.");
      return;
    }
    setAuthed(true);
    setAdminData("loading");
    try {
      const rows = await loadResponses(code);
      rows.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
      setAdminData(rows);
    } catch (e) {
      setAdminData("error");
    }
  };

  const Chip = ({ active, onClick, children, title }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="gs-card px-3 py-1.5 rounded-full text-sm font-medium border"
      style={{
        borderColor: active ? INK : "#C9CFDA",
        background: active ? INK : "white",
        color: active ? "white" : INK,
      }}
    >
      {children}
    </button>
  );

  const Nav = ({ nextLabel = "Continue", onNext = next, showBack = step > 0 }) => (
    <div className="flex items-center gap-3 mt-8">
      {showBack && (
        <button
          type="button"
          onClick={back}
          className="px-4 py-2.5 rounded-lg border font-medium"
          style={{ borderColor: "#C9CFDA", color: INK }}
        >
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={sending}
        className="px-6 py-2.5 rounded-lg font-semibold text-white gs-display"
        style={{ background: INK, opacity: sending ? 0.6 : 1 }}
      >
        {sending ? "Sending…" : nextLabel}
      </button>
    </div>
  );

  // ── loading ─────────────────────────────────────────────────
  if (!config)
    return (
      <div
        className="gs-body min-h-screen flex items-center justify-center p-6"
        style={{ background: PAPER, color: INK }}
      >
        <Fonts />
        <p style={{ color: "#8892A6" }}>Loading…</p>
      </div>
    );

  // ── done screen ─────────────────────────────────────────────
  if (done)
    return (
      <div
        className="gs-body min-h-screen flex items-center justify-center p-6"
        style={{ background: PAPER, color: INK }}
      >
        <Fonts />
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="gs-display text-3xl font-bold mb-3">
            {fill(copy.doneHeadline, { firstName: name.trim().split(" ")[0] })}
          </h1>
          <p className="mb-6" style={{ color: "#4A5670" }}>
            {copy.doneBody}
          </p>
          <button
            type="button"
            onClick={copySummary}
            className="px-5 py-2.5 rounded-lg border font-medium"
            style={{ borderColor: "#C9CFDA" }}
          >
            {copied ? "Copied ✓" : "Copy my answers"}
          </button>
        </div>
      </div>
    );

  // ── organiser view ──────────────────────────────────────────
  if (adminOpen) {
    if (!authed)
      return (
        <div
          className="gs-body min-h-screen flex items-center justify-center p-6"
          style={{ background: PAPER, color: INK }}
        >
          <Fonts />
          <div
            className="w-full max-w-sm bg-white rounded-xl border p-6"
            style={{ borderColor: "#DDE2EA" }}
          >
            <h1 className="gs-display text-xl font-bold mb-1">Organiser view</h1>
            <p className="text-sm mb-4" style={{ color: "#4A5670" }}>
              Enter the organiser code to see responses and analytics.
            </p>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
              placeholder="Organiser code"
              className="w-full rounded-lg border px-4 py-2.5 mb-3"
              style={{ borderColor: "#C9CFDA" }}
            />
            {codeError && (
              <div className="text-sm mb-3 font-medium" style={{ color: "#8C2F2F" }}>
                {codeError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={tryUnlock}
                className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-white gs-display"
                style={{ background: INK }}
              >
                Unlock
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminOpen(false);
                  setCode("");
                  setCodeError("");
                }}
                className="px-4 py-2.5 rounded-lg border font-medium"
                style={{ borderColor: "#C9CFDA" }}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      );

    const rows = Array.isArray(adminData) ? adminData : [];

    // Key analytics by statement id where present so a renamed statement
    // keeps its history; fall back to title for rows saved before ids.
    const stats = {};
    for (const s of ALL)
      stats[s.id] = {
        title: s.title,
        color: s.color,
        pillar: s.pillar,
        total: 0,
        Discuss: 0,
        Research: 0,
        Build: 0,
      };

    const suggested = [];
    const skillNotes = [];
    for (const r of rows) {
      for (const sel of r.selections || []) {
        const key = sel.id && stats[sel.id] ? sel.id : sel.title;
        if (!stats[key])
          stats[key] = {
            title: sel.title,
            color: "#8892A6",
            pillar: sel.pillar,
            total: 0,
            Discuss: 0,
            Research: 0,
            Build: 0,
          };
        stats[key].total += 1;
        for (const m of sel.modes || []) if (stats[key][m] !== undefined) stats[key][m] += 1;
      }
      if ((r.otherProblems || "").trim())
        suggested.push({ name: r.name, text: r.otherProblems.trim() });
      if ((r.skills || "").trim()) skillNotes.push({ name: r.name, text: r.skills.trim() });
    }

    const ranked = Object.entries(stats).sort(
      (a, b) => b[1].total - a[1].total || b[1].Build - a[1].Build
    );
    const maxTotal = Math.max(1, ...ranked.map(([, v]) => v.total));

    const tabBtn = (id, label) => (
      <button
        type="button"
        onClick={() => setAdminTab(id)}
        className="px-4 py-2 rounded-lg border font-medium text-sm"
        style={{
          borderColor: adminTab === id ? INK : "#C9CFDA",
          background: adminTab === id ? INK : "white",
          color: adminTab === id ? "white" : INK,
        }}
      >
        {label}
      </button>
    );

    return (
      <div className="gs-body min-h-screen p-6" style={{ background: PAPER, color: INK }}>
        <Fonts />
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <h1 className="gs-display text-2xl font-bold">Organiser view</h1>
            <div className="flex gap-2">
              {tabBtn("analytics", "Analytics")}
              {tabBtn("responses", `Responses (${rows.length})`)}
              <button
                type="button"
                onClick={() => {
                  setAdminOpen(false);
                  setAuthed(false);
                  setCode("");
                }}
                className="px-4 py-2 rounded-lg border font-medium text-sm"
                style={{ borderColor: "#C9CFDA" }}
              >
                Exit
              </button>
            </div>
          </div>

          {adminData === "loading" && <p>Loading responses…</p>}
          {adminData === "error" && (
            <div
              className="rounded-lg px-4 py-3 text-sm font-medium"
              style={{ background: "#FBEDED", color: "#8C2F2F" }}
            >
              Couldn't load responses. Check that the Apps Script is deployed and that
              ORGANISER_CODE in Code.gs matches the code you just entered.
            </div>
          )}
          {Array.isArray(adminData) && rows.length === 0 && (
            <p style={{ color: "#4A5670" }}>No responses yet.</p>
          )}

          {adminTab === "analytics" && rows.length > 0 && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div
                  className="bg-white rounded-xl border p-4 text-center"
                  style={{ borderColor: "#DDE2EA" }}
                >
                  <div className="gs-display text-3xl font-bold">{rows.length}</div>
                  <div className="text-xs" style={{ color: "#8892A6" }}>
                    Responses
                  </div>
                </div>
                <div
                  className="bg-white rounded-xl border p-4 text-center"
                  style={{ borderColor: "#DDE2EA" }}
                >
                  <div className="gs-display text-3xl font-bold">
                    {ranked.reduce((a, [, v]) => a + v.Build, 0)}
                  </div>
                  <div className="text-xs" style={{ color: "#8892A6" }}>
                    Build commitments
                  </div>
                </div>
                <div
                  className="bg-white rounded-xl border p-4 text-center"
                  style={{ borderColor: "#DDE2EA" }}
                >
                  <div className="gs-display text-3xl font-bold">{suggested.length}</div>
                  <div className="text-xs" style={{ color: "#8892A6" }}>
                    Problems suggested
                  </div>
                </div>
              </div>

              <h2 className="gs-display font-bold mb-3">Interest by problem statement</h2>
              <div
                className="bg-white rounded-xl border p-5 mb-6"
                style={{ borderColor: "#DDE2EA" }}
              >
                {ranked.map(([key, v]) => (
                  <div
                    key={key}
                    className="py-2 border-b last:border-b-0"
                    style={{ borderColor: "#EEF1F5" }}
                  >
                    <div className="flex justify-between items-baseline gap-3 text-sm mb-1">
                      <span className="font-medium">{v.title}</span>
                      <span className="gs-display font-bold flex-shrink-0">{v.total}</span>
                    </div>
                    <div className="h-2 rounded-full mb-1.5" style={{ background: "#EEF1F5" }}>
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${(v.total / maxTotal) * 100}%`,
                          background: v.color,
                        }}
                      />
                    </div>
                    <div className="text-xs" style={{ color: "#8892A6" }}>
                      Discuss {v.Discuss} · Research {v.Research} ·{" "}
                      <b style={{ color: INK }}>Build {v.Build}</b>
                    </div>
                  </div>
                ))}
              </div>

              {suggested.length > 0 && (
                <div className="mb-6">
                  <h2 className="gs-display font-bold mb-3">Problems members suggested</h2>
                  <div
                    className="bg-white rounded-xl border p-5"
                    style={{ borderColor: "#DDE2EA" }}
                  >
                    {suggested.map((s, i) => (
                      <div
                        key={i}
                        className="py-2 border-b last:border-b-0 text-sm"
                        style={{ borderColor: "#EEF1F5" }}
                      >
                        <b>{s.name}:</b> {s.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {skillNotes.length > 0 && (
                <div>
                  <h2 className="gs-display font-bold mb-3">Skills & networks in the room</h2>
                  <div
                    className="bg-white rounded-xl border p-5"
                    style={{ borderColor: "#DDE2EA" }}
                  >
                    {skillNotes.map((s, i) => (
                      <div
                        key={i}
                        className="py-2 border-b last:border-b-0 text-sm"
                        style={{ borderColor: "#EEF1F5" }}
                      >
                        <b>{s.name}:</b> {s.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {adminTab === "responses" &&
            rows.map((r, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border p-5 mb-4"
                style={{ borderColor: "#DDE2EA" }}
              >
                <div className="flex justify-between flex-wrap gap-2 mb-2">
                  <span className="gs-display font-bold">{r.name}</span>
                  <span className="text-xs" style={{ color: "#8892A6" }}>
                    {new Date(r.submittedAt).toLocaleString()}
                  </span>
                </div>
                {r.selections?.map((s, j) => (
                  <div key={j} className="text-sm py-1 border-t" style={{ borderColor: "#EEF1F5" }}>
                    {s.title} <span style={{ color: "#8892A6" }}>({s.pillar})</span> —{" "}
                    {(s.modes || []).join(", ")}
                    {s.notes && (
                      <div className="pl-4 italic" style={{ color: "#4A5670" }}>
                        {s.notes}
                      </div>
                    )}
                  </div>
                ))}
                {r.skills && (
                  <div className="text-sm mt-2">
                    <b>Skills & networks:</b> {r.skills}
                  </div>
                )}
                {r.otherProblems && (
                  <div className="text-sm mt-1">
                    <b>Problems we missed:</b> {r.otherProblems}
                  </div>
                )}
              </div>
            ))}

          {adminTab === "responses" && rows.length > 0 && (
            <button
              type="button"
              className="px-4 py-2 rounded-lg border font-medium text-sm"
              style={{ borderColor: "#C9CFDA" }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
                } catch {}
              }}
            >
              Copy all as JSON
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── main form ───────────────────────────────────────────────
  return (
    <div className="gs-body min-h-screen" style={{ background: PAPER, color: INK }}>
      <Fonts />
      <div className="max-w-2xl mx-auto px-5 py-8">
        <div className="mb-8">
          <div
            className="gs-display text-xs font-bold tracking-widest uppercase mb-2"
            style={{ color: "#2F5AA8" }}
          >
            {copy.eyebrow}
          </div>
          <h1 className="gs-display text-3xl sm:text-4xl font-bold leading-tight">
            {copy.headline}
          </h1>
          <p className="mt-2" style={{ color: "#4A5670" }}>
            {fill(copy.intro, { count: ALL.length, pillarCount: pillars.length })}
          </p>
        </div>

        <div
          className="flex items-center gap-1 mb-8"
          aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
        >
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="flex-1 h-1.5 rounded-full"
              style={{ background: i <= step ? INK : "#DDE2EA" }}
            />
          ))}
        </div>
        <div
          className="gs-display text-sm font-bold uppercase tracking-wide mb-4"
          style={{ color: "#8892A6" }}
        >
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </div>

        {/* STEP 0: name */}
        {step === 0 && (
          <div>
            <label className="block">
              <span className="font-semibold">{copy.nameLabel}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={copy.namePlaceholder}
                className="mt-1.5 w-full rounded-lg border px-4 py-2.5 bg-white"
                style={{ borderColor: "#C9CFDA" }}
              />
            </label>
            <Nav showBack={false} />
          </div>
        )}

        {/* STEP 1: select statements */}
        {step === 1 && (
          <div>
            <p className="mb-5" style={{ color: "#4A5670" }}>
              {copy.causesPrompt}
            </p>
            {pillars.map((p) => (
              <div key={p.id} className="mb-6">
                <div className="gs-display font-bold mb-2" style={{ color: p.color }}>
                  {p.name}
                </div>
                <div className="grid gap-2">
                  {p.statements.map((s) => {
                    const on = selected.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleStatement(s.id)}
                        aria-pressed={on}
                        className="gs-card text-left rounded-xl border bg-white px-4 py-3 flex items-start gap-3"
                        style={{
                          borderColor: on ? p.color : "#DDE2EA",
                          boxShadow: on ? `inset 4px 0 0 ${p.color}` : "none",
                        }}
                      >
                        <span
                          className="mt-0.5 w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                          style={{
                            borderColor: on ? p.color : "#C9CFDA",
                            background: on ? p.color : "white",
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span>
                          <span className="font-medium">{s.title}</span>
                          {s.sub && (
                            <span className="block text-sm" style={{ color: "#8892A6" }}>
                              {s.sub}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="text-sm font-medium" style={{ color: "#4A5670" }}>
              {selected.length} selected
            </div>
            <Nav />
          </div>
        )}

        {/* STEP 2: depth per statement */}
        {step === 2 && (
          <div>
            <p className="mb-5" style={{ color: "#4A5670" }}>
              {copy.involvementPrompt}
            </p>
            {selected.map((id) => {
              const s = byId[id];
              if (!s) return null;
              return (
                <div
                  key={id}
                  className="bg-white rounded-xl border p-4 mb-4"
                  style={{ borderColor: "#DDE2EA", boxShadow: `inset 4px 0 0 ${s.color}` }}
                >
                  <div className="font-semibold mb-0.5">{s.title}</div>
                  <div className="text-xs mb-3" style={{ color: "#8892A6" }}>
                    {s.pillar}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {MODES.map((m) => (
                      <Chip
                        key={m.id}
                        title={m.desc}
                        active={(modes[id] || []).includes(m.id)}
                        onClick={() => toggleMode(id, m.id)}
                      >
                        {m.label}
                      </Chip>
                    ))}
                  </div>
                  <div className="text-xs mb-3" style={{ color: "#8892A6" }}>
                    {copy.modesHint}
                  </div>
                  <textarea
                    value={notes[id] || ""}
                    onChange={(e) => setNotes((x) => ({ ...x, [id]: e.target.value }))}
                    placeholder={copy.notesPlaceholder}
                    rows={3}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "#DDE2EA" }}
                  />
                </div>
              );
            })}
            <Nav />
          </div>
        )}

        {/* STEP 3: skills & what we missed */}
        {step === 3 && (
          <div>
            <label className="block mb-6">
              <span className="font-semibold">{copy.skillsLabel}</span>
              <span className="block text-sm mb-1.5" style={{ color: "#8892A6" }}>
                {copy.skillsHelp}
              </span>
              <textarea
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                rows={4}
                className="w-full rounded-lg border px-4 py-2.5 bg-white"
                style={{ borderColor: "#C9CFDA" }}
              />
            </label>

            <label className="block">
              <span className="font-semibold">{copy.missedLabel}</span>
              <span className="block text-sm mb-1.5" style={{ color: "#8892A6" }}>
                {copy.missedHelp}
              </span>
              <textarea
                value={otherProblems}
                onChange={(e) => setOtherProblems(e.target.value)}
                rows={4}
                className="w-full rounded-lg border px-4 py-2.5 bg-white"
                style={{ borderColor: "#C9CFDA" }}
              />
            </label>
            <Nav />
          </div>
        )}

        {/* STEP 4: review */}
        {step === 4 && (
          <div>
            <div
              className="bg-white rounded-xl border p-5 mb-4"
              style={{ borderColor: "#DDE2EA" }}
            >
              <div className="gs-display font-bold mb-2">{name}</div>
              {selected.map((id) => {
                const s = byId[id];
                if (!s) return null;
                return (
                  <div key={id} className="py-2 border-t text-sm" style={{ borderColor: "#EEF1F5" }}>
                    <b>{s.title}</b> — {(modes[id] || []).map(modeLabel).join(", ")}
                    {(notes[id] || "").trim() && (
                      <div className="pl-4 italic" style={{ color: "#4A5670" }}>
                        {notes[id].trim()}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="pt-3 border-t text-sm" style={{ borderColor: "#EEF1F5" }}>
                {skills.trim() && (
                  <div>
                    <b>Skills & networks:</b> {skills.trim()}
                  </div>
                )}
                {otherProblems.trim() && (
                  <div>
                    <b>Problems we missed:</b> {otherProblems.trim()}
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs mb-2" style={{ color: "#8892A6" }}>
              {copy.reviewNote}
            </p>
            <Nav nextLabel={copy.submitLabel} onNext={submit} />
          </div>
        )}

        {error && (
          <div
            className="mt-4 rounded-lg px-4 py-3 text-sm font-medium"
            style={{ background: "#FBEDED", color: "#8C2F2F" }}
          >
            {error}
          </div>
        )}

        <div
          className="mt-12 pt-4 border-t flex justify-between items-center text-xs"
          style={{ borderColor: "#DDE2EA", color: "#8892A6" }}
        >
          <span>{copy.footer}</span>
          <button type="button" onClick={() => setAdminOpen(true)} className="underline">
            Organiser view
          </button>
        </div>
      </div>
    </div>
  );
}
