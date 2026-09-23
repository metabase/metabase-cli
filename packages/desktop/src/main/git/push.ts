interface PushRefusal {
  readonly signals: readonly string[];
  readonly explain: (branch: string) => string;
}

// git names why a push was turned down only in its output; the first row whose signal appears
// there says it in the app's words. Credentials come before reachability because an SSH remote
// that refuses a key also prints "Could not read from remote repository".
const PUSH_REFUSALS: readonly PushRefusal[] = [
  {
    signals: ["(stale info)"],
    explain: (branch) =>
      `${branch} moved on origin after this checkout last fetched it, so the forced push stopped before overwriting anything. Fetch, look at what changed, then push again.`,
  },
  {
    signals: ["(fetch first)", "(non-fast-forward)"],
    explain: (branch) =>
      `origin has commits on ${branch} that this branch doesn't. Merge them in, then push again.`,
  },
  {
    signals: ["Authentication failed", "Permission denied", "could not read Username"],
    explain: () =>
      "origin turned down the credentials git offered. Check that a terminal can push to this remote, then try again.",
  },
  {
    signals: ["Could not resolve host", "Connection refused", "Connection timed out"],
    explain: () => "origin could not be reached. Check the network, then push again.",
  },
  {
    signals: ["pre-receive hook declined", "protected branch"],
    explain: (branch) =>
      `origin's rules refused ${branch}. The output above gives the server's reason.`,
  },
];

export function pushRefusalMessage(branch: string, output: string): string {
  const known = PUSH_REFUSALS.find((refusal) =>
    refusal.signals.some((signal) => output.includes(signal)),
  );
  return known === undefined
    ? "git could not push the branch. The output above says why."
    : known.explain(branch);
}
