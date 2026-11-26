// Pure logic for the claude-usage mod: no imports, so `node --test` can load it.
//
// Input is the file statusline-tap.sh writes:
//   { "updated_at": <epoch s>, "rate_limits": { "five_hour": {...}, "seven_day": {...} } }
// where each window is { used_percentage: number, resets_at: epoch s | ISO string }.

const WINDOWS = [
  { key: "five_hour", label: "Current session" },
  { key: "seven_day", label: "Current week" },
];
const STALE_MS = 30 * 60 * 1000;

/** Epoch seconds, epoch ms or an ISO string → ms; anything else → null. */
export function toMs(v) {
  if (typeof v === "number") return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

// Thresholds on % used: orange from 75, red from 90.
function levelFor(used) {
  if (used === null) return "none";
  if (used >= 90) return "critical";
  if (used >= 75) return "low";
  return "ok";
}

function toRow({ key, label }, w, nowMs) {
  const raw = typeof w?.used_percentage === "number" ? w.used_percentage : null;
  const resetsAtMs = toMs(w?.resets_at);
  const reset = raw !== null && resetsAtMs !== null && resetsAtMs <= nowMs;
  const used = raw === null ? null : reset ? 0 : Math.round(Math.min(100, Math.max(0, raw)));
  return { key, label, used, resetsAtMs, reset, level: levelFor(used) };
}

export function parseUsage(text, nowMs) {
  let data;
  try {
    data = JSON.parse(text ?? "");
  } catch {
    return { state: "missing" };
  }
  const limits = data?.rate_limits;
  if (!limits || typeof limits !== "object") return { state: "missing" };
  const rows = WINDOWS.map((w) => toRow(w, limits[w.key], nowMs));
  if (rows.every((r) => r.used === null)) return { state: "missing" };
  const updatedAtMs = toMs(data.updated_at) ?? 0;
  return { state: "ok", updatedAtMs, stale: nowMs - updatedAtMs > STALE_MS, rows };
}

/** Claude's /usage wording: "Resets 6:30pm" for the session, "Resets Dec 3, 8pm" for the week. */
export function formatReset(row, _nowMs) {
  if (row.reset) return "Reset";
  if (row.resetsAtMs === null) return "";
  // Built by hand: Herdr's script runtime may not carry full Intl locale data.
  const d = new Date(row.resetsAtMs);
  const h = d.getHours() % 12 || 12;
  const mins = d.getMinutes();
  const time = `${h}${mins ? `:${String(mins).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
  return row.key === "five_hour" ? `Resets ${time}` : `Resets ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "updated 45m ago", "updated 2h ago", "updated 3d ago". */
export function formatAge(updatedAtMs, nowMs) {
  const mins = Math.max(0, Math.floor((nowMs - updatedAtMs) / 60000));
  if (mins < 60) return `updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}
