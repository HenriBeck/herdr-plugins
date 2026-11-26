// Pure logic for the pull-requests mod: no imports, so `node --test` can load it.
//
// Input is what `gh pr list --json …`, `glab mr list -F json`, `glab mr view -F json`
// and `glab api …/approvals` print. Output is one shape for both:
//
// Pr = { ref: "#12" | "!12", number, title, url, state: "open" | "draft" | "merged" | "closed",
//        source, target, updatedAt, projectId? (GitLab),
//        pipeline: { status: PipelineStatus, url: string | null } | null  (null: not fetched),
//        approvals: Approvals | null  (null: not fetched),
//        blocker: "conflicts" | "changes requested" | null }
// PipelineStatus = "passed" | "failed" | "running" | "manual" | "canceled" | "none"
// Approvals = { names: string[], required: number | null, left: number | null,
//               decision: "approved" | "changes requested" | "review required" | null }

const str = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v) => (Array.isArray(v) ? v : []);

/** The lowercase host of a git remote URL (SSH, scp-like or HTTP(S)), or null. */
export function parseRemoteHost(url) {
  const text = str(url).trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(text);
  if (withScheme) return withScheme[1].toLowerCase();
  const scpLike = /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)/.exec(text);
  if (scpLike) return scpLike[1].toLowerCase();
  return null;
}

export function providerFor(host) {
  if (host === "github.com") return "github";
  if (typeof host === "string" && host.includes("gitlab")) return "gitlab";
  return null;
}

/** Drops credentials from URLs in the text (`https://user:token@host` → `https://host`). */
export function scrub(text) {
  return str(text).replace(/:\/\/[^/\s@]+@/g, "://");
}

/** The first non-empty line, trimmed, without credentials, at most 200 characters. */
export function firstLine(text) {
  const line = str(text).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return scrub(line).slice(0, 200);
}

const GITHUB_FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

function githubChecks(rollup) {
  const checks = list(rollup);
  if (!checks.length) return "none";
  let running = false;
  for (const c of checks) {
    if (c?.__typename === "StatusContext") {
      if (GITHUB_FAILED.has(c.state)) return "failed";
      if (c.state === "PENDING" || c.state === "EXPECTED") running = true;
    } else {
      if (GITHUB_FAILED.has(c?.conclusion)) return "failed";
      if (c?.status !== "COMPLETED") running = true;
    }
  }
  return running ? "running" : "passed";
}

const GITHUB_DECISIONS = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

function githubState(pr) {
  if (pr.state === "OPEN") return pr.isDraft === true ? "draft" : "open";
  if (pr.state === "MERGED") return "merged";
  return "closed";
}

/** `gh pr list --json …` output → Pr[]; PRs from forks are left out. */
export function summarizeGithub(prs) {
  return list(prs)
    .filter((pr) => pr && pr.isCrossRepository !== true)
    .map((pr) => {
      const url = str(pr.url);
      const decision = GITHUB_DECISIONS[pr.reviewDecision] ?? null;
      const names = list(pr.latestReviews)
        .filter((r) => r?.state === "APPROVED")
        .map((r) => str(r.author?.login))
        .filter(Boolean);
      let blocker = null;
      if (pr.mergeable === "CONFLICTING") blocker = "conflicts";
      else if (decision === "changes requested") blocker = "changes requested";
      return {
        ref: `#${num(pr.number) ?? "?"}`,
        number: num(pr.number),
        title: str(pr.title),
        url,
        state: githubState(pr),
        source: str(pr.headRefName),
        target: str(pr.baseRefName),
        updatedAt: str(pr.updatedAt),
        pipeline: { status: githubChecks(pr.statusCheckRollup), url: url ? `${url}/checks` : null },
        approvals: { names, required: null, left: null, decision },
        blocker,
      };
    });
}

function gitlabState(mr) {
  if (mr.state === "opened") return mr.draft === true ? "draft" : "open";
  if (mr.state === "merged") return "merged";
  return "closed";
}

/** `glab mr list -F json` output → Pr[] without pipeline and approvals (those need more calls). */
export function summarizeGitlabList(mrs) {
  return list(mrs)
    .filter(Boolean)
    .map((mr) => {
      let blocker = null;
      if (mr.has_conflicts === true) blocker = "conflicts";
      else if (mr.detailed_merge_status === "requested_changes") blocker = "changes requested";
      return {
        ref: `!${num(mr.iid) ?? "?"}`,
        number: num(mr.iid),
        title: str(mr.title),
        url: str(mr.web_url),
        state: gitlabState(mr),
        source: str(mr.source_branch),
        target: str(mr.target_branch),
        updatedAt: str(mr.updated_at),
        projectId: num(mr.project_id),
        pipeline: null,
        approvals: null,
        blocker,
      };
    });
}

const GITLAB_PIPELINE = {
  success: "passed",
  failed: "failed",
  running: "running",
  pending: "running",
  created: "running",
  preparing: "running",
  waiting_for_resource: "running",
  scheduled: "running",
  manual: "manual",
  canceled: "canceled",
  skipped: "canceled",
};

/** Adds what `glab mr view` and the approvals API said; either may be null (call failed). */
export function withGitlabDetails(pr, view, approvals) {
  let pipeline = null;
  if (view && typeof view === "object") {
    const p = view.head_pipeline;
    pipeline = p ? { status: GITLAB_PIPELINE[p.status] ?? "none", url: str(p.web_url) || null } : { status: "none", url: null };
  }
  let summary = null;
  if (approvals && typeof approvals === "object") {
    summary = {
      names: list(approvals.approved_by).map((a) => str(a?.user?.name) || str(a?.user?.username)).filter(Boolean),
      required: num(approvals.approvals_required),
      left: num(approvals.approvals_left),
      decision: null,
    };
  }
  return { ...pr, pipeline, approvals: summary };
}

const STILL_OPEN = new Set(["open", "draft"]);

/** Open and draft first, then merged and closed; newest first within each group. */
export function sortPrs(prs) {
  return [...prs].sort((a, b) => {
    const group = Number(!STILL_OPEN.has(a.state)) - Number(!STILL_OPEN.has(b.state));
    return group || str(b.updatedAt).localeCompare(str(a.updatedAt));
  });
}

const PIPELINE_LABELS = {
  passed: "pipeline passed",
  failed: "pipeline failed",
  running: "pipeline running",
  manual: "pipeline waiting for a manual job",
  canceled: "pipeline canceled",
  none: "no pipeline",
};

export function pipelineLabel(status) {
  return PIPELINE_LABELS[status] ?? "no pipeline";
}

export function approvalsLabel(a) {
  const who = a.names.length ? ` · ${a.names.join(", ")}` : "";
  if (a.required !== null) {
    if (a.required === 0) return a.names.length ? `approved${who}` : "no approvals required";
    const given = a.required - (a.left ?? a.required);
    return `${Math.max(0, given)} of ${a.required} approvals${who}`;
  }
  if (a.decision) return `${a.decision}${who}`;
  return a.names.length ? `approved${who}` : "no reviews";
}

/** How long ago, roughly: "just now", "4 min ago", "2 h ago", "3 d ago". */
export function ageLabel(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
