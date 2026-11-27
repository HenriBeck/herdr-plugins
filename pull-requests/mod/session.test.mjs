// Run: node --test pull-requests/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrUrl, remoteRepoKey, parseSessionFile, mergePrs } from "./session.js";

test("parsePrUrl", () => {
  assert.deepEqual(parsePrUrl("https://github.com/O/r/pull/7"), {
    provider: "github", host: "github.com", path: "O/r", name: "r", number: 7, url: "https://github.com/O/r/pull/7",
  });
  assert.deepEqual(parsePrUrl("https://gitlab.example.com/g/sub/p/-/merge_requests/12"), {
    provider: "gitlab", host: "gitlab.example.com", path: "g/sub/p", name: "p", number: 12,
    url: "https://gitlab.example.com/g/sub/p/-/merge_requests/12",
  });
  assert.equal(parsePrUrl("https://u:t@gitlab.com/g/p/-/merge_requests/3").url, "https://gitlab.com/g/p/-/merge_requests/3");
  assert.equal(parsePrUrl("https://GitLab.com/g/p/-/merge_requests/3").host, "gitlab.com");
  for (const bad of [
    "https://gitlab.com/g/p/-/merge_requests/new",
    "https://github.com/o/r/pull/7?x",
    "https://github.com/o/r/pull/7/files",
    "https://github.com/o/pull/7",
    "http://github.com/o/r/pull/7",
    "",
    null,
  ]) assert.equal(parsePrUrl(bad), null, String(bad));
});

test("remoteRepoKey", () => {
  assert.equal(remoteRepoKey("git@gitlab.com:Group/Sub/Proj.git"), "gitlab.com/group/sub/proj");
  assert.equal(remoteRepoKey("ssh://git@gitlab.example.com:2222/g/p.git"), "gitlab.example.com/g/p");
  assert.equal(remoteRepoKey("https://user:tok@github.com/o/r.git"), "github.com/o/r");
  assert.equal(remoteRepoKey("https://github.com/o/r/"), "github.com/o/r");
  assert.equal(remoteRepoKey("/local/path"), null);
  assert.equal(remoteRepoKey(""), null);
});

test("parseSessionFile", () => {
  const file = (prs, ended = false) => JSON.stringify({ session_id: "s", ended, prs: prs.map((url) => ({ url, created_at: 1 })) });
  const urls = Array.from({ length: 12 }, (_, i) => `https://github.com/o/r/pull/${i + 1}`);
  assert.deepEqual(parseSessionFile(file(urls)), urls.slice(2).reverse());
  assert.deepEqual(parseSessionFile(file(["https://x.com/a", "https://u:t@github.com/o/r/pull/1"])), ["https://github.com/o/r/pull/1"]);
  assert.deepEqual(parseSessionFile(file(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/1"])), ["https://github.com/o/r/pull/1"]);
  assert.deepEqual(parseSessionFile(file(urls, true)), []);
  for (const t of [null, "", "{", "[]", "null", JSON.stringify({ prs: "x" }), JSON.stringify({ prs: [null, 3] })]) {
    assert.deepEqual(parseSessionFile(t), [], String(t));
  }
});

const pr = (url, extra = {}) => ({
  ref: `#${url.split("/").pop()}`, number: Number(url.split("/").pop()), title: "T", url, state: "open",
  source: "other", target: "main", updatedAt: "2026-11-20T00:00:00Z", pipeline: null, approvals: null, blocker: null,
  ...extra,
});
const prsResult = (prs) => ({ kind: "prs", provider: "github", branch: "feat/a", prs });

test("mergePrs: branch PRs are current; session PRs current when a remote matches, case-insensitively", () => {
  const { prs } = mergePrs({
    branch: prsResult([pr("https://github.com/o/r/pull/7", { source: "feat/a" })]),
    remotes: ["github.com/o/r"],
    session: [pr("https://github.com/O/R/pull/8"), pr("https://github.com/x/y/pull/9")],
    paneBranch: "feat/a",
  });
  assert.deepEqual(prs.map((p) => [p.ref, p.current]), [["#7", true], ["#8", true], ["#9", false]]);
  assert.deepEqual(prs[0].repo, { host: "github.com", path: "o/r", name: "r" });
  assert.deepEqual(prs[2].repo, { host: "github.com", path: "x/y", name: "y" });
});

test("mergePrs: a PR in both lists shows once (case and trailing slash differ)", () => {
  const { prs } = mergePrs({
    branch: prsResult([pr("https://github.com/o/r/pull/7")]),
    remotes: [],
    session: [pr("https://github.com/O/r/pull/7/"), pr("https://github.com/o/r/pull/7")],
    paneBranch: "feat/a",
  });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].current, true);
});

test("mergePrs: order — current first, the pane branch's first among them, then open before merged, newest first; other repos after", () => {
  const { prs } = mergePrs({
    branch: prsResult([
      pr("https://github.com/o/r/pull/1", { state: "merged", source: "feat/a", updatedAt: "2026-11-20T00:00:00Z" }),
      pr("https://github.com/o/r/pull/2", { source: "feat/a", updatedAt: "2026-11-21T00:00:00Z" }),
    ]),
    remotes: ["github.com/o/r"],
    session: [
      pr("https://github.com/o/r/pull/3", { updatedAt: "2026-11-26T00:00:00Z" }),
      pr("https://github.com/x/y/pull/4", { updatedAt: "2026-11-27T00:00:00Z" }),
      pr("https://github.com/x/y/pull/5", { state: "merged", updatedAt: "2026-11-28T00:00:00Z" }),
      pr("https://github.com/o/r/pull/6", { source: "feat/a", updatedAt: "2026-11-25T00:00:00Z" }),
    ],
    paneBranch: "feat/a",
  });
  assert.deepEqual(prs.map((p) => p.ref), ["#6", "#2", "#1", "#3", "#4", "#5"]);
});

test("mergePrs: a branch message becomes the notice above session PRs; no notice when the branch has PRs", () => {
  const session = [pr("https://github.com/x/y/pull/4")];
  const message = mergePrs({ branch: { kind: "message", branch: "main", text: "No merge requests for main" }, remotes: [], session, paneBranch: "main" });
  assert.equal(message.notice, "No merge requests for main");
  assert.deepEqual(message.prs.map((p) => p.ref), ["#4"]);
  const listed = mergePrs({ branch: prsResult([pr("https://github.com/o/r/pull/7")]), remotes: [], session, paneBranch: "feat/a" });
  assert.equal(listed.notice, null);
});

test("mergePrs: an error card sorts after the open ones of its group", () => {
  const { prs } = mergePrs({
    branch: prsResult([]),
    remotes: [],
    session: [
      pr("https://github.com/x/y/pull/10", { state: "unknown", title: "", updatedAt: "", error: "gh failed" }),
      pr("https://github.com/x/y/pull/4"),
    ],
    paneBranch: "feat/a",
  });
  assert.deepEqual(prs.map((p) => p.ref), ["#4", "#10"]);
  assert.equal(prs[1].error, "gh failed");
});

test("mergePrs: a PR whose URL isn't recognised still gets an empty repo", () => {
  const { prs } = mergePrs({ branch: prsResult([pr("https://example.com/7")]), remotes: [], session: [], paneBranch: null });
  assert.deepEqual(prs[0].repo, { host: "", path: "", name: "" });
});
