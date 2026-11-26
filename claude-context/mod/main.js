// claude-context: the right end of Herdr's bottom bar. Shows the Claude Code
// session in the focused pane: model and effort, how full its context window
// is, and its estimated cost. Reads the file the herdr-claude-context Claude Code plugin
// writes per Herdr terminal.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { readTextFile, home, theme, window, focused, agents } from "herdr";
import { parseContext, formatTokens, formatCost } from "./context.js";

// The file is tiny and only read for the focused terminal, so a short poll is cheap.
const POLL_MS = 1000;

// The focused terminal on this computer, or null. Remote ids ("machine/t3")
// have their file on that machine, which this mod doesn't read.
function focusedTerminal() {
  const id = focused()?.terminal;
  return id && !id.includes("/") ? id : null;
}

export default class ClaudeContext extends View {
  init(_props, cx) {
    this.texts = {}; // terminal id → file text (null: no file)
    this.load(cx);
    cx.timer.every(POLL_MS, (cx) => {
      if (window()?.visible !== false) this.load(cx);
    });
  }

  load(cx) {
    const id = focusedTerminal();
    if (!id) return;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${home()}/.cache/herdr-claude-context/${id}.json`).catch(() => null);
      if (this.texts[id] !== text) {
        this.texts[id] = text;
        cx.notify();
      }
    });
  }

  color(level, t) {
    return { ok: t.accent, low: t.blocked, critical: t.ansi1 }[level];
  }

  // Herdr re-renders on focus changes, so switching panes switches the figures.
  render() {
    const t = theme();
    const root = h_flex().id("claude-context").size_full().px(14).gap(14).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
    const id = focusedTerminal();
    // Only a live agent: a file left behind by a Claude Code that has since exited shows nothing.
    const c = id && agents().some((a) => a.address === id) ? parseContext(this.texts[id]) : { state: "none" };
    if (c.state !== "ok") return root;

    const fill = this.color(c.level, t);
    const used = c.tokens === null ? "no tokens yet" : `${c.tokens.toLocaleString("en-US")} tokens`;
    const tip = [
      c.effort ? `${c.model}, ${c.effort} effort` : c.model,
      `Context: ${used} of ${c.window.toLocaleString("en-US")} (${c.percent}%)`,
      c.costUsd === null ? null : `Cost: ${formatCost(c.costUsd)} (estimate)`,
    ].filter(Boolean).join("\n");

    return root.tooltip(tip)
      .when(Boolean(c.model), (el) => el.child(h_flex().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().child(c.model))
        .when(Boolean(c.effort), (el) => el.child(div().flex_none().text_color(t.dim).child(c.effort)))))
      .child(h_flex().flex_none().gap(6).items_center()
        .child(div().w(48).h(5).rounded(3).bg(t.hover)
          .child(div().h_full().rounded(3).w(`${c.percent}%`).bg(fill)))
        .child(div().text_color(c.level === "ok" ? t.muted : fill).child(`${c.percent}%`))
        .child(div().text_color(t.dim).child(`${formatTokens(c.tokens)} / ${formatTokens(c.window)}`)))
      .when(c.costUsd !== null, (el) => el.child(div().flex_none().text_color(t.dim).child(formatCost(c.costUsd))));
  }
}
