// Run: node --test pull-requests/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRemoteHost,
  providerFor,
  scrub,
  firstLine,
  summarizeGithub,
  summarizeGitlabList,
  withGitlabDetails,
  sortPrs,
  parseRemoteOwner,
  refreshDue,
  pipelineLabel,
  approvalsLabel,
  ageLabel,
} from "./prs.js";

test("parseRemoteHost", () => {
  assert.equal(parseRemoteHost("git@github.com:HenriBeck/herdr-plugins.git"), "github.com");
  assert.equal(parseRemoteHost("ssh://git@gitlab.example.com:2222/a/b.git"), "gitlab.example.com");
  assert.equal(parseRemoteHost("https://x-token-auth:SECRET@bitbucket.org/a/b.git"), "bitbucket.org");
  assert.equal(parseRemoteHost("https://GitLab.com/a/b"), "gitlab.com");
  assert.equal(parseRemoteHost("/some/local/path"), null);
  assert.equal(parseRemoteHost(""), null);
});

test("providerFor", () => {
  assert.equal(providerFor("github.com"), "github");
  assert.equal(providerFor("gitlab.com"), "gitlab");
  assert.equal(providerFor("gitlab.example.com"), "gitlab");
  assert.equal(providerFor("bitbucket.org"), null);
  assert.equal(providerFor(null), null);
});

test("scrub and firstLine never leak userinfo", () => {
  assert.equal(scrub("fatal: https://u:tok@host/x.git"), "fatal: https://host/x.git");
  assert.equal(firstLine("\n  error: https://u:tok@h/r  \nmore"), "error: https://h/r");
  assert.equal(firstLine("x".repeat(300)).length, 200);
});

const gh = {
  number: 7,
  title: "T",
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  isDraft: false,
  headRefName: "feat/a",
  baseRefName: "main",
  updatedAt: "2026-11-26T10:00:00Z",
  isCrossRepository: false,
  reviewDecision: "",
  latestReviews: [],
  statusCheckRollup: [],
  mergeable: "MERGEABLE",
};

test("summarizeGithub: an open PR without checks or reviews", () => {
  const [pr] = summarizeGithub([gh]);
  assert.deepEqual(pr, {
    ref: "#7",
    number: 7,
    title: "T",
    url: gh.url,
    state: "open",
    source: "feat/a",
    target: "main",
    updatedAt: gh.updatedAt,
    pipeline: { status: "none", url: `${gh.url}/checks` },
    approvals: { names: [], required: null, left: null, decision: null },
    blocker: null,
  });
});

test("summarizeGithub: check rollup", () => {
  const status = (rollup) => summarizeGithub([{ ...gh, statusCheckRollup: rollup }])[0].pipeline.status;
  const run = (status, conclusion) => ({ __typename: "CheckRun", status, conclusion });
  const ctx = (state) => ({ __typename: "StatusContext", state });
  assert.equal(status([run("COMPLETED", "SUCCESS")]), "passed");
  assert.equal(status([run("COMPLETED", "SUCCESS"), run("IN_PROGRESS", "")]), "running");
  assert.equal(status([run("IN_PROGRESS", ""), ctx("FAILURE")]), "failed");
  assert.equal(status([ctx("PENDING")]), "running");
  assert.equal(status([run("COMPLETED", "SKIPPED")]), "passed");
  assert.equal(status([run("COMPLETED", "TIMED_OUT")]), "failed");
  assert.equal(status([ctx("ERROR")]), "failed");
});

