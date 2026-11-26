// Run: node --test pull-requests/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPullRequests, repoRoot } from "./load.js";

// A stand-in for Herdr's exec: answers from a table keyed by "<command> <args>",
// exit code 1 for anything not in it, and records every call.
function fakeExec(table) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    const hit = table[`${command} ${args.join(" ")}`];
    if (hit === undefined) return { code: 1, stdout: "", stderr: "" };
    if (hit instanceof Error) throw hit;
    return { code: 0, stderr: "", ...hit };
  };
  return { exec, calls };
}

const where = { cwd: "/r", on: null };
const git = (branch, remote) => ({
  "git rev-parse --show-toplevel": { stdout: "/r\n" },
  "git symbolic-ref --short -q HEAD": { stdout: `${branch}\n` },
  "git remote get-url origin": { stdout: `${remote}\n` },
});
const GITHUB = "git@github.com:o/r.git";
const GITLAB = "git@gitlab.com:g/p.git";
const GH_LIST = (branch) =>
  `gh pr list --head ${branch} --state all --limit 20 --json number,title,state,isDraft,headRefName,baseRefName,url,updatedAt,isCrossRepository,headRepositoryOwner,reviewDecision,latestReviews,statusCheckRollup,mergeable`;
const GLAB_LIST = (branch) => `glab mr list --source-branch ${branch} --all -F json --per-page 20`;
const ghPr = { number: 7, title: "T", url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: false,
  headRefName: "feat/a", baseRefName: "main", updatedAt: "2026-11-26T10:00:00Z", isCrossRepository: false,
  reviewDecision: "", latestReviews: [], statusCheckRollup: [], mergeable: "MERGEABLE" };
const glMr = (iid, state = "opened", updated_at = "2026-11-26T10:00:00Z") => ({
  iid, project_id: 99, title: `M${iid}`, web_url: `https://gitlab.com/g/p/-/merge_requests/${iid}`, state,
  draft: false, source_branch: "feat/a", target_branch: "main", updated_at, has_conflicts: false,
  detailed_merge_status: "mergeable" });
const glView = (status) => ({ stdout: JSON.stringify({ head_pipeline: { status, web_url: "https://gitlab.com/p/1" } }) });
const glApprovals = { stdout: JSON.stringify({ approved_by: [{ user: { name: "Jane" } }], approvals_required: 1, approvals_left: 0 }) };

test("not a git repository", async () => {
  const { exec } = fakeExec({});
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: null, text: "Not a git repository" });
});

test("detached HEAD", async () => {
  const { exec } = fakeExec({ "git rev-parse --show-toplevel": { stdout: "/r\n" } });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: null, text: "Not on a branch" });
});

test("falls back to the first remote when there is no origin", async () => {
  const table = { ...git("feat/a", ""), "git remote get-url origin": undefined,
    "git remote": { stdout: "upstream\nother\n" }, "git remote get-url upstream": { stdout: `${GITHUB}\n` },
    [GH_LIST("feat/a")]: { stdout: JSON.stringify([ghPr]) } };
  delete table["git remote get-url origin"];
  const { exec } = fakeExec(table);
  const result = await loadPullRequests(where, exec);
  assert.equal(result.kind, "prs");
  assert.equal(result.provider, "github");
});

test("no remote at all", async () => {
  const table = git("feat/a", "");
  delete table["git remote get-url origin"];
  const { exec } = fakeExec(table);
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "This repo has no remote" });
});

test("a host that is neither GitHub nor GitLab", async () => {
  const { exec } = fakeExec(git("feat/a", "https://x-token-auth:SECRET@bitbucket.org/a/b.git"));
  assert.deepEqual(await loadPullRequests(where, exec),
    { kind: "message", branch: "feat/a", text: "This repo isn't on GitHub or GitLab" });
});

test("GitHub: the branch reaches gh as one argument, cwd and on on every call", async () => {
  const branch = "feat/a b;c";
  const { exec, calls } = fakeExec({ ...git(branch, GITHUB), [GH_LIST(branch)]: { stdout: JSON.stringify([ghPr]) } });
  const result = await loadPullRequests(where, exec);
  assert.equal(result.kind, "prs");
  assert.equal(result.provider, "github");
  assert.equal(result.branch, branch);
  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].ref, "#7");
  const gh = calls.find((c) => c.command === "gh");
  assert.equal(gh.args[gh.args.indexOf("--head") + 1], branch);
  for (const c of calls) {
    assert.equal(c.options.cwd, "/r");
    assert.equal(c.options.on, null);
  }
});

test("a remote machine is passed on to every call", async () => {
  const { exec, calls } = fakeExec({ ...git("feat/a", GITHUB), [GH_LIST("feat/a")]: { stdout: "[]" } });
  await loadPullRequests({ cwd: "/r", on: "devbox" }, exec);
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(c.options.on, "devbox");
});

test("GitHub: no PRs for the branch", async () => {
  const { exec } = fakeExec({ ...git("feat/a", GITHUB), [GH_LIST("feat/a")]: { stdout: "[]" } });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "No pull requests for feat/a" });
});

test("gh not installed", async () => {
  const { exec } = fakeExec({ ...git("feat/a", GITHUB), [GH_LIST("feat/a")]: new Error("not found") });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "gh isn't installed" });
});

test("gh fails: its error is shown without credentials", async () => {
  const { exec } = fakeExec({ ...git("feat/a", GITHUB),
    [GH_LIST("feat/a")]: { code: 1, stdout: "", stderr: "error: https://u:tok@github.com/o/r failed\n" } });
  assert.deepEqual(await loadPullRequests(where, exec),
    { kind: "message", branch: "feat/a", text: "error: https://github.com/o/r failed" });
});

