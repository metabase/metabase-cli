import { isOAuthExpired } from "@metabase/client/auth/credential";
import { refreshOAuthCredential } from "@metabase/client/auth/oauth-session";
import { ConfigError, errorMessage } from "@metabase/client/errors";

import type { OAuthCredential } from "@metabase/client/auth/credential";

import type { BrokerCredential } from "../../contracts/broker";
import { DISCONNECTED, type ConnectionState } from "../../contracts/connection";
import type { ConnectedUser, ServerSummary, StoredCredential } from "../../contracts/settings";

import { USER_AGENT } from "./oauth";

const NOT_CONNECTED_REASON = "Not connected to Metabase.";

interface AdoptedConnection {
  readonly url: string;
  readonly user: ConnectedUser;
  readonly server: ServerSummary;
  readonly connectedAt: string;
  readonly credential: StoredCredential;
}

interface RefresherDeps {
  readonly persist: (credential: StoredCredential) => Promise<void>;
  readonly now: () => number;
  readonly onChange: (state: ConnectionState) => void;
  readonly log: (message: string) => void;
}

interface GrantAvailable {
  readonly kind: "granted";
  readonly url: string;
  readonly credential: BrokerCredential;
}

interface GrantUnavailable {
  readonly kind: "unavailable";
  readonly reason: string;
}

export type CredentialGrant = GrantAvailable | GrantUnavailable;

interface ConnectionIdentity {
  readonly url: string;
  readonly user: ConnectedUser;
}

function identityOf(state: ConnectionState): ConnectionIdentity | null {
  if (state.kind === "disconnected") {
    return null;
  }
  return { url: state.url, user: state.user };
}

type RefreshMode = "when-expiring" | "forced";

export class ConnectionRefresher {
  private connection: ConnectionState = DISCONNECTED;
  private credential: StoredCredential | null = null;
  private pending: Promise<CredentialGrant> | null = null;

  constructor(private readonly deps: RefresherDeps) {}

  state(): ConnectionState {
    return this.connection;
  }

  adopt(input: AdoptedConnection): ConnectionState {
    this.credential = input.credential;
    return this.set({
      kind: "connected",
      url: input.url,
      user: input.user,
      server: input.server,
      connectedAt: input.connectedAt,
    });
  }

  signOut(): ConnectionState {
    this.credential = null;
    return this.set(DISCONNECTED);
  }

  getAccessToken(): Promise<CredentialGrant> {
    return this.provide("when-expiring");
  }

  forceRefresh(): Promise<CredentialGrant> {
    return this.provide("forced");
  }

  private async provide(mode: RefreshMode): Promise<CredentialGrant> {
    const credential = this.credential;
    const identity = identityOf(this.connection);
    if (credential === null || identity === null) {
      return { kind: "unavailable", reason: this.refusalReason() };
    }
    if (credential.kind === "apiKey") {
      return {
        kind: "granted",
        url: identity.url,
        credential: { kind: "apiKey", apiKey: credential.apiKey },
      };
    }
    if (mode === "when-expiring" && !isOAuthExpired(credential, this.deps.now())) {
      return bearerGrant(identity.url, credential);
    }
    this.pending ??= this.refreshOnce(identity.url, credential);
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async refreshOnce(url: string, credential: OAuthCredential): Promise<CredentialGrant> {
    try {
      const refreshed = await refreshOAuthCredential(url, credential, this.deps.now(), USER_AGENT);
      this.credential = refreshed;
      this.markReachable();
      await this.deps.persist(refreshed);
      return bearerGrant(url, refreshed);
    } catch (error) {
      // The client raises `ConfigError` for a grant the server refused and its HTTP taxonomy for
      // everything transient, so the two failures are told apart without reading a status here.
      const refused = error instanceof ConfigError;
      this.deps.log(
        `connection: renewing the sign-in to ${url} ${refused ? "was refused" : "failed"}: ${errorMessage(error)}`,
      );
      if (refused) {
        const reason = signedOutReason(url);
        this.markSignedOut(reason);
        return { kind: "unavailable", reason };
      }
      this.markStale(unreachableReason(url));
      return bearerGrant(url, credential);
    }
  }

  private refusalReason(): string {
    const state = this.connection;
    if (state.kind === "signed-out") {
      return state.reason;
    }
    return NOT_CONNECTED_REASON;
  }

  private set(state: ConnectionState): ConnectionState {
    this.connection = state;
    this.deps.onChange(state);
    return state;
  }

  private markReachable(): void {
    const previous = this.connection;
    if (previous.kind !== "stale") {
      return;
    }
    this.set({
      kind: "connected",
      url: previous.url,
      user: previous.user,
      server: previous.server,
      connectedAt: previous.lastProbeAt,
    });
  }

  private markStale(reason: string): void {
    const previous = this.connection;
    if (previous.kind === "connected") {
      this.set({
        kind: "stale",
        url: previous.url,
        user: previous.user,
        server: previous.server,
        lastProbeAt: previous.connectedAt,
        reason,
      });
      return;
    }
    if (previous.kind === "stale") {
      this.set({ ...previous, reason });
    }
  }

  private markSignedOut(reason: string): void {
    const identity = identityOf(this.connection);
    this.credential = null;
    if (identity === null) {
      this.set(DISCONNECTED);
      return;
    }
    this.set({ kind: "signed-out", url: identity.url, user: identity.user, reason });
  }
}

// The reason is what the app and a session's `mb` both show, so it says what happened and what
// to do in the user's words; the server's own error goes to the log.
function signedOutReason(url: string): string {
  return `Metabase at ${url} signed this app out. Sign in again in Settings.`;
}

function unreachableReason(url: string): string {
  return `Metabase at ${url} didn't answer. The app tries again when a session next needs it.`;
}

function bearerGrant(url: string, credential: OAuthCredential): CredentialGrant {
  return {
    kind: "granted",
    url,
    credential: {
      kind: "oauth",
      accessToken: credential.accessToken,
      expiresAt: credential.expiresAt,
    },
  };
}
