import { describe, expect, it } from "vitest";

import { pullRequestUrl, remoteLocation } from "./remote";

const BASE = "main";
const BRANCH = "rde/clean-orders";

function urlFor(remoteUrl: string): string | null {
  const location = remoteLocation(remoteUrl);
  return location === null ? null : pullRequestUrl(location, BASE, BRANCH);
}

const GITHUB_COMPARE =
  "https://github.com/metabase/analytics/compare/main...rde/clean-orders?expand=1";

const GITLAB_NEW_MERGE_REQUEST =
  "https://gitlab.com/data/team/analytics/-/merge_requests/new?merge_request%5Bsource_branch%5D=rde%2Fclean-orders&merge_request%5Btarget_branch%5D=main";

describe("pullRequestUrl", () => {
  it("opens GitHub's compare page for an HTTPS remote", () => {
    expect(urlFor("https://github.com/metabase/analytics.git")).toBe(GITHUB_COMPARE);
  });

  it("opens GitHub's compare page for an SSH remote in scp form", () => {
    expect(urlFor("git@github.com:metabase/analytics.git")).toBe(GITHUB_COMPARE);
  });

  it("drops an SSH remote's port, which belongs to the SSH daemon and not the web server", () => {
    expect(urlFor("ssh://git@github.com:22/metabase/analytics.git")).toBe(GITHUB_COMPARE);
  });

  it("reads a remote with no .git suffix the same way", () => {
    expect(urlFor("https://github.com/metabase/analytics")).toBe(GITHUB_COMPARE);
  });

  it("keeps a GitHub Enterprise host and the HTTPS port it serves on", () => {
    expect(urlFor("https://github.acme.test:8443/data/analytics.git")).toBe(
      "https://github.acme.test:8443/data/analytics/compare/main...rde/clean-orders?expand=1",
    );
  });

  it("opens GitLab's new merge request page for an HTTPS remote in a nested group", () => {
    expect(urlFor("https://gitlab.com/data/team/analytics.git")).toBe(GITLAB_NEW_MERGE_REQUEST);
  });

  it("opens GitLab's new merge request page for an SSH remote", () => {
    expect(urlFor("git@gitlab.com:data/team/analytics.git")).toBe(GITLAB_NEW_MERGE_REQUEST);
  });

  it("escapes a branch name that carries characters a URL path reserves", () => {
    const location = remoteLocation("https://github.com/metabase/analytics.git");
    if (location === null) {
      throw new Error("the remote was not read");
    }
    expect(pullRequestUrl(location, BASE, "rde/orders#2")).toBe(
      "https://github.com/metabase/analytics/compare/main...rde/orders%232?expand=1",
    );
  });

  it("offers no page for a host that is neither GitHub nor GitLab", () => {
    expect(remoteLocation("https://bitbucket.org/metabase/analytics.git")).toBeNull();
  });

  it("offers no page for a remote on the local disk", () => {
    expect(remoteLocation("/srv/git/analytics.git")).toBeNull();
  });
});