test("summarizeGithub: states, reviews, blockers, forks", () => {
  assert.equal(summarizeGithub([{ ...gh, isDraft: true }])[0].state, "draft");
  assert.equal(summarizeGithub([{ ...gh, state: "MERGED" }])[0].state, "merged");
  assert.equal(summarizeGithub([{ ...gh, state: "CLOSED" }])[0].state, "closed");
  const reviewed = summarizeGithub([
    {
      ...gh,
      reviewDecision: "APPROVED",
      latestReviews: [
        { author: { login: "jane" }, state: "APPROVED" },
        { author: { login: "bob" }, state: "COMMENTED" },
      ],
    },
  ])[0];
  assert.deepEqual(reviewed.approvals, { names: ["jane"], required: null, left: null, decision: "approved" });
  assert.equal(summarizeGithub([{ ...gh, reviewDecision: "REVIEW_REQUIRED" }])[0].approvals.decision, "review required");
  assert.equal(summarizeGithub([{ ...gh, mergeable: "CONFLICTING" }])[0].blocker, "conflicts");
  assert.equal(summarizeGithub([{ ...gh, reviewDecision: "CHANGES_REQUESTED" }])[0].blocker, "changes requested");
  assert.deepEqual(summarizeGithub([{ ...gh, isCrossRepository: true }]), []);
});

test("summarizeGithub: garbage input does not throw", () => {
  assert.deepEqual(summarizeGithub(null), []);
  const [pr] = summarizeGithub([{ number: 1 }]);
  assert.equal(pr.title, "");
  assert.equal(pr.state, "closed");
  assert.equal(pr.pipeline.status, "none");
});

const mr = {
  iid: 12,
  project_id: 99,
  title: "M",
  web_url: "https://gitlab.com/g/p/-/merge_requests/12",
  state: "opened",
  draft: false,
  source_branch: "feat/a",
  target_branch: "main",
  updated_at: "2026-11-26T10:00:00Z",
  has_conflicts: false,
  detailed_merge_status: "mergeable",
};

test("summarizeGitlabList", () => {
  const [pr] = summarizeGitlabList([mr]);
  assert.equal(pr.ref, "!12");
  assert.equal(pr.number, 12);
  assert.equal(pr.projectId, 99);
  assert.equal(pr.state, "open");
  assert.equal(pr.url, mr.web_url);
  assert.equal(pr.source, "feat/a");
  assert.equal(pr.target, "main");
  assert.equal(pr.pipeline, null);
  assert.equal(pr.approvals, null);
  assert.equal(pr.blocker, null);
  assert.equal(summarizeGitlabList([{ ...mr, draft: true }])[0].state, "draft");
  assert.equal(summarizeGitlabList([{ ...mr, state: "merged" }])[0].state, "merged");
  assert.equal(summarizeGitlabList([{ ...mr, state: "locked" }])[0].state, "closed");
  assert.equal(summarizeGitlabList([{ ...mr, has_conflicts: true }])[0].blocker, "conflicts");
  assert.equal(summarizeGitlabList([{ ...mr, detailed_merge_status: "requested_changes" }])[0].blocker, "changes requested");
  assert.deepEqual(summarizeGitlabList(null), []);
});

test("withGitlabDetails", () => {
  const [pr] = summarizeGitlabList([mr]);
  const full = withGitlabDetails(
    pr,
    { head_pipeline: { status: "success", web_url: "https://gitlab.com/p/1" } },
    { approved_by: [{ user: { name: "Jane Doe" } }], approvals_required: 2, approvals_left: 1 },
  );
  assert.deepEqual(full.pipeline, { status: "passed", url: "https://gitlab.com/p/1" });
  assert.deepEqual(full.approvals, { names: ["Jane Doe"], required: 2, left: 1, decision: null });
  assert.equal(pr.pipeline, null, "the input is not changed");
  const map = (s) => withGitlabDetails(pr, { head_pipeline: { status: s, web_url: null } }, null).pipeline.status;
  assert.equal(map("failed"), "failed");
  assert.equal(map("running"), "running");
  assert.equal(map("pending"), "running");
  assert.equal(map("created"), "running");
  assert.equal(map("manual"), "manual");
  assert.equal(map("canceled"), "canceled");
  assert.equal(map("skipped"), "canceled");
  assert.deepEqual(withGitlabDetails(pr, { head_pipeline: null }, null).pipeline, { status: "none", url: null });
  assert.equal(withGitlabDetails(pr, null, null).pipeline, null);
  assert.equal(withGitlabDetails(pr, null, null).approvals, null);
});

