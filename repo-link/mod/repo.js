// Pure logic for the repo-link mod: no imports, so `node --test` can load it.
//
// Repo = { provider: "github" | "gitlab", host, path, url }
//   host: lowercase, without a port; path: "owner/name" (GitLab: "group/sub/name");
//   url: the repository's web page.

const TIMEOUT_MS = 10000;

const str = (v) => (typeof v === "string" ? v : "");

function providerFor(host) {
  if (host === "github.com") return "github";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}

/** The web page of a git remote URL (SSH, scp-like or HTTP(S)) on GitHub or GitLab, or null. */
export function repoFromRemote(remote) {
  const text = str(remote).trim();
  let web; // scheme and host[:port] of the web page
  let host;
  let path;
  const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/?#]+)\/([^?#]*)/i.exec(text);
  const scpLike = withScheme ? null : /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.*)$/.exec(text);
  if (withScheme) {
    const scheme = withScheme[1].toLowerCase();
    host = withScheme[2].replace(/:\d+$/, "").toLowerCase();
    // An HTTP(S) remote is the web server itself; an SSH port isn't the web's.
    web = scheme === "http" || scheme === "https" ? `${scheme}://${withScheme[2].toLowerCase()}` : `https://${host}`;
    path = withScheme[3];
  } else if (scpLike) {
    host = scpLike[1].toLowerCase();
    web = `https://${host}`;
    path = scpLike[2];
  } else {
    return null;
  }
  const provider = providerFor(host);
  path = path.replace(/\/+$/, "").replace(/\.git$/, "");
  if (!provider || !path) return null;
  return { provider, host, path, url: `${web}/${path}` };
}

/** The repository of the folder's `origin` remote (else its first remote), or null.
 *  `exec` is Herdr's (passed in for tests). Never rejects. */
export async function loadRepo(where, exec) {
  const options = { cwd: where.cwd, on: where.on ?? null, timeout: TIMEOUT_MS };
  const git = async (...args) => {
    const out = await exec("git", args, options);
    return out.code === 0 ? out.stdout.trim() : "";
  };
  try {
    let remote = await git("remote", "get-url", "origin");
    if (!remote) {
      const first = (await git("remote")).split("\n").map((l) => l.trim()).find(Boolean);
      if (first) remote = await git("remote", "get-url", first);
    }
    return repoFromRemote(remote);
  } catch {
    return null; // git isn't installed, the folder or machine is gone
  }
}
