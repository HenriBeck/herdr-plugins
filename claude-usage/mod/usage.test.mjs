// Run: node --test claude-usage/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsage, formatReset, formatAge, toMs } from "./usage.js";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const nowS = NOW / 1000;
const MIN = 60;

const file = (rateLimits, updatedAt = nowS) => JSON.stringify({ updated_at: updatedAt, rate_limits: rateLimits });
const win = (used, resetsAt = nowS + 3600) => ({ used_percentage: used, resets_at: resetsAt });
const both = (u5, u7) => file({ five_hour: win(u5), seven_day: win(u7) });

test("missing on null, empty, invalid JSON and empty object", () => {
  for (const text of [null, "", "{not json", "{}"]) {
    assert.equal(parseUsage(text, NOW).state, "missing", `text: ${text}`);
  }
});

test("left and level", () => {
  const cases = [[38, 62, "ok"], [80, 20, "low"], [95, 5, "critical"], [140, 0, "critical"]];
  for (const [used, left, level] of cases) {
    const row = parseUsage(both(used, 0), NOW).rows[0];
    assert.equal(row.left, left, `used ${used}`);
    assert.equal(row.level, level, `used ${used}`);
  }
});

test("row order and labels", () => {
  const u = parseUsage(both(10, 20), NOW);
  assert.equal(u.state, "ok");
  assert.deepEqual(u.rows.map((r) => [r.key, r.label]), [["five_hour", "5h"], ["seven_day", "week"]]);
});

test("missing window", () => {
  const u = parseUsage(file({ five_hour: win(10) }), NOW);
  assert.equal(u.state, "ok");
  assert.equal(u.rows[1].key, "seven_day");
  assert.equal(u.rows[1].left, null);
  assert.equal(u.rows[1].level, "none");
});

test("past reset", () => {
  const u = parseUsage(file({ five_hour: win(90, nowS - 60), seven_day: win(10) }), NOW);
  const row = u.rows[0];
  assert.equal(row.reset, true);
  assert.equal(row.left, 100);
  assert.equal(row.level, "ok");
  assert.equal(formatReset(row, NOW), "reset");
});

test("epoch vs ISO", () => {
  assert.equal(toMs(1795700000), toMs(new Date(1795700000000).toISOString()));
  assert.equal(toMs(null), null);
  assert.equal(toMs("not a date"), null);
});

test("stale", () => {
  assert.equal(parseUsage(file({ five_hour: win(10) }, nowS - 31 * MIN), NOW).stale, true);
  assert.equal(parseUsage(file({ five_hour: win(10) }, nowS - 29 * MIN), NOW).stale, false);
});

test("formatReset five_hour", () => {
  const at = (mins) => parseUsage(file({ five_hour: win(10, nowS + mins * MIN) }), NOW).rows[0];
  assert.equal(formatReset(at(100), NOW), "1h40m");
  assert.equal(formatReset(at(12), NOW), "12m");
});

test("formatReset seven_day uses weekday and 24h time", () => {
  const row = parseUsage(file({ seven_day: win(10, nowS + 2 * 24 * 3600) }), NOW).rows[1];
  assert.match(formatReset(row, NOW), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}$/);
});

test("formatAge", () => {
  assert.equal(formatAge(NOW - 45 * MIN * 1000, NOW), "updated 45m ago");
  assert.equal(formatAge(NOW - 125 * MIN * 1000, NOW), "updated 2h ago");
  assert.equal(formatAge(NOW - 3 * 24 * 3600 * 1000, NOW), "updated 3d ago");
});