test("sortPrs: open and draft first, then newest", () => {
  const p = (ref, state, updatedAt) => ({ ref, state, updatedAt });
  const input = [
    p("a", "merged", "2026-11-26"),
    p("b", "open", "2026-11-01"),
    p("c", "draft", "2026-11-20"),
    p("d", "closed", "2026-11-25"),
  ];
  assert.deepEqual(sortPrs(input).map((x) => x.ref), ["c", "b", "a", "d"]);
  assert.equal(input[0].ref, "a", "the input is not reordered");
});

test("labels", () => {
  assert.equal(pipelineLabel("passed"), "pipeline passed");
  assert.equal(pipelineLabel("failed"), "pipeline failed");
  assert.equal(pipelineLabel("none"), "no pipeline");
  assert.equal(approvalsLabel({ names: ["Jane"], required: 2, left: 1, decision: null }), "1 of 2 approvals · Jane");
  assert.equal(approvalsLabel({ names: [], required: 0, left: 0, decision: null }), "no approvals required");
  assert.equal(approvalsLabel({ names: ["jane"], required: null, left: null, decision: "approved" }), "approved · jane");
  assert.equal(approvalsLabel({ names: [], required: null, left: null, decision: "review required" }), "review required");
  assert.equal(approvalsLabel({ names: [], required: null, left: null, decision: null }), "no reviews");
  assert.equal(ageLabel(5_000), "just now");
  assert.equal(ageLabel(90_000), "1 min ago");
  assert.equal(ageLabel(2 * 3600_000), "2 h ago");
});

test("scrub: a password with a raw @ is dropped whole", () => {
  assert.equal(scrub("fatal: https://u:p@ss@host/x"), "fatal: https://host/x");
});

test("parseRemoteOwner", () => {
  assert.equal(parseRemoteOwner("git@github.com:HenriBeck/herdr-plugins.git"), "henribeck");
  assert.equal(parseRemoteOwner("https://u:tok@github.com/Some-Org/r.git"), "some-org");
  assert.equal(parseRemoteOwner("ssh://git@github.com:22/o/r"), "o");
  assert.equal(parseRemoteOwner("/local/path"), null);
});

test("summarizeGithub: a fork PR from the remote's own owner is kept", () => {
  const fork = { ...gh, isCrossRepository: true, headRepositoryOwner: { login: "HenriBeck" } };
  assert.equal(summarizeGithub([fork], "henribeck").length, 1);
  assert.equal(summarizeGithub([fork], "someone-else").length, 0);
  assert.equal(summarizeGithub([fork]).length, 0);
});

test("refreshDue", () => {
  const now = 1_000_000;
  assert.equal(refreshDue({ cachedAt: null, now, force: false, justShown: false, keyChanged: false }), true);
  assert.equal(refreshDue({ cachedAt: now - 5_000, now, force: false, justShown: false, keyChanged: false }), false);
  assert.equal(refreshDue({ cachedAt: now - 60_000, now, force: false, justShown: false, keyChanged: false }), true);
  assert.equal(refreshDue({ cachedAt: now - 5_000, now, force: true, justShown: false, keyChanged: false }), true);
  assert.equal(refreshDue({ cachedAt: now - 5_000, now, force: false, justShown: true, keyChanged: false }), true);
  // Switching back to a pane refreshes it, unless it was fetched moments ago.
  assert.equal(refreshDue({ cachedAt: now - 15_000, now, force: false, justShown: false, keyChanged: true }), true);
  assert.equal(refreshDue({ cachedAt: now - 5_000, now, force: false, justShown: false, keyChanged: true }), false);
});
