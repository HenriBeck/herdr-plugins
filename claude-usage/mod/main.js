// claude-usage: a sidebar card with how much of the Claude Code 5-hour and
// weekly limits is used, worded like Claude Code's /usage. Reads the file the herdr-claude-usage Claude Code plugin writes.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { readTextFile, home, theme, layout, window } from "herdr";
import { parseUsage, formatReset, formatAge } from "./usage.js";

const POLL_MS = 15000;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same rule as workspace-chrome: the rail goes by the sidebar's width.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.text = null;
    this.load(cx);
    cx.timer.every(POLL_MS, (cx) => {
      if (window()?.visible !== false) this.load(cx);
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${home()}/.cache/herdr-claude-usage.json`).catch(() => null);
      // Redraw on new data, and once a minute anyway: countdowns, "reset" and
      // "updated … ago" depend on the clock, which Herdr doesn't redraw for.
      const minute = Math.floor(Date.now() / 60000);
      if (text !== this.text || minute !== this.minute) {
        this.text = text;
        this.minute = minute;
        cx.notify();
      }
    });
  }

  color(level, t) {
    return { ok: t.accent, low: t.blocked, critical: t.ansi1 }[level] ?? t.dim;
  }

  // Like Claude's /usage: label and "% used" on one line, the bar, then when it
  // resets. `note` goes right-aligned on the reset line, so the card's height never changes.
  row(r, now, t, note) {
    const pct = r.used === null ? "—" : `${r.used}% used`;
    return v_flex().gap(4)
      .child(h_flex().justify_between().items_center()
        .child(div().text_color(t.foreground).truncate().child(r.label))
        .child(div().flex_none().text_color(r.level === "ok" || r.level === "none" ? t.muted : this.color(r.level, t)).child(pct)))
      .child(div().w_full().h(6).rounded(3).bg(t.hover)
        .child(div().h_full().rounded(3).w(`${r.used ?? 0}%`).bg(this.color(r.level, t))))
      .child(h_flex().justify_between().gap(8).text_size(11).text_color(t.dim)
        .child(div().truncate().child(formatReset(r, now) || " "))
        .when(Boolean(note), (el) => el.child(div().flex_none().child(note))));
  }

  rail(u, now, t) {
    const tip = u.state === "ok"
      ? u.rows.map((r) => `${r.label}: ${r.used === null ? "—" : `${r.used}% used`}${formatReset(r, now) ? ` · ${formatReset(r, now)}` : ""}`).join("\n")
      : "Start Claude Code to load usage";
    return v_flex().id("usage-rail").size_full().items_center().justify_center().gap(2).text_size(11)
      .bg(t.chrome).border_t(1).border_color(t.border).tooltip(tip)
      .children(u.state === "ok"
        ? u.rows.map((r) => div().text_color(this.color(r.level, t)).child(r.used === null ? "—" : `${r.used}%`))
        : [div().text_color(t.dim).child("—")]);
  }

  render() {
    const t = theme();
    const now = Date.now();
    const u = parseUsage(this.text, now);
    if (narrow()) return this.rail(u, now, t);
    const root = v_flex().size_full().justify_center().gap(10).px(16).py(10).text_size(12)
      .bg(t.chrome).border_t(1).border_color(t.border);
    if (u.state !== "ok") return root.child(div().text_color(t.dim).child("Start Claude Code to load usage"));
    const age = u.stale ? formatAge(u.updatedAtMs, now) : null;
    return root.children(u.rows.map((r, i) => this.row(r, now, t, i === 0 ? age : null)));
  }
}
