// From a pane's folder to the PRs of its branch, through git, gh and glab.
// `exec` is Herdr's (passed in, so `node --test` can stand in for it): it takes an args
// array, never a shell string, and rejects when the program can't start.
//
// Result = { kind: "prs", provider: "github" | "gitlab", branch, prs: Pr[] }
//        | { kind: "message", branch: string | null, text }
import {
  parseRemoteHost,
  providerFor,
  firstLine,
  summarizeGithub,
  summarizeGitlabList,
  withGitlabDetails,
  sortPrs,
} from "./prs.js";

const TIMEOUT_MS = 20000;
// GitLab needs two more calls per MR for pipeline and approvals: only for the first few.
const GITLAB_DETAILS = 5;
const GH_FIELDS = "number,title,state,isDraft,headRefName,baseRefName,url,updatedAt,isCrossRepository,reviewDecision,latestReviews,statusCheckRollup,mergeable";

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

async function githubPrs(run, branch) {
  const list = await cliJson(run, "gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "20", "--json", GH_FIELDS]);
  return sortPrs(summarizeGithub(list));
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
    const prs = provider === "github" ? await githubPrs(run, branch) : await gitlabPrs(run, branch);
    if (!prs.length) {
      throw new Stop(`No ${provider === "github" ? "pull requests" : "merge requests"} for ${branch}`);
    }
    return { kind: "prs", provider, branch, prs };
  } catch (error) {
    const text = error instanceof Stop ? error.text : firstLine(String(error?.message ?? error)) || "Something went wrong";
    return { kind: "message", branch, text };
  }
}
