// Session PRs for the pull-requests mod: the PRs the Claude Code conversation in
// the focused pane created, as the herdr-claude-prs plugin saves them. Pure
// logic, so `node --test` can load it.
//
// Every Pr shown gains repo: { host, path, name } and current: boolean (its
// repo is the pane's), and a session PR that couldn't be fetched has
// state "unknown" and error: string.
import { sortPrs } from "./prs.js";

const str = (v) => (typeof v === "string" ? v : "");
const SEG = "[A-Za-z0-9_.~-]+";
const HOST = "(?:[^\\s/@]+@)?([A-Za-z0-9.-]+(?::\\d+)?)";
const GITHUB_URL = new RegExp(`^https://${HOST}/(${SEG}/${SEG})/pull/(\\d+)$`);
const GITLAB_URL = new RegExp(`^https://${HOST}/((?:${SEG}/)*${SEG})/-/merge_requests/(\\d+)$`);
const MAX_SESSION = 10;

/** A PR or MR URL's parts, credentials dropped; null for anything else. */
export function parsePrUrl(url) {
  const text = str(url).trim();
  for (const [provider, pattern, kind] of [["github", GITHUB_URL, "pull"], ["gitlab", GITLAB_URL, "-/merge_requests"]]) {
    const m = pattern.exec(text);
    if (!m) continue;
    const host = m[1].toLowerCase(), path = m[2], number = Number(m[3]);
    return { provider, host, path, name: path.split("/").pop(), number, url: `https://${host}/${path}/${kind}/${number}` };
  }
  return null;
}

/** A git remote URL as "host/path", lowercase, without credentials, port or .git; null if it has no host. */
export function remoteRepoKey(remote) {
  const text = str(remote).trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?\/(.+)$/i.exec(text)
    ?? /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+)$/.exec(text);
  if (!m) return null;
  const path = m[2].replace(/\/+$/, "").replace(/\.git$/i, "");
  return path ? `${m[1]}/${path}`.toLowerCase() : null;
}

/** The terminal file's PR URLs to fetch: the 10 newest valid ones, newest first; none when it ended or is unreadable. */
export function parseSessionFile(text) {
  let file;
  try {
    file = JSON.parse(str(text));
  } catch {
    return [];
  }
  if (!file || typeof file !== "object" || file.ended === true || !Array.isArray(file.prs)) return [];
  const urls = file.prs.map((p) => parsePrUrl(p?.url)?.url).filter(Boolean);
  return [...new Set(urls.reverse())].slice(0, MAX_SESSION);
}

const sameUrl = (url) => str(url).toLowerCase().replace(/\/+$/, "");

function repoOf(url) {
  const parsed = parsePrUrl(url);
  return parsed ? { host: parsed.host, path: parsed.path, name: parsed.name } : { host: "", path: "", name: "" };
}

/**
 * The branch lookup's result and the session's PRs as one list: branch PRs are
 * current; a session PR is current when its repo is one of the pane's remotes
 * ("host/path" keys). The branch copy wins when both have a PR. Current first
 * (the pane branch's first among them), then other repos; open first, newest
 * first within each.
 */
export function mergePrs({ branch, remotes, session, paneBranch }) {
  const notice = branch?.kind === "message" ? branch.text : null;
  const seen = new Set();
  const all = [];
  for (const pr of branch?.kind === "prs" ? branch.prs : []) {
    seen.add(sameUrl(pr.url));
    all.push({ ...pr, repo: repoOf(pr.url), current: true });
  }
  const ours = new Set(remotes ?? []);
  for (const pr of session ?? []) {
    if (seen.has(sameUrl(pr.url))) continue;
    seen.add(sameUrl(pr.url));
    const repo = repoOf(pr.url);
    all.push({ ...pr, repo, current: Boolean(repo.host) && ours.has(`${repo.host}/${repo.path}`.toLowerCase()) });
  }
  const onBranch = (pr) => pr.current && paneBranch !== null && pr.source === paneBranch;
  const prs = [
    ...sortPrs(all.filter(onBranch)),
    ...sortPrs(all.filter((pr) => pr.current && !onBranch(pr))),
    ...sortPrs(all.filter((pr) => !pr.current)),
  ];
  return { notice, prs };
}
