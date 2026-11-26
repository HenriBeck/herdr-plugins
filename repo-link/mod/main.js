// repo-link: the right end of Herdr's tab bar. A "GitHub" or "GitLab" button
// that opens the focused pane's repository in the browser. The repository
// comes from the folder's git remote (see repo.js).
import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, window, theme, exec, checking } from "herdr";
import { loadRepo } from "./repo.js";

const POLL_MS = 1000;
// Remotes rarely change: a folder's answer is asked again after this long.
const STALE_MS = 60000;
// Kept folder → repo answers; the oldest go first past this.
const MAX_FOLDERS = 200;

const NAMES = { github: "GitHub", gitlab: "GitLab" };

// The focused pane's folder and machine: the same way Herdr's changes mod finds them.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}

const keyFor = (where) => JSON.stringify([where.on, where.cwd]);

export default class RepoLink extends View {
  init(_props, cx) {
    this.repos = new Map(); // key → { repo: Repo | null, at }
    this.loading = new Set(); // keys being looked up
    if (checking()) return; // `herdr-app check` runs init for real: no git calls there.
    this.tick(cx);
    cx.timer.every(POLL_MS, (cx) => {
      if (window()?.visible !== false) this.tick(cx);
    });
  }

  tick(cx) {
    const where = location();
    if (!where.cwd) return;
    const key = keyFor(where);
    const known = this.repos.get(key);
    if (this.loading.has(key) || (known && Date.now() - known.at < STALE_MS)) return;
    this.loading.add(key);
    cx.spawn(async (cx) => {
      const repo = await loadRepo(where, exec);
      const changed = JSON.stringify(known?.repo) !== JSON.stringify(repo);
      this.repos.delete(key);
      this.repos.set(key, { repo, at: Date.now() });
      if (this.repos.size > MAX_FOLDERS) this.repos.delete(this.repos.keys().next().value);
      this.loading.delete(key);
      if (changed) cx.notify();
    });
  }

  // Herdr re-renders on focus changes, so switching panes switches the link.
  render() {
    const t = theme();
    const root = h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border);
    const where = location();
    const repo = where.cwd ? this.repos.get(keyFor(where))?.repo : null;
    if (!repo) return root;
    return root.child(h_flex().id("repo-link").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`Open ${repo.path} on ${repo.host}`)
      // The tab bar's block drags the window: a press here is a click.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.open_url(repo.url))
      .child(svg(`mods/repo-link/${repo.provider}.svg`).size(14))
      .child(NAMES[repo.provider]));
  }
}
