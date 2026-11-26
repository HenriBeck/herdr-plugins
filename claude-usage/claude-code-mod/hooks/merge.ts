// Pure merge logic: no engine calls, so it is easy to read and test.
//
// The file the Herdr card reads:
//   { "updated_at": <epoch s>, "rate_limits": { "five_hour": {...}, "seven_day": {...} } }
// each window { used_percentage: number, resets_at: epoch s }.

import type { SessionRateLimit } from 'claude-code'

export type Window = { used_percentage: number; resets_at: number }
export type Windows = Record<string, Window>
export type SavedFile = { updated_at: number; rate_limits: Windows }

const KINDS = ['five_hour', 'seven_day']

/** Epoch seconds, epoch ms or an ISO string → epoch seconds; anything else → null. */
function toSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v : Math.floor(v / 1000)
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
  }
  return null
}

/** The saved windows, or {} when the text is missing, corrupt or another shape. */
export function readWindows(text: string | null): Windows {
  let data: unknown
  try {
    data = JSON.parse(text ?? '')
  } catch {
    return {}
  }
  const limits = (data as { rate_limits?: unknown } | null)?.rate_limits
  if (!limits || typeof limits !== 'object') return {}
  const out: Windows = {}
  for (const [kind, w] of Object.entries(limits as Record<string, unknown>)) {
    const used = (w as { used_percentage?: unknown })?.used_percentage
    const resets = toSeconds((w as { resets_at?: unknown })?.resets_at)
    if (typeof used === 'number' && resets !== null) out[kind] = { used_percentage: used, resets_at: resets }
  }
  return out
}

/** The engine's windows we save, in the file's shape. */
export function fromEngine(limits: readonly SessionRateLimit[]): Windows {
  const out: Windows = {}
  for (const l of limits) {
    const resets = toSeconds(l.resetsAt)
    if (KINDS.includes(l.kind) && resets !== null) out[l.kind] = { used_percentage: l.percentUsed, resets_at: resets }
  }
  return out
}

// Every open session reports its own last snapshot, so per window: a later
// reset wins; within the same window the higher usage wins (it only grows).
function pick(saved: Window | undefined, next: Window | undefined): Window | undefined {
  if (!next) return saved
  if (!saved) return next
  if (next.resets_at > saved.resets_at) return next
  if (next.resets_at === saved.resets_at && next.used_percentage > saved.used_percentage) return next
  return saved
}

const same = (a: Windows, b: Windows) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
const sorted = (w: Windows) => Object.keys(w).sort().map(k => [k, w[k].used_percentage, w[k].resets_at])

/** The new file, or null when there is nothing new to save. */
export function merge(savedText: string | null, limits: readonly SessionRateLimit[], nowS: number): SavedFile | null {
  const saved = readWindows(savedText)
  const incoming = fromEngine(limits)
  if (Object.keys(incoming).length === 0) return null
  const merged: Windows = {}
  for (const kind of new Set([...Object.keys(saved), ...Object.keys(incoming)])) {
    const w = pick(saved[kind], incoming[kind])
    if (w) merged[kind] = w
  }
  return same(merged, saved) ? null : { updated_at: nowS, rate_limits: merged }
}