test("gh prints something that isn't JSON", async () => {
  const { exec } = fakeExec({ ...git("feat/a", GITHUB), [GH_LIST("feat/a")]: { stdout: "not json" } });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "Couldn't read gh's answer" });
});

test("git not available", async () => {
  const { exec } = fakeExec({ "git rev-parse --show-toplevel": new Error("spawn git ENOENT") });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: null, text: "git isn't available" });
});

test("GitLab: details for every MR", async () => {
  const { exec, calls } = fakeExec({ ...git("feat/a", GITLAB),
    [GLAB_LIST("feat/a")]: { stdout: JSON.stringify([glMr(12), glMr(11, "merged", "2026-11-20T00:00:00Z")]) },
    "glab mr view 12 -F json": glView("success"), "glab mr view 11 -F json": glView("failed"),
    "glab api projects/99/merge_requests/12/approvals": glApprovals,
    "glab api projects/99/merge_requests/11/approvals": glApprovals });
  const result = await loadPullRequests(where, exec);
  assert.equal(result.kind, "prs");
  assert.equal(result.provider, "gitlab");
  assert.deepEqual(result.prs.map((p) => p.ref), ["!12", "!11"]);
  assert.deepEqual(result.prs[0].pipeline, { status: "passed", url: "https://gitlab.com/p/1" });
  assert.equal(result.prs[1].pipeline.status, "failed");
  assert.deepEqual(result.prs[0].approvals.names, ["Jane"]);
  assert.ok(calls.some((c) => c.command === "glab" && c.args.join(" ") === "api projects/99/merge_requests/12/approvals"));
});

test("GitLab: one failing details call only blanks that part", async () => {
  const { exec } = fakeExec({ ...git("feat/a", GITLAB),
    [GLAB_LIST("feat/a")]: { stdout: JSON.stringify([glMr(12), glMr(11)]) },
    "glab mr view 11 -F json": glView("success"),
    "glab api projects/99/merge_requests/12/approvals": glApprovals,
    "glab api projects/99/merge_requests/11/approvals": glApprovals });
  const result = await loadPullRequests(where, exec);
  const twelve = result.prs.find((p) => p.ref === "!12"), eleven = result.prs.find((p) => p.ref === "!11");
  assert.equal(twelve.pipeline, null);
  assert.deepEqual(twelve.approvals.names, ["Jane"]);
  assert.equal(eleven.pipeline.status, "passed");
  assert.deepEqual(eleven.approvals.names, ["Jane"]);
});

test("GitLab: details for at most five MRs", async () => {
  const mrs = [1, 2, 3, 4, 5].map((i) => glMr(i, "opened", `2026-11-2${i}T00:00:00Z`))
    .concat([glMr(6, "closed", "2026-11-01T00:00:00Z"), glMr(7, "closed", "2026-11-02T00:00:00Z")]);
  const table = { ...git("feat/a", GITLAB), [GLAB_LIST("feat/a")]: { stdout: JSON.stringify(mrs) } };
  for (const i of [1, 2, 3, 4, 5, 6, 7]) {
    table[`glab mr view ${i} -F json`] = glView("success");
    table[`glab api projects/99/merge_requests/${i}/approvals`] = glApprovals;
  }
  const { exec, calls } = fakeExec(table);
  const result = await loadPullRequests(where, exec);
  assert.equal(calls.filter((c) => c.command === "glab" && c.args[0] === "mr" && c.args[1] === "view").length, 5);
  assert.equal(result.prs.length, 7);
  assert.equal(result.prs.find((p) => p.ref === "!6").pipeline, null);
  assert.equal(result.prs.find((p) => p.ref === "!7").pipeline, null);
});

test("GitLab: no MRs and glab missing", async () => {
  let { exec } = fakeExec({ ...git("feat/a", GITLAB), [GLAB_LIST("feat/a")]: { stdout: "[]" } });
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "No merge requests for feat/a" });
  ({ exec } = fakeExec({ ...git("feat/a", GITLAB), [GLAB_LIST("feat/a")]: new Error("not found") }));
  assert.deepEqual(await loadPullRequests(where, exec), { kind: "message", branch: "feat/a", text: "glab isn't installed" });
});

test("GitHub: PRs from the origin owner's fork are kept", async () => {
  const fork = { ...ghPr, isCrossRepository: true, headRepositoryOwner: { login: "me" } };
  const { exec } = fakeExec({ ...git("feat/a", "git@github.com:me/r.git"), [GH_LIST("feat/a")]: { stdout: JSON.stringify([fork]) } });
  const result = await loadPullRequests(where, exec);
  assert.equal(result.kind, "prs");
  assert.equal(result.prs.length, 1);
});

test("repoRoot", async () => {
  let { exec, calls } = fakeExec({ "git rev-parse --show-toplevel": { stdout: "/r\n" } });
  assert.equal(await repoRoot({ cwd: "/r/sub", on: "devbox" }, exec), "/r");
  assert.equal(calls[0].options.cwd, "/r/sub");
  assert.equal(calls[0].options.on, "devbox");
  ({ exec } = fakeExec({}));
  assert.equal(await repoRoot(where, exec), null);
  ({ exec } = fakeExec({ "git rev-parse --show-toplevel": new Error("spawn git ENOENT") }));
  assert.equal(await repoRoot(where, exec), null);
});
