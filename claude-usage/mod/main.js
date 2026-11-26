// claude-usage: a sidebar card with how much of the Claude Code 5-hour and
// weekly limits is left. Reads the file statusline-tap.sh writes.
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
      if (text !== this.text) {
        this.text = text;
        cx.notify();
      }
    });
  }

  color(level, t) {
    return { ok: t.accent, low: t.blocked, critical: t.ansi1 }[level] ?? t.dim;
  }

  row(r, now, t) {
    const pct = r.left === null ? "—" : `${r.left}%`;
    return h_flex().h(18).gap(8).items_center()
      .child(div().w(34).flex_none().text_color(t.muted).child(r.label))
      .child(div().flex_1().h(6).rounded(3).bg(t.hover)
        .child(div().h_full().rounded(3).w(`${r.left ?? 0}%`).bg(this.color(r.level, t))))
      .child(div().w(34).flex_none().text_right().text_color(t.foreground).child(pct))
      .child(div().w(68).flex_none().text_right().text_size(11).text_color(t.dim).truncate().child(formatReset(r, now)));
  }

  rail(u, now, t) {
    const tip = u.state === "ok"
      ? u.rows.map((r) => `${r.label} ${r.left === null ? "—" : `${r.left}% left`}${formatReset(r, now) ? ` · ${formatReset(r, now)}` : ""}`).join("\n")
      : "Start Claude Code to load usage";
    return v_flex().id("usage-rail").size_full().items_center().justify_center().gap(2).text_size(11)
      .bg(t.chrome).border_t(1).border_color(t.border).tooltip(tip)
      .children(u.state === "ok"
        ? u.rows.map((r) => div().text_color(this.color(r.level, t)).child(r.left === null ? "—" : `${r.left}`))
        : [div().text_color(t.dim).child("—")]);
  }

  render() {
    const t = theme();
    const now = Date.now();
    const u = parseUsage(this.text, now);
    if (narrow()) return this.rail(u, now, t);
    const root = v_flex().size_full().justify_center().gap(6).px(16).py(8).text_size(12)
      .bg(t.chrome).border_t(1).border_color(t.border);
    if (u.state !== "ok") return root.child(div().text_color(t.dim).child("Start Claude Code to load usage"));
    return root
      .children(u.rows.map((r) => this.row(r, now, t)))
      .when(u.stale, (el) => el.child(div().text_size(11).text_color(t.dim).child(formatAge(u.updatedAtMs, now))));
  }
}
