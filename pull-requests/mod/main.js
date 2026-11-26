// pull-requests: a side panel (next to Files and Changes) listing the GitHub pull
// requests or GitLab merge requests of the focused pane's branch, with their
// pipeline, approvals and state. Data comes from gh / glab (see load.js).
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, layout, window, theme, exec, checking } from "herdr";
import { loadPullRequests, repoRoot } from "./load.js";
import { pipelineLabel, approvalsLabel, ageLabel, refreshDue } from "./prs.js";

// Kept answers and folder → repo lookups; the oldest go first past these.
const MAX_CACHED = 50, MAX_ROOTS = 200;

function remember(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The focused pane's folder, branch and machine: the same way Herdr's changes mod finds them.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on, branch: pane?.branch ?? null };
}

// Only fetch while someone can see the panel.
function shown() {
  const root = layout();
  const panel = find(root, "panel"), body = find(root, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === "pull-requests" && window()?.visible !== false);
}

export default class PullRequests extends View {
  init(_props, cx) {
    this.cache = new Map(); // key → { result, at }
    this.loading = new Set(); // keys being fetched
    this.roots = new Map(); // [on, cwd] → repo root (null: not a repo)
    this.resolving = new Set(); // [on, cwd] being looked up
    this.wasShown = false;
    if (checking()) return; // `herdr-app check` runs init for real: no gh / glab calls there.
    cx.timer.every(1000, (cx) => this.tick(cx));
  }

  // The cache key: the repo, not the folder, so moving around inside a repo
  // keeps its answer. Undefined until the folder's repo root is known.
  keyFor(where) {
    const folder = JSON.stringify([where.on, where.cwd]);
    if (!this.roots.has(folder)) return undefined;
    return JSON.stringify([where.on, this.roots.get(folder) ?? where.cwd, where.branch]);
  }

  tick(cx, force = false) {
    const now = shown(), justShown = now && !this.wasShown;
    if (!now) {
      this.wasShown = false;
      return;
    }
    const where = location();
    if (!where.cwd) return;
    const key = this.keyFor(where);
    if (key === undefined) {
      this.resolve(where, cx); // ticks again once the root is known
      return;
    }
    this.wasShown = true;
    const keyChanged = key !== this.key;
    if (keyChanged) {
      this.key = key;
      cx.notify(); // the header follows focus straight away
    }
    if (this.loading.has(key)) return;
    const cachedAt = this.cache.get(key)?.at ?? null;
    if (refreshDue({ cachedAt, now: Date.now(), force, justShown, keyChanged })) this.refresh(key, where, cx);
  }

  resolve(where, cx) {
    const folder = JSON.stringify([where.on, where.cwd]);
    if (this.resolving.has(folder)) return;
    this.resolving.add(folder);
    cx.spawn(async (cx) => {
      remember(this.roots, folder, await repoRoot(where, exec), MAX_ROOTS);
      this.resolving.delete(folder);
      this.tick(cx);
      cx.notify();
    });
  }

  refresh(key, where, cx) {
    this.loading.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await loadPullRequests({ cwd: where.cwd, on: where.on }, exec);
      // Stored under its own key: render looks up the focused one, so a late
      // answer for another pane never shows here.
      remember(this.cache, key, { result, at: Date.now() }, MAX_CACHED);
      this.loading.delete(key);
      cx.notify();
    });
  }

  pipelineColor(status, t) {
    return { passed: t.accent, failed: t.ansi1, running: t.muted, manual: t.muted }[status] ?? t.dim;
  }

  card(pr, t) {
    const done = pr.state === "merged" || pr.state === "closed";
    const open = (url) => (_e, cx) => {
      cx.stop_propagation();
      if (url) cx.open_url(url);
    };
    return v_flex().id(`pr-${pr.ref}`).flex_none().p(10).gap(4).rounded(8).cursor_pointer()
      .border_1().border_color(t.border).hover((s) => s.bg(t.hover))
      .text_color(done ? t.dim : t.foreground)
      .on_click(open(pr.url))
      .child(h_flex().min_w(0).gap(6)
        .child(div().flex_none().text_color(t.dim).child(pr.ref))
        .child(div().min_w(0).truncate().font_medium().child(pr.title)))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${pr.state} · ${pr.source} → ${pr.target}`))
      .when(Boolean(pr.pipeline), (el) => el.child(h_flex().id(`pipeline-${pr.ref}`).gap(6).items_center().text_size(11.5)
        .text_color(done ? t.dim : this.pipelineColor(pr.pipeline.status, t))
        .when(Boolean(pr.pipeline.url), (el) => el.on_click(open(pr.pipeline.url)))
        .child(div().size(6).rounded(3).flex_none().bg(this.pipelineColor(pr.pipeline.status, t)))
        .child(pipelineLabel(pr.pipeline.status))))
      .when(Boolean(pr.approvals), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.muted)
        .child(approvalsLabel(pr.approvals))))
      .when(Boolean(pr.blocker) && !done, (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(pr.blocker)));
  }

  render(cx) {
    const t = theme();
    const where = location();
    const key = where.cwd ? this.keyFor(where) : null;
    const cached = key ? this.cache.get(key) : null;
    const loading = key ? this.loading.has(key) : false;
    const result = cached?.result;
    const branch = result?.branch ?? where.branch;

    let body;
    if (!where.cwd) body = "No focused pane";
    else if (!result) body = "Loading…";
    else if (result.kind === "message") body = result.text;

    return v_flex().id("pull-requests").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("PRs"))
        .when(Boolean(branch), (el) => el.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(branch)))
        .child(div().flex_1())
        .when(Boolean(cached), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ageLabel(Date.now() - cached.at))))
        .child(div().id("pr-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.tick(cx, true))
          .child(svg("mods/pull-requests/refresh.svg").size(14).when(loading, (el) => el.spin(900)))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("pr-list").absolute().inset_0().overflow_y_scroll().p(8).gap(8)
          .when(body !== undefined, (el) => el.child(div().p(6).text_color(t.dim).child(body)))
          .when(body === undefined, (el) => el.children(result.prs.map((pr) => this.card(pr, t)))))
        .child(Scrollbar.vertical("pr-list").absolute().inset_0()));
  }
}
