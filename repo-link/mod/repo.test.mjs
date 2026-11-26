// Run: node --test repo-link/mod/
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFromRemote, loadRepo } from "./repo.js";

test("repoFromRemote: GitHub over SSH, scp-like SSH and HTTPS", () => {
  const github = { provider: "github", host: "github.com", path: "HenriBeck/herdr-plugins", url: "https://github.com/HenriBeck/herdr-plugins" };
  for (const remote of [
    "git@github.com:HenriBeck/herdr-plugins.git",
    "github.com:HenriBeck/herdr-plugins",
    "ssh://git@github.com/HenriBeck/herdr-plugins.git",
    "https://github.com/HenriBeck/herdr-plugins.git",
    "https://github.com/HenriBeck/herdr-plugins/",
    "https://user:token@github.com/HenriBeck/herdr-plugins.git",
    "  git@GitHub.com:HenriBeck/herdr-plugins.git\n",
  ]) {
    assert.deepEqual(repoFromRemote(remote), github, remote);
  }
});

test("repoFromRemote: GitLab, self-hosted, nested groups and ports", () => {
  assert.deepEqual(repoFromRemote("git@gitlab.com:group/sub/project.git"), {
    provider: "gitlab", host: "gitlab.com", path: "group/sub/project", url: "https://gitlab.com/group/sub/project",
  });
  // An SSH port isn't the web port.
  assert.deepEqual(repoFromRemote("ssh://git@gitlab.example.com:2222/team/app.git"), {
    provider: "gitlab", host: "gitlab.example.com", path: "team/app", url: "https://gitlab.example.com/team/app",
  });
  // An HTTP(S) port and scheme are the web's.
  assert.deepEqual(repoFromRemote("http://gitlab.internal:8080/team/app.git"), {
    provider: "gitlab", host: "gitlab.internal", path: "team/app", url: "http://gitlab.internal:8080/team/app",
  });
});

test("repoFromRemote: null for other hosts, local paths and junk", () => {
  for (const remote of [
    null,
    "",
    "git@bitbucket.org:team/app.git",
    "https://example.com/team/app.git",
    "/Users/me/repos/app.git",
    "file:///Users/me/repos/app.git",
    "C:\\repos\\app",
    "git@github.com:",
    "https://github.com/",
  ]) {
    assert.equal(repoFromRemote(remote), null, String(remote));
  }
});

// A stand-in for Herdr's exec: answers by the joined command line.
function fakeExec(answers, calls = []) {
  return async (command, args, options) => {
    const line = [command, ...args].join(" ");
    calls.push({ line, options });
    if (!(line in answers)) return { code: 1, stdout: "", stderr: `unexpected: ${line}` };
    const answer = answers[line];
    if (answer instanceof Error) throw answer;
    return { code: 0, stderr: "", ...answer };
  };
}

test("loadRepo: origin's repository, run in the pane's folder and machine", async () => {
  const calls = [];
  const exec = fakeExec({ "git remote get-url origin": { stdout: "git@github.com:me/app.git\n" } }, calls);
  const repo = await loadRepo({ cwd: "/work/app/src", on: "box" }, exec);
  assert.equal(repo.url, "https://github.com/me/app");
  assert.equal(calls[0].options.cwd, "/work/app/src");
  assert.equal(calls[0].options.on, "box");
});

test("loadRepo: the first remote when there's no origin", async () => {
  const exec = fakeExec({
    "git remote get-url origin": { code: 2, stdout: "" },
    "git remote": { stdout: "upstream\nfork\n" },
    "git remote get-url upstream": { stdout: "https://gitlab.com/team/app.git\n" },
  });
  assert.equal((await loadRepo({ cwd: "/work/app" }, exec)).url, "https://gitlab.com/team/app");
});

test("loadRepo: null outside a repo, without remotes, on other hosts and when git can't start", async () => {
  const cases = [
    {},
    { "git remote get-url origin": { code: 2 }, "git remote": { stdout: "" } },
    { "git remote get-url origin": { stdout: "git@bitbucket.org:team/app.git" } },
    { "git remote get-url origin": new Error("spawn git ENOENT") },
  ];
  for (const answers of cases) {
    assert.equal(await loadRepo({ cwd: "/work/app" }, fakeExec(answers)), null, JSON.stringify(answers));
  }
});
