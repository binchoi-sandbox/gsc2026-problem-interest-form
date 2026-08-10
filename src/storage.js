// ─────────────────────────────────────────────────────────────
// Storage adapter
// ─────────────────────────────────────────────────────────────
// Claude artifact shared storage when available, otherwise the
// Apps Script endpoint. Both paths surface failures to the caller so
// the form can offer the copy-to-clipboard fallback instead of
// telling someone their answers were saved when they weren't.

import { SCRIPT_URL } from "./config.js";

export async function saveResponse(data) {
  if (typeof window !== "undefined" && window.storage) {
    const key = `responses:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await window.storage.set(key, JSON.stringify(data), true);
    return;
  }

  if (!SCRIPT_URL) throw new Error("No storage backend configured");

  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    // text/plain deliberately: it avoids the CORS preflight that Apps
    // Script web apps can't answer. Don't "fix" this to application/json.
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(data),
  });

  if (!res.ok) throw new Error(`Save failed: ${res.status}`);

  // Apps Script returns 200 with an error page when the script itself
  // throws, so the status alone isn't proof the row landed.
  const body = await res.json().catch(() => null);
  if (!body?.ok) throw new Error(body?.error || "Save failed: unexpected response");
}

export async function loadResponses(code) {
  if (typeof window !== "undefined" && window.storage) {
    const rows = [];
    try {
      const res = await window.storage.list("responses:", true);
      for (const k of res?.keys || []) {
        try {
          const item = await window.storage.get(k, true);
          if (item?.value) rows.push(JSON.parse(item.value));
        } catch {}
      }
    } catch {}
    return rows;
  }

  if (!SCRIPT_URL) return [];

  const res = await fetch(
    `${SCRIPT_URL}?mode=responses&code=${encodeURIComponent(code || "")}`
  );
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);

  const body = await res.json();
  if (body?.error) throw new Error(body.error);
  return Array.isArray(body) ? body : [];
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
