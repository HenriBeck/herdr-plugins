// Run: node --test claude-context/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContext, formatTokens, formatCost } from "./context.js";

const file = (over = {}) =>
  JSON.stringify({
    updated_at: 1764158400,
    session_id: "s",
    model: "Opus 5.5",
    effort: "high",
    context: { tokens: 84000, window: 200000, percent: 42 },
    cost_usd: 1.234,
    ended: false,
    ...over,
  });

test("none on null, empty, invalid JSON, wrong shape and an ended session", () => {
  for (const text of [null, "", "{not json", "{}", '{"context":{}}', file({ ended: true })]) {
    assert.equal(parseContext(text).state, "none", `text: ${text}`);
  }
});

test("reads model, tokens, window, percent and cost", () => {
  assert.deepEqual(parseContext(file()), {
    state: "ok",
    model: "Opus 5.5",
    effort: "high",
    tokens: 84000,
    window: 200000,
    percent: 42,
    level: "ok",
    costUsd: 1.234,
  });
});

test("effort is null when the file has none (no model request yet, or a model without effort)", () => {
  assert.equal(parseContext(file({ effort: null })).effort, null);
  assert.equal(parseContext(file({ effort: undefined })).effort, null);
});

test("percent comes from tokens when the file has none; no tokens yet reads as 0%", () => {
  assert.equal(parseContext(file({ context: { tokens: 50000, window: 200000, percent: null } })).percent, 25);
  const fresh = parseContext(file({ context: { tokens: null, window: 200000, percent: null }, cost_usd: null }));
  assert.equal(fresh.percent, 0);
  assert.equal(fresh.tokens, null);
  assert.equal(fresh.costUsd, null);
});

test("level: orange from 75% full, red from 90%, clamped to 0..100", () => {
  const cases = [[74, 74, "ok"], [75, 75, "low"], [89, 89, "low"], [90, 90, "critical"], [130, 100, "critical"], [-2, 0, "ok"]];
  for (const [input, percent, level] of cases) {
    const c = parseContext(file({ context: { tokens: 1, window: 200000, percent: input } }));
    assert.equal(c.percent, percent, `percent ${input}`);
    assert.equal(c.level, level, `percent ${input}`);
  }
});

test("formatTokens", () => {
  const cases = [[null, "—"], [0, "0"], [950, "950"], [1000, "1k"], [84321, "84k"], [200000, "200k"], [1000000, "1M"], [1500000, "1.5M"]];
  for (const [n, s] of cases) assert.equal(formatTokens(n), s, `n ${n}`);
});

test("formatCost", () => {
  assert.equal(formatCost(null), "");
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(1.234), "$1.23");
  assert.equal(formatCost(12.5), "$12.50");
});
