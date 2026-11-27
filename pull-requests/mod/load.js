// From a pane's folder to the PRs of its branch, through git, gh and glab.
// `exec` is Herdr's (passed in, so `node --test` can stand in for it): it takes an args
// array, never a shell string, and rejects when the program can't start.
//
// Result = { kind: "prs", provider: "github" | "gitlab", branch, prs: Pr[] }
//        | { kind: "message", branch: string | null, text }
import {
  parseRemoteHost,
  parseRemoteOwner,
  providerFor,
  firstLine,
  summarizeGithub,
  summarizeGitlabList,
  withGitlabDetails,
  sortPrs,
} from "./prs.js";
import { parsePrUrl, remoteRepoKey } from "./session.js";

const TIMEOUT_MS = 20000;
// GitLab needs two more calls per MR for pipeline and approvals: only for the first few.
const GITLAB_DETAILS = 5;
const GH_FIELDS = "number,title,state,isDraft,headRefName,baseRefName,url,updatedAt,isCrossRepository,headRepositoryOwner,reviewDecision,latestReviews,statusCheckRollup,mergeable";

// Thrown inside loadPullRequests to end it with a message.
class Stop {
  constructor(text) {
    this.text = text;
  }
}

function runner(where, exec) {
  const options = { cwd: where.cwd, on: where.on ?? null, timeout: TIMEOUT_MS };
  return async (command, args) => {
    try {
      return await exec(command, args, options);
    } catch {
      throw new Stop(command === "git" ? "git isn't available" : `${command} isn't installed`);
    }
  };
}

async function remoteUrl(run) {
  const origin = await run("git", ["remote", "get-url", "origin"]);
  if (origin.code === 0 && origin.stdout.trim()) return origin.stdout.trim();
  const remotes = await run("git", ["remote"]);
  const first = remotes.code === 0 ? remotes.stdout.split("\n").map((l) => l.trim()).find(Boolean) : null;
  if (!first) return null;
  const url = await run("git", ["remote", "get-url", first]);
  return url.code === 0 && url.stdout.trim() ? url.stdout.trim() : null;
}

// The CLI's JSON answer, or a Stop with its error.
async function cliJson(run, command, args) {
  const out = await run(command, args);
  if (out.code !== 0) throw new Stop(firstLine(out.stderr) || `${command} failed`);
  try {
    return JSON.parse(out.stdout);
  } catch {
    throw new Stop(`Couldn't read ${command}'s answer`);
  }
}

// A details call that may fail on its own without failing the whole list.
async function optionalJson(run, command, args) {
  try {
    const out = await run(command, args);
    return out.code === 0 ? JSON.parse(out.stdout) : null;
  } catch {
    return null;
  }
}

async function githubPrs(run, branch, owner) {
  const list = await cliJson(run, "gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "20", "--json", GH_FIELDS]);
  return sortPrs(summarizeGithub(list, owner));
}

async function gitlabPrs(run, branch) {
  const list = await cliJson(run, "glab", ["mr", "list", "--source-branch", branch, "--all", "-F", "json", "--per-page", "20"]);
  const prs = sortPrs(summarizeGitlabList(list));
  const detailed = await Promise.all(
    prs.slice(0, GITLAB_DETAILS).map(async (pr) => {
      const [view, approvals] = await Promise.all([
        optionalJson(run, "glab", ["mr", "view", String(pr.number), "-F", "json"]),
        pr.projectId === null
          ? null
          : optionalJson(run, "glab", ["api", `projects/${pr.projectId}/merge_requests/${pr.number}/approvals`]),
      ]);
      return withGitlabDetails(pr, view, approvals);
    }),
  );
  return detailed.concat(prs.slice(GITLAB_DETAILS));
}

/** The repository's top folder for a folder in it, or null (not a repo, git missing). */
export async function repoRoot(where, exec) {
  try {
    const out = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: where.cwd, on: where.on ?? null, timeout: TIMEOUT_MS });
    return out.code === 0 && out.stdout.trim() ? out.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Never rejects: every failure becomes a `message` result. */
export async function loadPullRequests(where, exec) {
  const run = runner(where, exec);
  let branch = null;
  try {
    if ((await run("git", ["rev-parse", "--show-toplevel"])).code !== 0) throw new Stop("Not a git repository");
    const head = await run("git", ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (head.code !== 0 || !head.stdout.trim()) throw new Stop("Not on a branch");
    branch = head.stdout.trim();
    const url = await remoteUrl(run);
    if (!url) throw new Stop("This repo has no remote");
    const provider = providerFor(parseRemoteHost(url));
    if (!provider) throw new Stop("This repo isn't on GitHub or GitLab");
    const prs = provider === "github" ? await githubPrs(run, branch, parseRemoteOwner(url)) : await gitlabPrs(run, branch);
    if (!prs.length) {
      throw new Stop(`No ${provider === "github" ? "pull requests" : "merge requests"} for ${branch}`);
    }
    return { kind: "prs", provider, branch, prs };
  } catch (error) {
    const text = error instanceof Stop ? error.text : firstLine(String(error?.message ?? error)) || "Something went wrong";
    return { kind: "message", branch, text };
  }
}

/** Every remote of the pane's repo as "host/path" (see remoteRepoKey); [] when git fails. Never rejects. */
export async function remoteRepos(where, exec) {
  try {
    const out = await exec("git", ["remote", "-v"], { cwd: where.cwd, on: where.on ?? null, timeout: TIMEOUT_MS });
    if (out.code !== 0) return [];
    const keys = out.stdout.split("\n").map((line) => remoteRepoKey(line.split(/\s+/)[1])).filter(Boolean);
    return [...new Set(keys)];
  } catch {
    return [];
  }
}

// A session PR whose status couldn't be fetched: a card with its ref, repo and the error.
function failedPr(parsed, error) {
  return {
    ref: `${parsed.provider === "github" ? "#" : "!"}${parsed.number}`, number: parsed.number, title: "", url: parsed.url,
    state: "unknown", source: "", target: "", updatedAt: "", pipeline: null, approvals: null, blocker: null, error,
  };
}

async function sessionPr(parsed, run) {
  if (parsed.provider === "github") {
    const view = await cliJson(run, "gh", ["pr", "view", parsed.url, "--json", GH_FIELDS]);
    const [pr] = summarizeGithub([view], null, { allForks: true });
    if (!pr) throw new Stop("Couldn't read gh's answer");
    return pr;
  }
  const n = String(parsed.number);
  const [view, approvals] = await Promise.all([
    cliJson(run, "glab", ["mr", "view", n, "-R", `https://${parsed.host}/${parsed.path}`, "-F", "json"]),
    optionalJson(run, "glab", ["api", `projects/${encodeURIComponent(parsed.path)}/merge_requests/${n}/approvals`, "--hostname", parsed.host]),
  ]);
  const [pr] = summarizeGitlabList([view]);
  if (!pr) throw new Stop("Couldn't read glab's answer");
  return withGitlabDetails(pr, view, approvals);
}

/** The PRs behind the session's URLs, in the same order, each fetched on this computer. Never rejects. */
export async function loadSessionPrs(urls, { cwd }, exec) {
  const run = runner({ cwd, on: null }, exec);
  return Promise.all(
    urls.map(parsePrUrl).filter(Boolean).map(async (parsed) => {
      try {
        return await sessionPr(parsed, run);
      } catch (error) {
        const tool = parsed.provider === "github" ? "gh" : "glab";
        const text = error instanceof Stop ? error.text : firstLine(String(error?.message ?? error));
        return failedPr(parsed, text || `${tool} failed`);
      }
    }),
  );
}
