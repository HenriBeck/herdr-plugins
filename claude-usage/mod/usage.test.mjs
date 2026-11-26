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
// A local wall-clock time as epoch ms, so expectations don't depend on the test machine's zone.
const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const rowAt = (key, ms) => ({ key, reset: false, resetsAtMs: ms });

test("missing on null, empty, invalid JSON and empty object", () => {
  for (const text of [null, "", "{not json", "{}"]) {
    assert.equal(parseUsage(text, NOW).state, "missing", `text: ${text}`);
  }
});

test("used and level, like Claude's /usage", () => {
  const cases = [[38.4, 38, "ok"], [74, 74, "ok"], [75, 75, "low"], [89, 89, "low"], [90, 90, "critical"], [140, 100, "critical"], [-3, 0, "ok"]];
  for (const [input, used, level] of cases) {
    const row = parseUsage(both(input, 0), NOW).rows[0];
    assert.equal(row.used, used, `used ${input}`);
    assert.equal(row.level, level, `used ${input}`);
  }
});

test("row order and labels match Claude's /usage", () => {
  const u = parseUsage(both(10, 20), NOW);
  assert.equal(u.state, "ok");
  assert.deepEqual(u.rows.map((r) => [r.key, r.label]), [["five_hour", "Current session"], ["seven_day", "Current week"]]);
});

test("missing window", () => {
  const u = parseUsage(file({ five_hour: win(10) }), NOW);
  assert.equal(u.state, "ok");
  assert.equal(u.rows[1].key, "seven_day");
  assert.equal(u.rows[1].used, null);
  assert.equal(u.rows[1].level, "none");
});

test("past reset counts as nothing used", () => {
  const u = parseUsage(file({ five_hour: win(90, nowS - 60), seven_day: win(10) }), NOW);
  const row = u.rows[0];
  assert.equal(row.reset, true);
  assert.equal(row.used, 0);
  assert.equal(row.level, "ok");
  assert.equal(formatReset(row, NOW), "Reset");
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

test("formatReset session: clock time, minutes only when not on the hour", () => {
  assert.equal(formatReset(rowAt("five_hour", local(2026, 11, 26, 18, 30)), NOW), "Resets 6:30pm");
  assert.equal(formatReset(rowAt("five_hour", local(2026, 11, 26, 19, 0)), NOW), "Resets 7pm");
  assert.equal(formatReset(rowAt("five_hour", local(2026, 11, 26, 0, 5)), NOW), "Resets 12:05am");
  assert.equal(formatReset(rowAt("five_hour", local(2026, 11, 26, 12, 0)), NOW), "Resets 12pm");
});

test("formatReset week: date and clock time", () => {
  assert.equal(formatReset(rowAt("seven_day", local(2026, 12, 3, 20, 0)), NOW), "Resets Dec 3, 8pm");
  assert.equal(formatReset(rowAt("seven_day", local(2026, 12, 3, 9, 15)), NOW), "Resets Dec 3, 9:15am");
});

test("formatReset without a time", () => {
  assert.equal(formatReset(rowAt("seven_day", null), NOW), "");
});

test("formatAge", () => {
  assert.equal(formatAge(NOW - 45 * MIN * 1000, NOW), "updated 45m ago");
  assert.equal(formatAge(NOW - 125 * MIN * 1000, NOW), "updated 2h ago");
  assert.equal(formatAge(NOW - 3 * 24 * 3600 * 1000, NOW), "updated 3d ago");
});
