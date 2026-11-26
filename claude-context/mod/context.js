// Pure logic for the claude-context mod: no imports, so `node --test` can load it.
//
// Input is the file the herdr-claude-context Claude Code plugin writes per Herdr terminal:
//   { updated_at, session_id, model, effort, context: { tokens, window, percent }, cost_usd, ended }

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Same thresholds as the usage card: orange from 75% full, red from 90%.
function levelFor(percent) {
  if (percent >= 90) return "critical";
  if (percent >= 75) return "low";
  return "ok";
}

export function parseContext(text) {
  let data;
  try {
    data = JSON.parse(text ?? "");
  } catch {
    return { state: "none" };
  }
  const window = num(data?.context?.window);
  if (!window || data.ended === true) return { state: "none" };
  const tokens = num(data.context.tokens);
  const raw = num(data.context.percent) ?? (tokens === null ? 0 : (tokens / window) * 100);
  const percent = Math.round(Math.min(100, Math.max(0, raw)));
  return {
    state: "ok",
    model: typeof data.model === "string" ? data.model : "",
    effort: typeof data.effort === "string" ? data.effort : null,
    tokens,
    window,
    percent,
    level: levelFor(percent),
    costUsd: num(data.cost_usd),
  };
}

/** 950 → "950", 84321 → "84k", 1500000 → "1.5M"; null → "—". */
export function formatTokens(n) {
  if (n === null) return "—";
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** "$1.23"; null → "". */
export function formatCost(usd) {
  return usd === null ? "" : `$${usd.toFixed(2)}`;
}
