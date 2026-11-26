// Pure logic for the claude-usage mod: no imports, so `node --test` can load it.
//
// Input is the file statusline-tap.sh writes:
//   { "updated_at": <epoch s>, "rate_limits": { "five_hour": {...}, "seven_day": {...} } }
// where each window is { used_percentage: number, resets_at: epoch s | ISO string }.

const WINDOWS = [
  { key: "five_hour", label: "5h" },
  { key: "seven_day", label: "week" },
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

function levelFor(left) {
  if (left === null) return "none";
  if (left < 10) return "critical";
  if (left < 25) return "low";
  return "ok";
}

function toRow({ key, label }, w, nowMs) {
  const used = typeof w?.used_percentage === "number" ? w.used_percentage : null;
  const resetsAtMs = toMs(w?.resets_at);
  const reset = used !== null && resetsAtMs !== null && resetsAtMs <= nowMs;
  const left = used === null ? null : reset ? 100 : Math.round(Math.min(100, Math.max(0, 100 - used)));
  return { key, label, left, resetsAtMs, reset, level: levelFor(left) };
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
  if (rows.every((r) => r.left === null)) return { state: "missing" };
  const updatedAtMs = toMs(data.updated_at) ?? 0;
  return { state: "ok", updatedAtMs, stale: nowMs - updatedAtMs > STALE_MS, rows };
}

/** "reset", "1h40m" / "12m" for the 5h window, "Mon 09:00" for the week. */
export function formatReset(row, nowMs) {
  if (row.reset) return "reset";
  if (row.resetsAtMs === null) return "";
  if (row.key === "five_hour") {
    const mins = Math.max(0, Math.round((row.resetsAtMs - nowMs) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
  }
  // Built by hand: Herdr's script runtime may not carry full Intl locale data.
  const d = new Date(row.resetsAtMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "updated 45m ago", "updated 2h ago", "updated 3d ago". */
export function formatAge(updatedAtMs, nowMs) {
  const mins = Math.max(0, Math.floor((nowMs - updatedAtMs) / 60000));
  if (mins < 60) return `updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}
