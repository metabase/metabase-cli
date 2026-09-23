const SCP_REMOTE = /^[^@/\s]+@([^:/\s]+):(.+)$/;
const URL_REMOTE = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+)$/;
const SSH_SCHEME = /^(?:ssh|git):\/\//;
const PORT_SUFFIX = /:\d+$/;
const GIT_SUFFIX = /\.git\/?$|\/$/;

type ForgeKind = "github" | "gitlab";

interface RemoteLocation {
  readonly forge: ForgeKind;
  readonly host: string;
  readonly project: string;
}

function forgeOf(host: string): ForgeKind | null {
  if (host.includes("github")) {
    return "github";
  }
  if (host.includes("gitlab")) {
    return "gitlab";
  }
  return null;
}

interface HostAndPath {
  readonly host: string;
  readonly path: string;
}

// An SSH remote's port is the SSH daemon's, never the web server's, so it is dropped; an HTTPS
// remote's port is the web server's and is kept.
function hostAndPath(remoteUrl: string): HostAndPath | null {
  const scp = SCP_REMOTE.exec(remoteUrl);
  if (scp !== null && !remoteUrl.includes("://")) {
    const [, host, path] = scp;
    return host === undefined || path === undefined ? null : { host, path };
  }
  const url = URL_REMOTE.exec(remoteUrl);
  if (url === null) {
    return null;
  }
  const [, authority, path] = url;
  if (authority === undefined || path === undefined) {
    return null;
  }
  const host = SSH_SCHEME.test(remoteUrl) ? authority.replace(PORT_SUFFIX, "") : authority;
  return { host, path };
}

export function remoteLocation(remoteUrl: string): RemoteLocation | null {
  const parsed = hostAndPath(remoteUrl.trim());
  if (parsed === null) {
    return null;
  }
  const forge = forgeOf(parsed.host.toLowerCase());
  const project = parsed.path.replace(GIT_SUFFIX, "");
  if (forge === null || project.length === 0) {
    return null;
  }
  return { forge, host: parsed.host, project };
}

function branchPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

// GitLab's equivalent of GitHub's compare page with the form open is the new merge request page,
// which takes both branches as query parameters.
export function pullRequestUrl(location: RemoteLocation, base: string, branch: string): string {
  const project = `https://${location.host}/${location.project}`;
  if (location.forge === "github") {
    return `${project}/compare/${branchPath(base)}...${branchPath(branch)}?expand=1`;
  }
  const source = `merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`;
  const target = `merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`;
  return `${project}/-/merge_requests/new?${source}&${target}`;
}
