import tls from "node:tls";

// Node's default trust store is the bundled Mozilla CA list only, so certificates trusted by
// the OS (corporate proxies, local dev CAs like OrbStack's) fail verification unless the user
// remembers NODE_USE_SYSTEM_CA=1. Merging the system store into the defaults gives every TLS
// connection the same trust the OS has. The APIs exist from Node 22.19 / 24.5; older runtimes
// keep the bundled-only behavior.
export function trustSystemCa(): void {
  const canReadSystemStore = typeof tls.getCACertificates === "function";
  const canReplaceDefaults = typeof tls.setDefaultCACertificates === "function";
  if (!canReadSystemStore || !canReplaceDefaults) {
    return;
  }
  const systemCerts = tls.getCACertificates("system");
  if (systemCerts.length === 0) {
    return;
  }
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...systemCerts]);
}
